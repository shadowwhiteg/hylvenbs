"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Boxes,
  Cpu,
  GitBranch,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Plug,
  Route,
  ScrollText,
  Users,
  Workflow,
} from "lucide-react";
import type { Permission } from "@/lib/api-registry";
import { can, useMe } from "@/lib/auth-client";
import { ThemeToggle } from "./theme";

const LINKS: { href: string; label: string; icon: typeof LayoutDashboard; permission: Permission }[] = [
  { href: "/", label: "Painel", icon: LayoutDashboard, permission: "authenticated" },
  { href: "/tutorial", label: "Tutorial", icon: GraduationCap, permission: "authenticated" },
  { href: "/agents", label: "Agentes", icon: Workflow, permission: "agent.read" },
  { href: "/flows", label: "Fluxos", icon: GitBranch, permission: "flow.read" },
  { href: "/providers", label: "Provedores", icon: Cpu, permission: "provider.read" },
  { href: "/mcp", label: "Servidores MCP", icon: Plug, permission: "mcp.read" },
  { href: "/model-policies", label: "Roteamento", icon: Route, permission: "policy.read" },
  { href: "/runs", label: "Execuções", icon: ScrollText, permission: "run.read" },
  { href: "/api", label: "API & Postman", icon: Boxes, permission: "authenticated" },
  { href: "/conta/tokens", label: "Meus tokens", icon: KeyRound, permission: "token.self" },
  { href: "/admin/usuarios", label: "Usuários", icon: Users, permission: "user.manage" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-8 place-items-center rounded-lg bg-accent text-accent-fg">
          <Workflow className="size-4" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Orquestrador</p>
          <p className="text-[11px] text-fg-muted">de agentes</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {LINKS.filter(({ permission }) => can(me, permission)).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {me ? (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium text-fg">{me.name}</p>
              <p className="truncate text-[11px] text-fg-muted">{me.role}</p>
            </div>
            <button
              type="button"
              title="Sair"
              aria-label="Sair"
              onClick={logout}
              className="rounded-md p-1.5 text-fg-muted transition hover:bg-surface-hover hover:text-fg"
            >
              <LogOut className="size-4" />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-fg-muted">Tema</span>
            <ThemeToggle />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[11px] text-fg-muted">Tema</span>
          <ThemeToggle />
        </div>
      )}
    </aside>
  );
}
