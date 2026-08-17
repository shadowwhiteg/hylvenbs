"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [needed, setNeeded] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/setup")
      .then((r) => (r.ok ? r.json() : { needed: false }))
      .then((data) => setNeeded(Boolean(data.needed)))
      .finally(() => setChecking(false));
  }, []);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      router.push("/login");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (checking) return null;

  if (!needed) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <Card>
          <div className="p-6 text-sm text-fg-muted">
            Já existe um administrador cadastrado. Vá para{" "}
            <a className="text-accent underline" href="/login">
              /login
            </a>
            .
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card>
        <CardHeader title="Configuração inicial" subtitle="Crie o primeiro administrador da plataforma." />
        <div className="space-y-4 p-6" style={{ width: 360 }}>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Senha" hint="mínimo 8 caracteres">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || !email || !name || password.length < 8}
          >
            Criar administrador
          </Button>
        </div>
      </Card>
    </div>
  );
}
