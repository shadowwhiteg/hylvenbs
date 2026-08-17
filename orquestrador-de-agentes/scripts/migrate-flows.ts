/**
 * Agrupa cada orquestrador existente (sem fluxo ainda) num Flow com v1 publicada —
 * dado que o versionamento (Fase 5) introduziu depois da Fase 0. Idempotente: um
 * orquestrador que já tem `flowId` é pulado. Subagentes alcançáveis a partir da raiz
 * que ainda não pertencem a nenhum fluxo são atribuídos a esse fluxo (primeiro dono
 * ganha, caso um subagente seja compartilhado por mais de um orquestrador).
 */
import { prisma } from "../src/lib/db.ts";
import { resolveFlowGraph, snapshotContentHash, validateSnapshot } from "../src/lib/flows/snapshot.ts";
import { uniqueFlowSlug } from "../src/lib/flows/slug.ts";

async function main() {
  const orchestrators = await prisma.agent.findMany({
    where: { role: "orchestrator", flowId: null, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  let created = 0;
  let skipped = 0;

  for (const agent of orchestrators) {
    const snapshot = await resolveFlowGraph(agent.id);
    if (!snapshot) {
      skipped++;
      continue;
    }

    const errors = validateSnapshot(snapshot);
    const slug = await uniqueFlowSlug(agent.name);
    const contentHash = snapshotContentHash(snapshot);

    await prisma.$transaction(async (tx) => {
      const flow = await tx.flow.create({
        data: { name: agent.name, slug, rootAgentId: agent.id, status: errors.length > 0 ? "draft" : "published" },
      });

      for (const snapshotAgent of snapshot.agents) {
        await tx.agent.updateMany({ where: { id: snapshotAgent.id, flowId: null }, data: { flowId: flow.id } });
      }

      if (errors.length === 0) {
        const version = await tx.flowVersion.create({
          data: { flowId: flow.id, version: 1, snapshot: JSON.stringify(snapshot), contentHash, message: "Migração automática (Fase 5)" },
        });
        await tx.flow.update({ where: { id: flow.id }, data: { currentVersionId: version.id } });
      }
    });

    created++;
    if (errors.length > 0) {
      console.warn(`Fluxo "${agent.name}" criado como rascunho (sem provedor/modelo em algum agente): ${errors.map((e) => e.message).join(" ")}`);
    }
  }

  console.log(`${created} fluxo(s) criado(s), ${skipped} orquestrador(es) pulado(s) (grafo vazio).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
