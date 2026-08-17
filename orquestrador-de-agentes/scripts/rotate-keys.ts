/**
 * Recifra todos os envelopes para a versão corrente de ENCRYPTION_KEY.
 * Exige ENCRYPTION_KEY (nova) e ENCRYPTION_KEY_V<N-1> (a versão anterior, para
 * decifrar o que ainda está nela) — ver design 005. Aborta e não escreve nada
 * se qualquer registro falhar ao decifrar ou recifrar.
 */
import { decrypt, encrypt, envelopeVersion, isEnvelope } from "../src/lib/crypto/secrets";
import { prisma } from "../src/lib/db";

function currentVersion(): number {
  const raw = process.env.ENCRYPTION_KEY_VERSION;
  return raw ? Number.parseInt(raw, 10) : 1;
}

async function rotate<T extends { id: string }>(
  rows: T[],
  fields: { key: keyof T; aad: (row: T) => string }[],
) {
  const target = currentVersion();
  const plan: { id: string; field: string; value: string; aad: string }[] = [];

  for (const row of rows) {
    for (const { key, aad } of fields) {
      const envelope = row[key] as unknown as string | null;
      if (!envelope || !isEnvelope(envelope)) continue;
      if (envelopeVersion(envelope) === target) continue;
      const aadValue = aad(row);
      const plain = decrypt(envelope, aadValue); // lança se a chave antiga estiver ausente/errada
      plan.push({ id: row.id, field: String(key), value: encrypt(plain, aadValue), aad: aadValue });
    }
  }
  return plan;
}

async function main() {
  const providers = await prisma.provider.findMany({ where: { apiKeyEnc: { not: null } } });
  const mcpServers = await prisma.mcpServer.findMany({
    where: { OR: [{ envEnc: { not: null } }, { headersEnc: { not: null } }] },
  });

  const providerPlan = await rotate(providers, [
    { key: "apiKeyEnc", aad: (r) => `Provider:${r.id}:apiKey` },
  ]);
  const mcpPlan = await rotate(mcpServers, [
    { key: "envEnc", aad: (r) => `McpServer:${r.id}:env` },
    { key: "headersEnc", aad: (r) => `McpServer:${r.id}:headers` },
  ]);

  console.log(`${providerPlan.length} campo(s) de Provider e ${mcpPlan.length} de McpServer a recifrar.`);

  await prisma.$transaction([
    ...providerPlan.map((p) => prisma.provider.update({ where: { id: p.id }, data: { [p.field]: p.value } })),
    ...mcpPlan.map((p) => prisma.mcpServer.update({ where: { id: p.id }, data: { [p.field]: p.value } })),
  ]);

  console.log(`Rotação concluída — tudo em v${currentVersion()}.`);
}

main()
  .catch((err) => {
    console.error("Rotação abortada, nada foi escrito:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
