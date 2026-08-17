"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Activity, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CandidateEditor } from "@/components/routing/CandidateEditor";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Spinner, Textarea } from "@/components/ui";
import { can, useMe } from "@/lib/auth-client";
import { api, type ModelHealthDto, type ModelPolicyDto, type ProviderDto } from "@/lib/client";

export default function ModelPoliciesPage() {
  const { me } = useMe();
  const canWrite = can(me, "policy.write");

  const [policies, setPolicies] = useState<ModelPolicyDto[]>([]);
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [health, setHealth] = useState<ModelHealthDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelPolicyDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [nextPolicies, nextProviders, nextHealth] = await Promise.all([
      api.get<ModelPolicyDto[]>("/api/model-policies"),
      api.get<ProviderDto[]>("/api/providers"),
      api.get<ModelHealthDto[]>("/api/model-health"),
    ]);
    setPolicies(nextPolicies);
    setProviders(nextProviders);
    setHealth(nextHealth);
    setLoading(false);
    return nextPolicies;
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);

  useEffect(() => {
    const found = policies.find((p) => p.id === selectedId);
    setDraft(found ? structuredClone(found) : null);
  }, [selectedId, policies]);

  async function create() {
    setError(null);
    try {
      const created = await api.post<ModelPolicyDto>("/api/model-policies", {
        name: "Nova política",
        description: "",
        candidates: [],
      });
      await reload();
      setSelectedId(created.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/model-policies/${draft.id}`, {
        name: draft.name,
        description: draft.description,
        enabled: draft.enabled,
        candidates: draft.candidates.map((c) => ({
          taskType: c.taskType,
          providerId: c.providerId,
          model: c.model,
          maxTokens: c.maxTokens,
          temperature: c.temperature,
          enabled: c.enabled,
        })),
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft || !confirm(`Excluir a política "${draft.name}"?`)) return;
    setError(null);
    try {
      await api.del(`/api/model-policies/${draft.id}`);
      setSelectedId(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const cooling = health.filter((h) => h.inCooldown);

  return (
    <>
      <PageHeader
        title="Roteamento de modelos"
        description="Cadeias ordenadas de modelos por tipo de tarefa — se o primeiro estiver indisponível, o próximo assume."
        action={
          canWrite ? (
            <Button variant="primary" onClick={create}>
              <Plus className="size-3.5" /> Política
            </Button>
          ) : null
        }
      />

      <div className="space-y-4 p-8">
        {error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        ) : null}

        {cooling.length > 0 ? (
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Activity className="size-3.5" /> Modelos em carência
                </span>
              }
              subtitle="Falharam recentemente e estão sendo tentados por último até a carência passar (RQ-ROT-08)."
            />
            <ul className="divide-y divide-border">
              {cooling.map((h) => (
                <li key={`${h.providerId}-${h.model}`} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-xs">
                  <Badge tone="warning">{h.providerName ?? h.providerId}</Badge>
                  <span className="font-mono">{h.model}</span>
                  <span className="text-fg-muted">{h.consecutiveFailures} falha(s) seguidas</span>
                  {h.lastErrorType ? <Badge tone="danger">{h.lastErrorType}</Badge> : null}
                  <span className="ml-auto text-fg-muted">
                    até {h.cooldownUntil ? new Date(h.cooldownUntil).toLocaleTimeString("pt-BR") : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader title="Políticas" subtitle={`${policies.length} cadastrada(s)`} />
            {loading ? (
              <div className="flex justify-center p-8">
                <Spinner />
              </div>
            ) : policies.length === 0 ? (
              <EmptyState
                title="Nenhuma política"
                description="Crie uma para reutilizar a mesma cadeia de modelos em vários agentes."
              />
            ) : (
              <ul className="p-2">
                {policies.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={clsx(
                        "w-full rounded-lg px-3 py-2 text-left text-sm transition",
                        selectedId === p.id ? "bg-accent-soft text-accent" : "hover:bg-surface-hover",
                      )}
                    >
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-[11px] text-fg-muted">
                        {p.candidates.length} candidato(s) · {p.agentCount} agente(s)
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {draft ? (
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Política"
                  action={
                    canWrite ? (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="danger" onClick={remove}>
                          <Trash2 className="size-3.5" /> Excluir
                        </Button>
                        <Button size="sm" variant="primary" onClick={save} disabled={saving}>
                          {saving ? <Spinner /> : <Save className="size-3.5" />} Salvar
                        </Button>
                      </div>
                    ) : null
                  }
                />
                <div className="space-y-4 p-5">
                  <Field label="Nome">
                    <Input
                      value={draft.name}
                      disabled={!canWrite}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Descrição">
                    <Textarea
                      rows={2}
                      value={draft.description}
                      disabled={!canWrite}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </Field>
                  <p className="text-[11px] text-fg-muted">
                    Usada por {draft.agentCount} agente(s). Excluir é lógico — versões de fluxo já publicadas
                    congelaram a cadeia e continuam íntegras.
                  </p>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Cadeia de modelos"
                  subtitle="A ordem é a prioridade. Cada tipo de tarefa tem a sua própria cadeia (RQ-ROT-04/05)."
                />
                <div className="p-5">
                  <CandidateEditor
                    candidates={draft.candidates}
                    providers={providers}
                    health={health}
                    disabled={!canWrite}
                    onChange={(candidates) => setDraft({ ...draft, candidates })}
                  />
                </div>
              </Card>
            </div>
          ) : (
            <Card>
              <EmptyState
                title="Selecione uma política"
                description="Escolha à esquerda para editar a cadeia de modelos, ou crie uma nova."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
