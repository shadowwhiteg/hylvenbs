/**
 * Cifra qualquer valor em claro que tenha parado nas colunas *Enc — por exemplo,
 * um seed ou uma edição manual do banco anterior ao envelope. Idempotente: rodar
 * duas vezes seguidas não altera nada na segunda vez (RQ-SEC-05).
 */
import { encrypt, isEnvelope } from "../src/lib/crypto/secrets";
import { prisma } from "../src/lib/db";

async function migrateProviders() {
  const rows = await prisma.provider.findMany({ where: { apiKeyEnc: { not: null } } });
  let migrated = 0;
  for (const row of rows) {
    if (isEnvelope(row.apiKeyEnc)) continue;
    await prisma.provider.update({
      where: { id: row.id },
      data: { apiKeyEnc: encrypt(row.apiKeyEnc as string, `Provider:${row.id}:apiKey`) },
    });
    migrated++;
  }
  return { total: rows.length, migrated };
}

async function migrateMcpServers() {
  const rows = await prisma.mcpServer.findMany({
    where: { OR: [{ envEnc: { not: null } }, { headersEnc: { not: null } }] },
  });
  let migrated = 0;
  for (const row of rows) {
    const patch: Record<string, string> = {};
    if (row.envEnc && !isEnvelope(row.envEnc)) {
      patch.envEnc = encrypt(row.envEnc, `McpServer:${row.id}:env`);
    }
    if (row.headersEnc && !isEnvelope(row.headersEnc)) {
      patch.headersEnc = encrypt(row.headersEnc, `McpServer:${row.id}:headers`);
    }
    if (Object.keys(patch).length === 0) continue;
    await prisma.mcpServer.update({ where: { id: row.id }, data: patch });
    migrated++;
  }
  return { total: rows.length, migrated };
}

async function main() {
  const providers = await migrateProviders();
  const mcpServers = await migrateMcpServers();

  console.log(`Provider: ${providers.migrated}/${providers.total} cifrados nesta execução.`);
  console.log(`McpServer: ${mcpServers.migrated}/${mcpServers.total} cifrados nesta execução.`);

  const remaining = await prisma.provider.findMany({ where: { apiKeyEnc: { not: null } } });
  const leftoverPlain = remaining.filter((r) => !isEnvelope(r.apiKeyEnc));
  if (leftoverPlain.length > 0) {
    console.error(`${leftoverPlain.length} registro(s) de Provider ainda em claro após a migração.`);
    process.exitCode = 1;
    return;
  }
  console.log("Concluído: nenhum valor em claro restante.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
