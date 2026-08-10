import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { suggestKits, type SuggestionCandidate } from "@/lib/agent/kit-suggestions";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const maxSuggestions = Number(body.maxSuggestions) > 0 ? Number(body.maxSuggestions) : 5;

  // Sem seleção explícita, considera os anúncios ativos já importados.
  const listings = await prisma.mlListing.findMany({
    where: ids.length ? { id: { in: ids } } : { status: "active" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, price: true, categoryId: true },
  });

  if (!listings.length) {
    return NextResponse.json(
      { error: 'Nenhum anúncio importado. Clique em "Atualizar agora" primeiro.' },
      { status: 400 }
    );
  }

  const candidates: SuggestionCandidate[] = listings.map((l) => ({
    id: l.id,
    title: l.title,
    price: l.price,
    categoryId: l.categoryId,
  }));

  try {
    const result = await suggestKits(candidates, { maxSuggestions });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
