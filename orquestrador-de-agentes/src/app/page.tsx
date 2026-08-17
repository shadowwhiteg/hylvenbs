import Link from "next/link";
import { Cpu, GraduationCap, Plug, ScrollText, Workflow } from "lucide-react";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { TUTORIAL_STEPS } from "@/lib/tutorial/content";
import { resolveTutorialProgress } from "@/lib/tutorial/progress";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [providers, orchestrators, agents, subagents, servers, runs, recent, tutorialChecks] = await Promise.all([
    prisma.provider.count({ where: { deletedAt: null } }),
    prisma.agent.count({ where: { role: "orchestrator", deletedAt: null } }),
    prisma.agent.count({ where: { role: "agent", deletedAt: null } }),
    prisma.agent.count({ where: { role: "subagent", deletedAt: null } }),
    prisma.mcpServer.count({ where: { deletedAt: null } }),
    prisma.run.count(),
    prisma.run.findMany({
      include: { agent: { select: { name: true } } },
      orderBy: { queuedAt: "desc" },
      take: 6,
    }),
    resolveTutorialProgress(),
  ]);

  const tutorialDone = TUTORIAL_STEPS.filter((step) => step.checks.every((c) => tutorialChecks[c]));
  const firstPending = TUTORIAL_STEPS.find((step) => !step.checks.every((c) => tutorialChecks[c]));

  const stats = [
    { label: "Provedores", value: providers, href: "/providers", icon: Cpu },
    { label: "Orquestradores", value: orchestrators, href: "/agents", icon: Workflow },
    { label: "Agentes", value: agents, href: "/agents", icon: Workflow },
    { label: "Subagentes", value: subagents, href: "/agents", icon: Workflow },
    { label: "Servidores MCP", value: servers, href: "/mcp", icon: Plug },
    { label: "Execuções", value: runs, href: "/runs", icon: ScrollText },
  ];

  return (
    <>
      <PageHeader
        title="Painel"
        description="Visão geral da plataforma de orquestração de agentes."
      />

      <div className="space-y-4 p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {stats.map(({ label, value, href, icon: Icon }) => (
            <Link key={label} href={href}>
              <Card className="p-5 transition hover:border-border-strong">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg-muted">{label}</span>
                  <Icon className="size-4 text-accent" />
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Execuções recentes" subtitle="Últimas 6 execuções" />
            {recent.length === 0 ? (
              <EmptyState
                title="Nada executado ainda"
                description="Configure um provedor, crie um orquestrador e rode-o pelo Playground."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((run) => (
                  <li key={run.id}>
                    <Link
                      href={`/runs/${run.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-surface-hover"
                    >
                      <Badge
                        tone={
                          run.status === "succeeded" ? "success" : run.status === "failed" ? "danger" : "warning"
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{run.agent.name}</span>
                        <span className="block truncate text-xs text-fg-muted">{run.input}</span>
                      </span>
                      <span className="text-[11px] text-fg-muted">
                        {run.queuedAt.toLocaleString("pt-BR")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <GraduationCap className="size-4" /> Tutorial
                </span>
              }
              subtitle={`${tutorialDone.length}/${TUTORIAL_STEPS.length} passos concluídos`}
              action={
                <Link href="/tutorial" className="text-xs text-accent hover:underline">
                  ver tudo →
                </Link>
              }
            />
            {firstPending ? (
              <div className="p-5">
                <p className="mb-1 text-xs text-fg-muted">Próximo passo</p>
                <Link
                  href={`/tutorial#${firstPending.id}`}
                  className="block rounded-lg border border-border p-4 transition hover:border-border-strong hover:bg-surface-hover"
                >
                  <p className="text-sm font-medium">{firstPending.title}</p>
                  <p className="mt-1 text-xs text-fg-muted">{firstPending.goal}</p>
                </Link>
              </div>
            ) : (
              <EmptyState
                title="Tutorial completo"
                description="Todos os passos da plataforma foram concluídos neste ambiente."
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
