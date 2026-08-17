import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const { encrypt } = await import("../src/lib/crypto/secrets.ts");
const { serializeMcpServer, serializeProvider } = await import("../src/lib/serialize.ts");
const { buildPostmanCollection } = await import("../src/lib/api-registry.ts");

const SENTINEL_KEY = "sk-sentinel-9f3a7c21";
const SENTINEL_ENV = "sentinel-env-value-77aa";

test("segredo cadastrado não aparece na serialização da API", async () => {
  const provider = await prisma.provider.create({
    data: {
      id: "test-provider-1",
      name: "Sentinela",
      kind: "anthropic",
      apiKeyEnc: encrypt(SENTINEL_KEY, "Provider:test-provider-1:apiKey"),
    },
  });
  const mcp = await prisma.mcpServer.create({
    data: {
      id: "test-mcp-1",
      name: "sentinela",
      command: "true",
      envEnc: encrypt(JSON.stringify({ TOKEN: SENTINEL_ENV }), "McpServer:test-mcp-1:env"),
      envKeys: JSON.stringify(["TOKEN"]),
    },
  });

  const providerJson = JSON.stringify(serializeProvider(provider));
  const mcpJson = JSON.stringify(serializeMcpServer(mcp));

  assert.doesNotMatch(providerJson, new RegExp(SENTINEL_KEY));
  assert.doesNotMatch(mcpJson, new RegExp(SENTINEL_ENV));
  assert.equal(serializeProvider(provider).hasApiKey, true);
});

test("valor cifrado no banco não contém o segredo em claro", async () => {
  const row = await prisma.provider.findUniqueOrThrow({ where: { id: "test-provider-1" } });
  assert.ok(row.apiKeyEnc);
  assert.doesNotMatch(row.apiKeyEnc as string, new RegExp(SENTINEL_KEY));
});

test("a Postman Collection não embute segredos, só variáveis", () => {
  const collection = JSON.stringify(buildPostmanCollection());
  assert.doesNotMatch(collection, new RegExp(SENTINEL_KEY));
  assert.doesNotMatch(collection, new RegExp(SENTINEL_ENV));
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
