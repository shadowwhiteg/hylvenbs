import { requireUser } from "@/lib/auth/guard";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { ok } from "@/lib/http";

const ALL_PERMISSIONS: Permission[] = [
  "user.manage",
  "audit.read",
  "settings.manage",
  "provider.write",
  "secret.write",
  "provider.read",
  "mcp.write",
  "mcp.probe",
  "mcp.read",
  "agent.write",
  "agent.read",
  "flow.read",
  "flow.write",
  "flow.publish",
  "flow.rollback",
  "policy.read",
  "policy.write",
  "run.create",
  "run.cancel",
  "run.read",
  "token.self",
];

export async function GET(request: Request) {
  const guard = await requireUser(request, "authenticated", { allowPasswordChangeRequired: true });
  if (!guard.ok) return guard.response;

  const { user } = guard;
  return ok({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    permissions: ALL_PERMISSIONS.filter((p) => hasPermission(user.role, p)),
  });
}
