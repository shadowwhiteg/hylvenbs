import { API_ENDPOINTS } from "../api-registry.ts";

export type Role = "admin" | "editor" | "viewer";

export type Permission =
  | "public"
  | "authenticated"
  | "user.manage"
  | "audit.read"
  | "settings.manage"
  | "provider.write"
  | "secret.write"
  | "provider.read"
  | "mcp.write"
  | "mcp.probe"
  | "mcp.read"
  | "agent.write"
  | "agent.read"
  | "flow.read"
  | "flow.write"
  | "flow.publish"
  | "flow.rollback"
  | "policy.read"
  | "policy.write"
  | "run.create"
  | "run.cancel"
  | "run.read"
  | "token.self";

/** Matriz da matriz de permissões do design 001 — admin sempre tem tudo. */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set([
    "authenticated",
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
  ]),
  editor: new Set([
    "authenticated",
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
  ]),
  viewer: new Set([
    "authenticated",
    "provider.read",
    "mcp.read",
    "agent.read",
    "flow.read",
    "policy.read",
    "run.read",
    "token.self",
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  if (permission === "public") return true;
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Converte "/api/agents/:id" num regex que casa "/api/agents/abc123". */
function pathToRegex(path: string): RegExp {
  const pattern = path
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${pattern}$`);
}

const ROUTE_TABLE = API_ENDPOINTS.map((e) => ({ ...e, regex: pathToRegex(e.path) }));

/**
 * Resolve a permissão exigida por uma rota. Rota fora do api-registry devolve
 * `undefined` — o chamador (guard.ts) deve tratar isso como "exige admin"
 * (negar por omissão, RQ-AUTH-07), nunca como liberado.
 */
export function permissionForRoute(method: string, pathname: string): Permission | undefined {
  const entry = ROUTE_TABLE.find((e) => e.method === method && e.regex.test(pathname));
  return entry?.permission;
}
