import {
  CookieJar,
  createSession,
  loginWithHttp,
  loginWithPlaywright,
  type ScrapeSession,
} from "@/lib/scrape/session";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type WmdPublishConfig = {
  restPublish: string;
  restShopeePublish: string;
  /** "Atualizar preço" de anúncio já existente — não é o mesmo que republicar. */
  restUpdate?: string;
  restShopeeUpdate?: string;
  restPublished: string;
  restDefaults: string;
  restSkuItems: string;
  restNonce: string;
  ajaxurl: string;
  mlConnected: string;
  spConnected: string;
};

export type OneClickSession = {
  session: ScrapeSession;
  wmd: WmdPublishConfig;
};

function extractWmdConfig(html: string): WmdPublishConfig | null {
  const match = html.match(/var WMD_PUBLISH = (\{.*?\});/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Authenticates against Meu Drop and parses the "Sistema One Click" (plugin
 * woo-meli-drop) REST endpoints + nonce embedded in /minha-conta/marketplaces/.
 * The nonce ties to the logged-in cookie session, so it must be re-read per run.
 */
export async function getOneClickSession(): Promise<OneClickSession> {
  const baseUrl = (process.env.DROP_SITE_URL || "https://meudropbrasil.com").replace(/\/$/, "");
  const email = process.env.DROP_EMAIL || "";
  const password = process.env.DROP_PASSWORD || "";
  if (!email || !password) {
    throw new Error("DROP_EMAIL/DROP_PASSWORD não configurados");
  }

  const jar = new CookieJar();
  const session = createSession(jar);

  let login = await loginWithHttp(baseUrl, email, password, jar);
  if (!login.ok) {
    login = await loginWithPlaywright(baseUrl, email, password, jar);
  }
  if (!login.ok) {
    throw new Error(`Login no Meu Drop falhou: ${login.error || "desconhecido"}`);
  }
  session.loggedIn = true;

  const html = await session.fetchText(`${baseUrl}/minha-conta/marketplaces/`);
  const wmd = extractWmdConfig(html);
  if (!wmd) {
    throw new Error("Não foi possível localizar a configuração do Sistema One Click na página");
  }

  return { session, wmd };
}

export { USER_AGENT };
