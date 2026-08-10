import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Mercado Livre envia POST; devemos responder HTTP 200 em < 500ms. */
export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // Ack imediato — processamento pesado fica fora do request (spec ML)
  console.info("[ml-notification]", JSON.stringify(body));

  // Persistência leve para debug futuro (tabela opcional via log only por enquanto)
  void persistNotification(body).catch((err) => {
    console.error("[ml-notification] persist error", err);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

/** ML também pode testar com GET no simulador de notificações */
export async function GET() {
  return NextResponse.json({ ok: true, service: "ml-notifications" }, { status: 200 });
}

async function persistNotification(body: unknown) {
  if (!body || typeof body !== "object") return;
  const n = body as Record<string, unknown>;
  const topic = typeof n.topic === "string" ? n.topic : "unknown";
  const resource = typeof n.resource === "string" ? n.resource : "";
  const userId = n.user_id != null ? String(n.user_id) : null;

  // Reusa SyncRun como log genérico seria wrong — apenas log por MVP
  // Futuro: tabela MlNotification
  await prisma.syncRun.create({
    data: {
      status: `notif:${topic}`,
      error: JSON.stringify({ resource, userId, body }).slice(0, 2000),
      finishedAt: new Date(),
    },
  });
}
