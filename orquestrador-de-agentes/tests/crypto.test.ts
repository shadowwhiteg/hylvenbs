import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64url");

const { decrypt, encrypt, isEnvelope, mask } = await import("../src/lib/crypto/secrets.ts");

test("ida e volta preserva o valor original", () => {
  const plain = "sk-ant-super-secreta-123";
  const envelope = encrypt(plain, "Provider:p1:apiKey");
  assert.equal(decrypt(envelope, "Provider:p1:apiKey"), plain);
});

test("envelope tem o formato v<versão>:iv:tag:ciphertext", () => {
  const envelope = encrypt("x", "aad");
  assert.match(envelope, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
});

test("cada cifra usa um IV novo — dois envelopes do mesmo valor divergem", () => {
  const a = encrypt("mesmo valor", "aad");
  const b = encrypt("mesmo valor", "aad");
  assert.notEqual(a, b);
});

test("adulterar o ciphertext falha na verificação da tag", () => {
  const envelope = encrypt("valor", "aad");
  const [v, iv, tag, ct] = envelope.split(":");
  const tampered = `${v}:${iv}:${tag}:${ct.slice(0, -2)}${ct.at(-2) === "A" ? "B" : "A"}${ct.at(-1)}`;
  assert.throws(() => decrypt(tampered, "aad"));
});

test("AAD trocado falha mesmo com ciphertext intacto", () => {
  const envelope = encrypt("valor", "Provider:p1:apiKey");
  assert.throws(() => decrypt(envelope, "Provider:p2:apiKey"));
});

test("isEnvelope distingue envelope de texto legado", () => {
  assert.equal(isEnvelope(encrypt("x", "aad")), true);
  assert.equal(isEnvelope("sk-plaintext-antigo"), false);
  assert.equal(isEnvelope(null), false);
  assert.equal(isEnvelope(""), false);
});

test("mask preserva só as bordas", () => {
  assert.equal(mask("sk-ant-abcdefgh1234"), "sk-a••••1234");
  assert.equal(mask("abc"), "••••");
  assert.equal(mask(null), null);
});

test("decifrar sem a chave lança erro acionável", () => {
  const envelope = encrypt("valor", "aad");
  const saved = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  try {
    assert.throws(() => decrypt(envelope, "aad"), /ENCRYPTION_KEY ausente/);
  } finally {
    process.env.ENCRYPTION_KEY = saved;
  }
});
