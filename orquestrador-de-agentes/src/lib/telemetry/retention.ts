import { prisma } from "../db.ts";
import { getSettingNumber } from "../settings.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const VACUUM_INTERVAL_MS = 7 * DAY_MS;
let lastVacuumAt = 0;

/**
 * Apaga Span/LogEntry além de `telemetry.retentionDays` e mantém Run com os totais
 * já agregados — o histórico de "o que rodou e como terminou" sobrevive, o detalhe
 * caro não (RQ-OBS-08). VACUUM semanal, best-effort.
 */
export async function runRetention(): Promise<void> {
  try {
    const retentionDays = await getSettingNumber("telemetry.retentionDays");
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    await prisma.logEntry.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await prisma.span.deleteMany({ where: { startedAt: { lt: cutoff } } });

    if (Date.now() - lastVacuumAt > VACUUM_INTERVAL_MS) {
      lastVacuumAt = Date.now();
      await prisma.$executeRawUnsafe("VACUUM;");
    }
  } catch (err) {
    console.error("[telemetry] falha na rotina de retenção:", err);
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Agenda a rotina diária. Instância única, in-process (T3) — sem coordenação entre réplicas. */
export function scheduleRetention(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => void runRetention(), DAY_MS);
  if (typeof intervalHandle.unref === "function") intervalHandle.unref();
  void runRetention();
}
