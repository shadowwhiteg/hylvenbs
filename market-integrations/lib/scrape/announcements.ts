import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * Seletores comuns de popup/modal (WordPress/Elementor/plugins de aviso). O
 * popup do Meu Drop aparece ~1x/dia; como cada scrape abre um contexto de
 * navegador novo (sem localStorage/cookie de "já vi hoje"), ele deve disparar
 * a cada execução. Se a heurística não bater com o markup real do site, o
 * `rawHtmlSnippet` retornado ajuda a ajustar os seletores depois.
 */
const POPUP_SELECTORS = [
  '[role="dialog"]',
  ".elementor-popup-modal",
  ".elementor-location-popup",
  '[class*="popup" i]:not(body):not(html)',
  '[class*="modal" i]:not(body):not(html)',
  ".mfp-content",
  ".fancybox-content",
];

function hashText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

export type AnnouncementScrapeResult = {
  found: boolean;
  text: string | null;
  warnings: string[];
  saved: boolean;
};

export async function scrapeMeuDropAnnouncements(): Promise<AnnouncementScrapeResult> {
  const baseUrl = (process.env.DROP_SITE_URL || "https://meudropbrasil.com").replace(/\/$/, "");
  const email = process.env.DROP_EMAIL || "";
  const password = process.env.DROP_PASSWORD || "";
  const warnings: string[] = [];

  if (!email || !password) {
    return {
      found: false,
      text: null,
      warnings: ["DROP_EMAIL/DROP_PASSWORD não configurados"],
      saved: false,
    };
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    await page.goto(`${baseUrl}/minha-conta/`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const form = page.locator("form.woocommerce-form-login").first();
    const scope = (await form.count()) ? form : page;
    const user = scope.locator('input[name="username"], input[type="email"]').first();
    const pass = scope.locator('input[name="password"], input[type="password"]').first();

    if (await user.count()) {
      await user.fill(email);
      await pass.fill(password);
      await Promise.all([
        page.waitForLoadState("networkidle").catch(() => undefined),
        scope.locator('button[name="login"], button[type="submit"]').first().click(),
      ]);
    } else {
      warnings.push("Formulário de login não encontrado — seguindo sem autenticar");
    }

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Dá tempo pro popup (geralmente disparado por JS após o load) aparecer.
    await page.waitForTimeout(4000);

    let text: string | null = null;
    for (const selector of POPUP_SELECTORS) {
      const locator = page.locator(selector).first();
      if (!(await locator.count().catch(() => 0))) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const content = (await locator.innerText().catch(() => ""))?.trim();
      if (content && content.length > 10) {
        text = content;
        break;
      }
    }

    if (!text) {
      warnings.push(
        "Nenhum popup de comunicado detectado nesta execução (pode não ter disparado hoje, ou o seletor precisa de ajuste)."
      );
      return { found: false, text: null, warnings, saved: false };
    }

    const contentHash = hashText(text);
    const existing = await prisma.meuDropAnnouncement.findUnique({ where: { contentHash } });
    if (existing) {
      return { found: true, text, warnings, saved: false };
    }

    await prisma.meuDropAnnouncement.create({ data: { contentHash, text } });
    return { found: true, text, warnings, saved: true };
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    return { found: false, text: null, warnings, saved: false };
  } finally {
    await browser.close();
  }
}
