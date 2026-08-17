import { prisma } from "./db.ts";

/** Ajustes com valor padrão de código; qualquer linha em Setting sobrepõe o padrão. */
const DEFAULTS = {
  "queue.concurrency": "3",
  "telemetry.retentionDays": "30",
} as const;

type SettingKey = keyof typeof DEFAULTS;

let cache: Map<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5_000;

async function loadCache(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  const rows = await prisma.setting.findMany();
  cache = new Map(rows.map((r) => [r.key, r.value]));
  cacheLoadedAt = now;
  return cache;
}

export async function getSetting(key: SettingKey): Promise<string> {
  const map = await loadCache();
  return map.get(key) ?? DEFAULTS[key];
}

export async function getSettingNumber(key: SettingKey): Promise<number> {
  return Number.parseFloat(await getSetting(key));
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  cache = null; // próxima leitura recarrega — alteração reflete sem reiniciar
}

export async function listSettings(): Promise<Record<string, string>> {
  const map = await loadCache();
  const out: Record<string, string> = { ...DEFAULTS };
  for (const [k, v] of map) out[k] = v;
  return out;
}
