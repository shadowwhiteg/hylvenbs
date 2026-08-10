import { CookieJar, createSession, loginWithHttp, loginWithPlaywright, type ScrapeSession } from "@/lib/scrape/session";

declare global {
  var __mlDropScrapeSession: { session: ScrapeSession; createdAt: number } | undefined;
}

const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * Logging in to MeuDropBrasil takes a couple seconds, so a per-product
 * refresh over dozens of selected items would otherwise re-authenticate on
 * every single request. The session is cached in-process (same pattern as
 * lib/tunnel/manager.ts) and reused until it goes stale.
 */
export async function getSharedScrapeSession(): Promise<ScrapeSession> {
  const cached = global.__mlDropScrapeSession;
  if (cached && Date.now() - cached.createdAt < SESSION_TTL_MS) {
    return cached.session;
  }

  const baseUrl = (process.env.DROP_SITE_URL || "https://meudropbrasil.com").replace(/\/$/, "");
  const email = process.env.DROP_EMAIL || "";
  const password = process.env.DROP_PASSWORD || "";

  const jar = new CookieJar();
  const session = createSession(jar);

  if (email && password) {
    let login = await loginWithHttp(baseUrl, email, password, jar);
    if (!login.ok) login = await loginWithPlaywright(baseUrl, email, password, jar);
    session.loggedIn = login.ok;
  }

  global.__mlDropScrapeSession = { session, createdAt: Date.now() };
  return session;
}
