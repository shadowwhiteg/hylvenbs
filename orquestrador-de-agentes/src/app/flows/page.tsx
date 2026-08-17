"use client";

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui";
import { api, type FlowDto } from "@/lib/client";

const STATUS_TONE = { draft: "neutral", published: "success", archived: "neutral" } as const;

export default function FlowsPage() {
  const [flows, setFlows] = useState<FlowDto[] | null>(null);

  useEffect(() => {
    api.get<FlowDto[]>("/api/flows").then(setFlows);
  }, []);

  return (
    <>
      <PageHeader
        title="Fluxos"
        description="Cada orquestrador é a raiz de um fluxo — publique versões para fixar a topologia usada nas execuções."
      />
      <div className="space-y-3 p-8">
        {!flows ? (
          <Card>
            <div className="flex items-center justify-center p-10">
              <Spinner />
            </div>
          </Card>
        ) : flows.length === 0 ? (
          <Card>
            <EmptyState
              title="Nenhum fluxo ainda"
              description="Crie um agente orquestrador em Agentes — o fluxo é criado junto, automaticamente."
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {flows.map((flow) => (
              <Link key={flow.id} href={`/flows/${flow.id}`}>
                <Card className="h-full p-5 transition hover:border-accent/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <GitBranch className="size-4 shrink-0 text-fg-muted" />
                      <span className="text-sm font-semibold">{flow.name}</span>
                    </div>
                    <Badge tone={STATUS_TONE[flow.status]}>{flow.status}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{flow.description || "Sem descrição."}</p>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-fg-muted">
                    {flow.currentVersion ? (
                      <Badge tone="accent">v{flow.currentVersion.version}{flow.currentVersion.tag ? ` · ${flow.currentVersion.tag}` : ""}</Badge>
                    ) : (
                      <Badge>nunca publicado</Badge>
                    )}
                    <span>{flow.versionCount ?? 0} versão(ões)</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
