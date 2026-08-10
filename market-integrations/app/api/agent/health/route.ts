import { NextResponse } from "next/server";
import { checkAiHealth } from "@/lib/agent/chat";

export async function GET() {
  const health = await checkAiHealth();
  return NextResponse.json(health);
}
