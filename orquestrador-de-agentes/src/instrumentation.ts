/** Hook de boot do Next.js — roda uma vez quando o processo do servidor sobe. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await validateEncryption();
  const { scheduleRetention } = await import("./lib/telemetry/retention.ts");
  scheduleRetention();

  const { recoverOrphans } = await import("./lib/queue/recovery.ts");
  await recoverOrphans();
  const { start } = await import("./lib/queue/worker.ts");
  start();
}

async function validateEncryption() {
  const { prisma } = await import("./lib/db.ts");
  const { canDecrypt, hasEncryptionKey, isEnvelope } = await import("./lib/crypto/secrets.ts");

  const [provider, mcpServer] = await Promise.all([
    prisma.provider.findFirst({ where: { apiKeyEnc: { not: null } } }),
    prisma.mcpServer.findFirst({
      where: { OR: [{ envEnc: { not: null } }, { headersEnc: { not: null } }] },
    }),
  ]);

  const sampleEnvelope =
    provider && isEnvelope(provider.apiKeyEnc)
      ? { value: provider.apiKeyEnc as string, aad: `Provider:${provider.id}:apiKey` }
      : null;
  const hasCipheredData =
    sampleEnvelope !== null ||
    (mcpServer !== null && (isEnvelope(mcpServer?.envEnc) || isEnvelope(mcpServer?.headersEnc)));

  if (!hasEncryptionKey()) {
    if (hasCipheredData) {
      console.error(
        'ENCRYPTION_KEY ausente. Gere com "npm run generate-key" e defina no .env.',
      );
      process.exit(1);
    }
    // Instalação nova: nada cifrado ainda, segue sem chave até o primeiro segredo ser salvo.
    return;
  }

  if (sampleEnvelope && !canDecrypt(sampleEnvelope.value, sampleEnvelope.aad)) {
    console.error("ENCRYPTION_KEY incorreta para os dados existentes.");
    process.exit(1);
  }
}
