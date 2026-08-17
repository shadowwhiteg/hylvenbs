import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { encrypt } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db";
import { handleError, ok, parseBody } from "@/lib/http";
import { serializeProvider } from "@/lib/serialize";

const createSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["anthropic", "openai", "openai-compatible"]),
  baseUrl: z.string().url().nullish(),
  apiKey: z.string().nullish(),
  models: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

export async function GET(request: Request) {
  const guard = await requireUser(request, "provider.read");
  if (!guard.ok) return guard.response;

  const rows = await prisma.provider.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  return ok(rows.map(serializeProvider));
}

export async function POST(request: Request) {
  const guard = await requireUser(request, "secret.write");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, createSchema);
  if (error) return error;

  try {
    const id = randomUUID();
    const row = await prisma.provider.create({
      data: {
        id,
        name: data.name,
        kind: data.kind,
        baseUrl: data.baseUrl ?? null,
        apiKeyEnc: data.apiKey ? encrypt(data.apiKey, `Provider:${id}:apiKey`) : null,
        models: JSON.stringify(data.models),
        enabled: data.enabled,
        createdById: guard.user.id,
        updatedById: guard.user.id,
      },
    });
    await audit({ actorId: guard.user.id, action: "provider.created", targetType: "provider", targetId: row.id });
    return ok(serializeProvider(row), 201);
  } catch (err) {
    return handleError(err);
  }
}
