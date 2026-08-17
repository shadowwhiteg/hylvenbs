import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  queued: "neutral",
  running: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  timed_out: "danger",
} as const;

/** Canal que disparou a run (RQ-OAI-11) — "quanto do tráfego vem de fora". */
const SOURCE_TONE: Record<string, "neutral" | "accent"> = { ui: "neutral", api: "accent", openai: "accent" };

function duration(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  return `${((end.getTime() - start.getTime()) / 1000).toFixed(1)}s`;
}

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const [runs, counts] = await Promise.all([
    prisma.run.findMany({
      where: status ? { status } : undefined,
      include: {
        agent: { select: { name: true, role: true } },
        flowVersion: { select: { version: true } },
        _count: { select: { spans: true } },
      },
      orderBy: { queuedAt: "desc" },
      take: 100,
    }),
    prisma.run.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const countByStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const total = Object.values(countByStatus).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Execuções" description="Fila e trace de cada execução do orquestrador." />
      <div className="space-y-4 p-8">
        <div className="flex flex-wrap gap-2">
          <Link href="/runs">
            <Badge tone={!status ? "accent" : "neutral"}>todas ({total})</Badge>
          </Link>
          {(Object.keys(STATUS_TONE) as (keyof typeof STATUS_TONE)[]).map((s) => (
            <Link key={s} href={`/runs?status=${s}`}>
              <Badge tone={status === s ? "accent" : STATUS_TONE[s]}>
                {s} ({countByStatus[s] ?? 0})
              </Badge>
            </Link>
          ))}
        </div>

        <Card>
          {runs.length === 0 ? (
            <EmptyState
              title="Nenhuma execução ainda"
              description="Rode um agente pelo Playground para ver o trace aparecer aqui."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-fg-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Agente</th>
                  <th className="px-5 py-3 font-medium">Entrada</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Origem</th>
                  <th className="px-5 py-3 font-medium">Versão</th>
                  <th className="px-5 py-3 font-medium">Spans</th>
                  <th className="px-5 py-3 font-medium">Tokens</th>
                  <th className="px-5 py-3 font-medium">Custo</th>
                  <th className="px-5 py-3 font-medium">Duração</th>
                  <th className="px-5 py-3 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                    <td className="px-5 py-3">
                      <Link href={`/runs/${run.id}`} className="font-medium text-accent hover:underline">
                        {run.agent.name}
                      </Link>
                    </td>
                    <td className="max-w-xs truncate px-5 py-3 text-fg-muted">{run.input}</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[run.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={SOURCE_TONE[run.source] ?? "neutral"}>{run.source}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <Badge>{run.flowVersion ? `v${run.flowVersion.version}` : "rascunho"}</Badge>
                        {run.configDrift ? <Badge tone="warning">drift</Badge> : null}
                        {run.modelFailover ? <Badge tone="warning">failover</Badge> : null}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-fg-muted">{run._count.spans}</td>
                    <td className="px-5 py-3 font-mono text-xs text-fg-muted">
                      {run.inputTokens}/{run.outputTokens}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-fg-muted">
                      {run.costUsd != null ? `~$${run.costUsd.toFixed(4)}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-fg-muted">{duration(run.startedAt, run.endedAt)}</td>
                    <td className="px-5 py-3 text-xs text-fg-muted">{run.queuedAt.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
