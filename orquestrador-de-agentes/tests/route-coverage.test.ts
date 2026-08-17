import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { API_ENDPOINTS } from "../src/lib/api-registry.ts";

/**
 * Toda rota implementada em src/app/api precisa de uma entrada no api-registry —
 * senão o middleware nega por omissão (bom) mas silenciosamente, e ninguém percebe
 * até um usuário real bater numa rota "esquecida". Isso já aconteceu uma vez com
 * GET /api/setup; este teste existe para não acontecer de novo.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const METHOD_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/g;

function routeFileToPath(file: string): string {
  return file
    .replace(/^src\/app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[([^\]]+)]/g, ":$1");
}

test("toda rota implementada em src/app/api está registrada no api-registry", () => {
  const files = globSync("src/app/api/**/route.ts", { cwd: ROOT });
  const registered = new Set(API_ENDPOINTS.map((e) => `${e.method} ${e.path}`));
  const missing: string[] = [];

  for (const file of files) {
    const content = readFileSync(path.join(ROOT, file), "utf8");
    const routePath = routeFileToPath(file);
    for (const match of content.matchAll(METHOD_RE)) {
      const key = `${match[1]} ${routePath}`;
      if (!registered.has(key)) missing.push(key);
    }
  }

  assert.deepEqual(missing, []);
});

test("todo endpoint do api-registry corresponde a um handler existente", () => {
  const files = globSync("src/app/api/**/route.ts", { cwd: ROOT });
  const implemented = new Set<string>();
  for (const file of files) {
    const content = readFileSync(path.join(ROOT, file), "utf8");
    const routePath = routeFileToPath(file);
    for (const match of content.matchAll(METHOD_RE)) implemented.add(`${match[1]} ${routePath}`);
  }

  const missingHandlers = API_ENDPOINTS.map((e) => `${e.method} ${e.path}`).filter((k) => !implemented.has(k));
  assert.deepEqual(missingHandlers, []);
});
