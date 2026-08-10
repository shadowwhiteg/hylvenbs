import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractProductIdentifiers, findCatalogMatch } from "@/lib/ml/catalog";
import { markUserEdited, parseUserEdited } from "@/lib/sync/merge";

type CatalogMatchBody = {
  apply?: boolean;
  catalogProductId?: string | null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  let body: CatalogMatchBody = {};
  try {
    const raw = (await req.text()).trim();
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
      }
      body = parsed as CatalogMatchBody;
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

  try {
    if (body.apply === true) {
      if (
        body.catalogProductId !== undefined &&
        body.catalogProductId !== null &&
        typeof body.catalogProductId !== "string"
      ) {
        return NextResponse.json({ error: "catalogProductId inválido" }, { status: 400 });
      }
      const catalogProductId = (body.catalogProductId || "").trim() || null;
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: {
          catalogProductId,
          userEditedJson: markUserEdited(draft.userEditedJson, ["catalogProductId"]),
        },
      });
      return NextResponse.json({ applied: true, catalogProductId });
    }

    const identifiers = extractProductIdentifiers({
      attributesJson: product.attributesJson,
      description: product.description,
    });

    const match = await findCatalogMatch({
      title: draft.title || product.title,
      gtin: identifiers.gtin,
      brand: identifiers.brand,
      model: identifiers.model,
    });

    const edited = parseUserEdited(draft.userEditedJson);
    const canAutoApply =
      match.confident &&
      Boolean(match.bestMatch) &&
      !draft.catalogProductId &&
      !edited.catalogProductId;

    await prisma.listingDraft.update({
      where: { id: draft.id },
      data: {
        catalogSuggestionJson: JSON.stringify({
          suggestions: match.suggestions,
          bestMatch: match.bestMatch,
          confident: match.confident,
          checkedAt: new Date().toISOString(),
        }),
        ...(canAutoApply
          ? { catalogProductId: match.bestMatch?.catalogProductId ?? null }
          : {}),
      },
    });

    return NextResponse.json({
      suggestions: match.suggestions,
      bestMatch: match.bestMatch,
      confident: match.confident,
      applied: canAutoApply,
      warnings: match.warnings,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao consultar o catálogo do Mercado Livre: ${detail}` },
      { status: 500 }
    );
  }
}
