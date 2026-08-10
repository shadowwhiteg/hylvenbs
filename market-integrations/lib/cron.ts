import cron from "node-cron";
import { runCatalogSync } from "@/lib/sync/run";
import { runStockDiffCheck } from "@/lib/sync/stock-diff";

declare global {
  var __mlDropCronStarted: boolean | undefined;
  var __mlDropStockCronStarted: boolean | undefined;
}

export function startSyncCron() {
  if (global.__mlDropCronStarted) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const minutes = Number(process.env.CRON_SYNC_MINUTES || 60);
  const expr = minutes >= 60 ? `0 * * * *` : `*/${Math.max(1, minutes)} * * * *`;

  cron.schedule(expr, () => {
    void runCatalogSync().catch((err) => {
      console.error("[cron] sync failed", err);
    });
  });

  global.__mlDropCronStarted = true;
  console.log(`[cron] catalog sync scheduled: ${expr}`);
}

export function startStockDiffCron() {
  if (global.__mlDropStockCronStarted) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const expr = "0 0,6,12,18 * * *";
  cron.schedule(expr, () => {
    void runStockDiffCheck("cron").catch((err) => {
      console.error("[cron] stock diff failed", err);
    });
  });

  global.__mlDropStockCronStarted = true;
  console.log(`[cron] stock diff scheduled: ${expr}`);
}
