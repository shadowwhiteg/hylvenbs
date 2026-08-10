import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateMlTitleWithAi, isValidMlTitle, mlTitleNeedsAi } from "@/lib/agent/title";
import { markUserEdited } from "@/lib/sync/merge";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  let apply = true;
  try {
    const raw = (await req.text()).trim();
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
      }
      const { apply: applyInput } = parsed as { apply?: unknown };
      if (applyInput !== undefined) apply = Boolean(applyInput);
    }
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id },
    include: { draft: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }
  if (!product.draft) {
    return NextResponse.json(
      { error: "Rascunho de anúncio não encontrado para este produto" },
      { status: 404 }
    );
  }
  const draft = product.draft;

  if (!mlTitleNeedsAi(product.title)) {
    const title = product.title.trim();
    if (apply) {
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: {
          title,
          userEditedJson: markUserEdited(draft.userEditedJson, ["title"]),
        },
      });
    }
    return NextResponse.json({
      title,
      originalTitle: product.title,
      applied: apply,
      source: "original",
      warnings: [],
    });
  }

  try {
    const result = await generateMlTitleWithAi({
      originalTitle: product.title,
      description: draft.description || product.description,
      categoryPath: product.categoryPath,
    });

    if (!isValidMlTitle(result.title)) {
      return NextResponse.json(
        { error: "IA não gerou um título válido para o Mercado Livre" },
        { status: 502 }
      );
    }

    if (apply) {
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: {
          title: result.title,
          userEditedJson: markUserEdited(draft.userEditedJson, ["title"]),
        },
      });
    }

    return NextResponse.json({
      title: result.title,
      originalTitle: product.title,
      applied: apply,
      source: "ai",
      warnings: result.warnings,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao gerar título com IA: ${detail}` },
      { status: 500 }
    );
  }
}
