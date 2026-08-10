import fs from "fs";
import path from "path";
import { gunzipSync } from "zlib";

const ML_API = "https://api.mercadolibre.com";
const DEFAULT_SITE_ID = "MLB";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type MlCategoryNode = {
  id: string;
  name: string;
  path_from_root?: Array<{ id: string; name: string }>;
  children_categories?: Array<{ id: string; name: string }>;
};

export type LeafCategory = {
  id: string;
  name: string;
  path: string;
};

type DumpCacheMeta = {
  downloadedAt: string;
  siteId: string;
  count: number;
};

function cachePaths(siteId: string) {
  const dir = path.join(process.cwd(), ".data");
  return {
    dir,
    dump: path.join(dir, `categories-${siteId}.json`),
    meta: path.join(dir, `categories-${siteId}.meta.json`),
  };
}

function ensureDataDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readCache(siteId: string): Record<string, MlCategoryNode> | null {
  const { dump, meta } = cachePaths(siteId);
  if (!fs.existsSync(dump) || !fs.existsSync(meta)) return null;
  try {
    const metaRaw = JSON.parse(fs.readFileSync(meta, "utf-8")) as DumpCacheMeta;
    const age = Date.now() - new Date(metaRaw.downloadedAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(dump, "utf-8")) as Record<string, MlCategoryNode>;
  } catch {
    return null;
  }
}

function writeCache(siteId: string, dump: Record<string, MlCategoryNode>) {
  const { dir, dump: dumpPath, meta: metaPath } = cachePaths(siteId);
  ensureDataDir(dir);
  fs.writeFileSync(dumpPath, JSON.stringify(dump));
  const meta: DumpCacheMeta = {
    downloadedAt: new Date().toISOString(),
    siteId,
    count: Object.keys(dump).length,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

export async function downloadCategoryDump(
  siteId = DEFAULT_SITE_ID,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, MlCategoryNode>> {
  const cached = readCache(siteId);
  if (cached) return cached;

  const res = await fetchImpl(`${ML_API}/sites/${siteId}/categories/all`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Falha ao baixar dump de categorias: HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  let text: string;
  try {
    text = gunzipSync(buffer).toString("utf-8");
  } catch {
    text = buffer.toString("utf-8");
  }

  const dump = JSON.parse(text) as Record<string, MlCategoryNode>;
  writeCache(siteId, dump);
  return dump;
}

export function extractLeafCategories(
  dump: Record<string, MlCategoryNode>
): LeafCategory[] {
  const leaves: LeafCategory[] = [];
  for (const node of Object.values(dump)) {
    if (!node?.id || !node.name) continue;
    const children = node.children_categories ?? [];
    if (children.length > 0) continue;
    const pathParts = (node.path_from_root ?? []).map((p) => p.name).filter(Boolean);
    const fullPath =
      pathParts.length > 0 ? pathParts.join(" > ") : node.name;
    leaves.push({ id: node.id, name: node.name, path: fullPath });
  }
  return leaves;
}

export async function getLeafCategories(
  siteId = DEFAULT_SITE_ID,
  fetchImpl?: typeof fetch
): Promise<LeafCategory[]> {
  const dump = await downloadCategoryDump(siteId, fetchImpl);
  return extractLeafCategories(dump);
}

/** Rankeia categorias folha por sobreposição de tokens com o texto do produto. */
export function rankLeafCategories(
  leaves: LeafCategory[],
  query: string,
  limit = 40
): LeafCategory[] {
  const tokens = normalizeTokens(query);
  if (!tokens.length) return leaves.slice(0, limit);

  const scored = leaves.map((leaf) => {
    const hay = normalizeTokens(`${leaf.path} ${leaf.name}`);
    let score = 0;
    for (const token of tokens) {
      if (hay.some((h) => h.includes(token) || token.includes(h))) score += 1;
    }
    return { leaf, score };
  });

  scored.sort((a, b) => b.score - a.score || a.leaf.path.localeCompare(b.leaf.path));
  const top = scored.filter((s) => s.score > 0).slice(0, limit);
  if (top.length >= 5) return top.map((s) => s.leaf);
  return leaves.slice(0, limit);
}

function normalizeTokens(text: string): string[] {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
