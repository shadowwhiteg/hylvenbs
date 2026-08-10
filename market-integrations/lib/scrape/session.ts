const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Minimal cookie jar: single host, no expiry/path handling needed here. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  setFromResponse(res: Response): void {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const raw = headers.getSetCookie?.() ?? [];
    const single = res.headers.get("set-cookie");
    const all = raw.length ? raw : single ? [single] : [];

    for (const entry of all) {
      for (const pair of entry.split(/,(?=[^;]+=[^;]*;)/)) {
        const [nameValue] = pair.split(";");
        const index = nameValue.indexOf("=");
        if (index <= 0) continue;
        const name = nameValue.slice(0, index).trim();
        const value = nameValue.slice(index + 1).trim();
        if (!name) continue;
        if (value === "deleted" || value === "") this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  has(prefix: string): boolean {
    for (const name of this.cookies.keys()) {
      if (name.startsWith(prefix)) return true;
    }
    return false;
  }
}

export type ScrapeSession = {
  jar: CookieJar;
  loggedIn: boolean;
  fetchText: (url: string) => Promise<string>;
};

export function createSession(jar = new CookieJar()): ScrapeSession {
  const session: ScrapeSession = {
    jar,
    loggedIn: false,
    async fetchText(url: string) {
      const res = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9",
          ...(jar.header() ? { Cookie: jar.header() } : {}),
        },
      });
      jar.setFromResponse(res);
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
      return res.text();
    },
  };
  return session;
}

function extractNonce(html: string): string | null {
  return (
    html.match(/name=["']woocommerce-login-nonce["']\s+value=["']([^"']+)["']/i)?.[1] ??
    html.match(/name=["']_wpnonce["']\s+value=["']([^"']+)["']/i)?.[1] ??
    null
  );
}

/**
 * Log in through the WooCommerce account form. Much faster than driving a
 * browser and immune to the site's promo/warning modals, which need JS.
 */
export async function loginWithHttp(
  baseUrl: string,
  email: string,
  password: string,
  jar: CookieJar
): Promise<{ ok: boolean; error?: string }> {
  const accountUrl = `${baseUrl.replace(/\/$/, "")}/minha-conta/`;

  try {
    const formRes = await fetch(accountUrl, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    jar.setFromResponse(formRes);
    const formHtml = await formRes.text();
    const nonce = extractNonce(formHtml);
    if (!nonce) return { ok: false, error: "nonce de login não encontrado" };

    const body = new URLSearchParams({
      username: email,
      password,
      "woocommerce-login-nonce": nonce,
      _wp_http_referer: "/minha-conta/",
      login: "Acessar",
      rememberme: "forever",
    });

    // WooCommerce sets the auth cookies on the 302 response, so redirects are
    // followed by hand — `redirect: "follow"` only exposes the final headers.
    let url = accountUrl;
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, {
        method: hop === 0 ? "POST" : "GET",
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          Referer: accountUrl,
          "Accept-Language": "pt-BR,pt;q=0.9",
          Cookie: jar.header(),
          ...(hop === 0 ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: hop === 0 ? body : undefined,
      });
      jar.setFromResponse(res);

      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) break;
      url = new URL(location, url).toString();
    }

    if (jar.has("wordpress_logged_in_")) return { ok: true };
    return { ok: false, error: `login recusado (HTTP ${res?.status ?? 0})` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fallback when the form POST is blocked: drive a real browser once. */
export async function loginWithPlaywright(
  baseUrl: string,
  email: string,
  password: string,
  jar: CookieJar
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();
      await page.goto(`${baseUrl.replace(/\/$/, "")}/minha-conta/`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      const form = page.locator("form.woocommerce-form-login").first();
      const scope = (await form.count()) ? form : page;
      const user = scope.locator('input[name="username"], input[type="email"]').first();
      const pass = scope.locator('input[name="password"], input[type="password"]').first();
      if (!(await user.count()) || !(await pass.count())) {
        return { ok: false, error: "formulário de login não encontrado" };
      }

      await user.fill(email);
      await pass.fill(password);
      await Promise.all([
        page.waitForLoadState("networkidle").catch(() => undefined),
        scope.locator('button[name="login"], button[type="submit"]').first().click(),
      ]);

      for (const cookie of await context.cookies()) {
        jar.set(cookie.name, cookie.value);
      }
      return jar.has("wordpress_logged_in_")
        ? { ok: true }
        : { ok: false, error: "sessão não autenticada após o login" };
    } finally {
      await browser.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
