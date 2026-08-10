import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fillAttributesWithAi,
  mergeAttributes,
  parseAttributeList,
  toScrapedAttributes,
} from "@/lib/agent/attributes";
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

  try {
    const scraped = parseAttributeList(product.attributesJson);
    const existing = parseAttributeList(draft.attributes);

    const result = await fillAttributesWithAi({
      title: draft.title || product.title,
      description: draft.description || product.description,
      scrapedAttributes: toScrapedAttributes(scraped.length ? scraped : existing),
      categoryPath: product.categoryPath,
    });

    const attributes = mergeAttributes(existing, result.attributes);
    const applied = apply && result.attributes.length > 0;

    if (applied) {
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: {
          attributes: JSON.stringify(attributes),
          userEditedJson: markUserEdited(draft.userEditedJson, ["attributes"]),
        },
      });
    }

    return NextResponse.json({
      attributes,
      applied,
      model: result.model,
      warnings: result.warnings,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao preencher características com IA: ${detail}` },
      { status: 500 }
    );
  }
}
