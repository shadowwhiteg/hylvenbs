"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, UserX, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { api, type UserDto } from "@/lib/client";

const ROLES = ["admin", "editor", "viewer"] as const;

export default function UsersPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("editor");
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function reload() {
    setUsers(await api.get<UserDto[]>("/api/users"));
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const result = await api.post<UserDto & { tempPassword: string }>("/api/users", { name, email, role });
      setTempPassword(result.tempPassword);
      setName("");
      setEmail("");
      setCreating(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function changeRole(user: UserDto, newRole: string) {
    await api.patch(`/api/users/${user.id}`, { role: newRole });
    await reload();
  }

  async function deactivate(user: UserDto) {
    if (!confirm(`Desativar "${user.name}"?`)) return;
    await api.del(`/api/users/${user.id}`);
    await reload();
  }

  async function resetPassword(user: UserDto) {
    const result = await api.post<{ tempPassword: string }>(`/api/users/${user.id}/reset-password`);
    setTempPassword(result.tempPassword);
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Cadastro só por administrador — não há auto-cadastro."
        action={
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            {creating ? <X className="size-4" /> : <Plus className="size-4" />}
            {creating ? "Cancelar" : "Novo usuário"}
          </Button>
        }
      />
      <div className="space-y-4 p-8">
        {error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {tempPassword ? (
          <Card>
            <div className="space-y-2 p-5">
              <p className="text-sm font-medium">
                Senha temporária — copie agora, ela não será mostrada de novo.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-bg-subtle px-2.5 py-1.5 font-mono text-xs">
                  {tempPassword}
                </code>
                <Button size="sm" onClick={() => navigator.clipboard.writeText(tempPassword)}>
                  <Copy className="size-3.5" /> Copiar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTempPassword(null)}>
                  <Check className="size-3.5" /> Ok
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {creating ? (
          <Card>
            <CardHeader title="Novo usuário" subtitle="A senha temporária é exibida uma única vez." />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label="Nome">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="E-mail">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Papel">
                <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-3">
                <Button variant="primary" onClick={create} disabled={!name || !email}>
                  Criar usuário
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {loading ? (
          <Card>
            <EmptyState title="Carregando…" description="Buscando usuários." />
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-border">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {u.name}
                      <Badge tone={u.status === "active" ? "success" : "neutral"}>{u.status}</Badge>
                      {u.mustChangePassword ? <Badge tone="warning">troca pendente</Badge> : null}
                    </p>
                    <p className="text-xs text-fg-muted">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                      className="w-28"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" onClick={() => resetPassword(u)} title="Redefinir senha">
                      <KeyRound className="size-3.5" />
                    </Button>
                    {u.status === "active" ? (
                      <Button size="sm" variant="danger" onClick={() => deactivate(u)} title="Desativar">
                        <UserX className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
