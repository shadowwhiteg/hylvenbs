"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { useMe } from "@/lib/auth-client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { me } = useMe();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Trocar senha" description="Sua senha atual foi definida por um administrador." />
      <div className="p-8">
        <Card>
          <CardHeader
            title="Nova senha"
            subtitle={
              me?.mustChangePassword
                ? "Você precisa trocar a senha antes de continuar usando a plataforma."
                : undefined
            }
          />
          <div className="space-y-4 p-6" style={{ maxWidth: 360 }}>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Field label="Senha atual">
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <Field label="Nova senha" hint="mínimo 8 caracteres">
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <Button
              variant="primary"
              onClick={submit}
              disabled={busy || !currentPassword || newPassword.length < 8}
            >
              Trocar senha
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
