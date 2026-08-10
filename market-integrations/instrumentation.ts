export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSyncCron, startStockDiffCron } = await import("@/lib/cron");
    startSyncCron();
    startStockDiffCron();

    const { startTunnelIfNeeded } = await import("@/lib/tunnel/manager");
    startTunnelIfNeeded();
  }
}
