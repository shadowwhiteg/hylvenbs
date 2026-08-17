"use client";

import { useEffect, useState } from "react";
import type { Permission } from "@/lib/api-registry";

export type Me = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  mustChangePassword: boolean;
  permissions: Permission[];
};

/** Sessão do usuário logado, buscada uma vez em /api/auth/me. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .finally(() => setLoading(false));
  }, []);

  return { me, loading };
}

export function can(me: Me | null, permission: Permission): boolean {
  return Boolean(me?.permissions.includes(permission));
}
