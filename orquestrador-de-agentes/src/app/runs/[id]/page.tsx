import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { RunTrace } from "./run-trace";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.run.findUnique({ where: { id }, select: { id: true, agent: { select: { name: true } } } });
  if (!run) notFound();

  return (
    <>
      <PageHeader
        title={`Execução · ${run.agent.name}`}
        description={run.id}
        action={
          <Link href="/runs" className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        }
      />

      <div className="space-y-4 p-8">
        <RunTrace runId={run.id} />
      </div>
    </>
  );
}
