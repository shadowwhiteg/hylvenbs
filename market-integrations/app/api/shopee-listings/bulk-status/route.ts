import { NextRequest, NextResponse } from "next/server";
import { applyShopeeBulkStatus } from "@/lib/shopee/promotions-sync";

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const status = body.status === "active" || body.status === "paused" ? body.status : undefined;

  if (!ids.length) {
    return NextResponse.json({ error: "ids obrigatório" }, { status: 400 });
  }
  if (!status) {
    return NextResponse.json({ error: "status deve ser 'active' ou 'paused'" }, { status: 400 });
  }

  const result = await applyShopeeBulkStatus({ ids, status });
  return NextResponse.json({ ok: true, ...result });
}
