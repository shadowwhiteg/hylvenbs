import { buildPostmanCollection } from "@/lib/api-registry";
import { requireUser } from "@/lib/auth/guard";

export async function GET(request: Request) {
  const guard = await requireUser(request, "authenticated");
  if (!guard.ok) return guard.response;

  return new Response(JSON.stringify(buildPostmanCollection(), null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="orquestrador-de-agentes.postman_collection.json"',
    },
  });
}
