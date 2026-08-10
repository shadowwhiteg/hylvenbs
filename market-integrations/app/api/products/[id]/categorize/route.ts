import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { categorizeProduct } from "@/lib/ml/categorize-product";
import { markUserEdited } from "@/lib/sync/merge";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  let apply = true;
  let allowAiFallback = true;
  try {
    const raw = (await req.text()).trim();
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
      }
      const body = parsed as { apply?: unknown; allowAiFallback?: unknown };
      if (body.apply !== undefined) apply = Boolean(body.apply);
      if (body.allowAiFallback !== undefined) allowAiFallback = Boolean(body.allowAiFallback);
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
  const title = (draft.title || product.title).trim();
  if (!title) {
    return NextResponse.json({ error: "Produto sem título para categorizar" }, { status: 400 });
  }

  try {
    const result = await categorizeProduct({
      title,
      description: draft.description || product.description,
      categoryPath: product.categoryPath,
      allowAiFallback,
    });

    if (!result.categoryId) {
      return NextResponse.json(
        {
          error: "Não foi possível categorizar o produto",
          warnings: result.warnings,
          suggestions: result.suggestions,
        },
        { status: 502 }
      );
    }

    if (apply) {
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: {
          categoryId: result.categoryId,
          userEditedJson: markUserEdited(draft.userEditedJson, ["categoryId"]),
        },
      });
    }

    return NextResponse.json({
      categoryId: result.categoryId,
      categoryName: result.categoryName,
      categoryPath: result.categoryPath,
      source: result.source,
      suggestions: result.suggestions,
      applied: apply,
      warnings: result.warnings,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao categorizar produto: ${detail}` },
      { status: 500 }
    );
  }
}
