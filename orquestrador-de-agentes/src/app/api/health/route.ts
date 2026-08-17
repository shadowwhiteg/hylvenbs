import { prisma } from "@/lib/db";
import { ok } from "@/lib/http";

const VERSION = process.env.npm_package_version ?? "0.1.0";

/** RQ-ASY-12: fila observável — sem autenticação, como convém a um health check de infra. */
export async function GET() {
  const [depth, running, oldestQueued] = await Promise.all([
    prisma.run.count({ where: { status: "queued" } }),
    prisma.run.count({ where: { status: "running" } }),
    prisma.run.findFirst({ where: { status: "queued" }, orderBy: { queuedAt: "asc" }, select: { queuedAt: true } }),
  ]);

  let dbOk = true;
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    dbOk = false;
  }

  return ok({
    queue: {
      depth,
      running,
      oldestWaitMs: oldestQueued ? Date.now() - oldestQueued.queuedAt.getTime() : 0,
    },
    db: dbOk ? "ok" : "error",
    version: VERSION,
  });
}
