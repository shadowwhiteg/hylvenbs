import { requireUser } from "@/lib/auth/guard";
import { listModels } from "@/lib/openai-compat/resolve-model";

/**
 * Catálogo de orquestradores no formato `GET /v1/models` da OpenAI (RQ-OAI-03). Todo
 * `id` devolvido aqui funciona como `model` em POST /api/v1/chat/completions.
 */
export async function GET(request: Request) {
  const guard = await requireUser(request, "agent.read");
  if (!guard.ok) return guard.response;

  const models = await listModels();
  const createdAt = Math.floor(Date.now() / 1000);

  return Response.json({
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: createdAt,
      owned_by: "orquestrador",
      orq: { agent_id: m.agentId, flow_id: m.flowId, published_version: m.publishedVersion, name: m.name },
    })),
  });
}
