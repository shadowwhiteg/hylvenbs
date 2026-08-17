import { prisma } from "../db.ts";

function baseSlug(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "fluxo";
}

/** Gera um slug único para `Flow.slug`, adicionando sufixo numérico em caso de colisão. */
export async function uniqueFlowSlug(name: string): Promise<string> {
  const base = baseSlug(name);
  let candidate = base;
  let n = 2;
  while (await prisma.flow.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}
