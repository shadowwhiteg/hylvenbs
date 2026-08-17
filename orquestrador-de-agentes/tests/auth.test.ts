import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { hashPassword, verifyPassword } = await import("../src/lib/auth/password.ts");
const { hasPermission, permissionForRoute } = await import("../src/lib/auth/permissions.ts");
const { API_ENDPOINTS } = await import("../src/lib/api-registry.ts");
const { createSession, resolveSession, revokeSession, hashToken } = await import("../src/lib/auth/session.ts");
const { prisma } = await import("../src/lib/db.ts");

// guard.ts importa "next/server" (NextResponse), que só resolve sob o bundler do
// Next — não sob node --test puro. O comportamento de requireUser() é coberto por
// smoke test HTTP contra o servidor real (ver verificação manual da Fase 2).

test("hash de senha: ida e volta, senha errada falha", () => {
  const hash = hashPassword("segredo-forte-123");
  assert.equal(verifyPassword("segredo-forte-123", hash), true);
  assert.equal(verifyPassword("errada", hash), false);
  assert.match(hash, /^scrypt\$N=32768,r=8,p=1\$/);
});

test("verifyPassword nunca lança para formato inválido", () => {
  assert.equal(verifyPassword("qualquer", "não é um hash"), false);
  assert.equal(verifyPassword("qualquer", ""), false);
});

test("matriz de permissões: admin tem tudo, viewer só leitura", () => {
  assert.equal(hasPermission("admin", "user.manage"), true);
  assert.equal(hasPermission("editor", "user.manage"), false);
  assert.equal(hasPermission("viewer", "mcp.write"), false);
  assert.equal(hasPermission("editor", "mcp.write"), true);
  assert.equal(hasPermission("viewer", "agent.read"), true);
});

test("toda rota do api-registry declara uma permissão válida", () => {
  const valid = new Set([
    "public",
    "authenticated",
    "user.manage",
    "audit.read",
    "settings.manage",
    "provider.write",
    "secret.write",
    "provider.read",
    "mcp.write",
    "mcp.probe",
    "mcp.read",
    "agent.write",
    "agent.read",
    "flow.read",
    "flow.write",
    "flow.publish",
    "flow.rollback",
    "policy.read",
    "policy.write",
    "run.create",
    "run.cancel",
    "run.read",
    "token.self",
  ]);
  for (const endpoint of API_ENDPOINTS) {
    assert.ok(
      valid.has(endpoint.permission),
      `${endpoint.method} ${endpoint.path} tem permissão inválida: ${endpoint.permission}`,
    );
  }
});

test("permissionForRoute resolve rotas com :id e devolve undefined fora do registro", () => {
  assert.equal(permissionForRoute("GET", "/api/agents"), "agent.read");
  assert.equal(permissionForRoute("POST", "/api/runs"), "run.create");
  assert.equal(permissionForRoute("PATCH", "/api/agents/abc123"), "agent.write");
  assert.equal(permissionForRoute("GET", "/api/rota-inexistente"), undefined);
});

test("sessão: criar, resolver e revogar", async () => {
  const user = await prisma.user.create({
    data: { email: "sessao@teste.com", name: "Sessão", passwordHash: hashPassword("x12345678"), role: "editor" },
  });

  const { token } = await createSession(user.id, { userAgent: "test", ip: "127.0.0.1" });
  const resolved = await resolveSession(token);
  assert.equal(resolved?.userId, user.id);

  await revokeSession(token);
  assert.equal(await resolveSession(token), null);
});

test("token de API hasheado nunca é igual ao token em claro no banco", async () => {
  const user = await prisma.user.create({
    data: { email: "token@teste.com", name: "Token", passwordHash: hashPassword("x12345678"), role: "admin" },
  });
  const raw = "oaa_teste_sentinela";
  await prisma.apiToken.create({
    data: { userId: user.id, name: "t", prefix: raw.slice(0, 8), tokenHash: hashToken(raw) },
  });
  const row = await prisma.apiToken.findFirstOrThrow({ where: { userId: user.id } });
  assert.notEqual(row.tokenHash, raw);
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
