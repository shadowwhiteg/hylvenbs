"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { GitBranch, Play, Plus, Route, Save, Trash2, Upload, Workflow, X } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { canBeChild, canBeRoot, canDelegate, ROLE_LABEL } from "@/lib/agents/roles";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Slider,
  Spinner,
  Textarea,
} from "@/components/ui";
import { can, useMe } from "@/lib/auth-client";
import {
  api,
  type AgentDto,
  type EnqueuedRunDto,
  type FlowDto,
  type McpServerDto,
  type ModelHealthDto,
  type ModelPolicyDto,
  type ProviderDto,
} from "@/lib/client";
import { useRunLive } from "@/app/runs/use-run-live";
import { GraphView } from "@/components/graph/GraphView";
import { useRunGraph } from "@/components/graph/useRunGraph";
import { CandidateEditor } from "@/components/routing/CandidateEditor";

export default function AgentsPage() {
  const { me } = useMe();
  const canWrite = can(me, "agent.write");
  const canRun = can(me, "run.create");
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [nextAgents, nextProviders, nextServers] = await Promise.all([
      api.get<AgentDto[]>("/api/agents"),
      api.get<ProviderDto[]>("/api/providers"),
      api.get<McpServerDto[]>("/api/mcp"),
    ]);
    setAgents(nextAgents);
    setProviders(nextProviders);
    setServers(nextServers);
    setLoading(false);
    return nextAgents;
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);

  useEffect(() => {
    const found = agents.find((a) => a.id === selectedId);
    setDraft(found ? structuredClone(found) : null);
  }, [selectedId, agents]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === draft?.providerId) ?? null,
    [providers, draft?.providerId],
  );

  async function createAgent(role: AgentDto["role"]) {
    const name = role === "orchestrator" ? "Novo orquestrador" : role === "agent" ? "Novo agente" : "Novo subagente";
    const systemPrompt =
      role === "orchestrator"
        ? "Você é um orquestrador. Divida a tarefa e delegue aos agentes disponíveis, depois consolide as respostas."
        : role === "agent"
          ? "Você é um agente coordenador de domínio. Delegue aos subagentes disponíveis quando fizer sentido, ou execute a tarefa você mesmo."
          : "Você é um subagente especialista. Execute a tarefa recebida e responda de forma objetiva.";
    const created = await api.post<AgentDto>("/api/agents", {
      name,
      role,
      providerId: providers[0]?.id ?? null,
      model: providers[0]?.models[0] ?? "",
      systemPrompt,
    });
    await reload();
    setSelectedId(created.id);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/agents/${draft.id}`, {
        name: draft.name,
        description: draft.description,
        role: draft.role,
        systemPrompt: draft.systemPrompt,
        providerId: draft.providerId,
        model: draft.model,
        temperature: draft.temperature,
        maxTokens: draft.maxTokens,
        topP: draft.topP,
        topK: draft.topK,
        stopSequences: draft.stopSequences,
        maxSteps: draft.maxSteps,
        childIds: draft.childIds,
        mcpServerIds: draft.mcpServerIds,
        enabled: draft.enabled,
        modelPolicyId: draft.modelPolicyId,
        taskType: draft.taskType,
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

  async function remove(agent: AgentDto) {
    if (!confirm(`Excluir o agente "${agent.name}"?`)) return;
    await api.del(`/api/agents/${agent.id}`);
    setSelectedId(null);
    await reload();
  }

  function patch(changes: Partial<AgentDto>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  function toggleId(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  const orchestrators = agents.filter((a) => a.role === "orchestrator");
  const intermediateAgents = agents.filter((a) => a.role === "agent");
  const subagents = agents.filter((a) => a.role === "subagent");

  return (
    <>
      <PageHeader
        title="Agentes"
        description="Orquestradores e agentes delegam; subagentes executam. Todos podem usar tools de servidores MCP."
        action={
          canWrite ? (
            <>
              <Button onClick={() => createAgent("subagent")} disabled={providers.length === 0}>
                <Plus className="size-4" /> Subagente
              </Button>
              <Button onClick={() => createAgent("agent")} disabled={providers.length === 0}>
                <Plus className="size-4" /> Agente
              </Button>
              <Button variant="primary" onClick={() => createAgent("orchestrator")} disabled={providers.length === 0}>
                <Plus className="size-4" /> Orquestrador
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-4 p-8 xl:grid-cols-[280px_280px_280px_1fr]">
        <div className="space-y-4 xl:col-span-3 xl:grid xl:grid-cols-3 xl:gap-4 xl:space-y-0">
          {providers.length === 0 && !loading ? (
            <Card className="xl:col-span-3">
              <EmptyState
                title="Cadastre um provedor"
                description="Agentes precisam de um provedor de LLM configurado."
                action={
                  <Link href="/providers">
                    <Button variant="primary">Ir para provedores</Button>
                  </Link>
                }
              />
            </Card>
          ) : null}

          <AgentList
            title="Orquestradores"
            agents={orchestrators}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <AgentList title="Agentes" agents={intermediateAgents} selectedId={selectedId} onSelect={setSelectedId} />
          <AgentList title="Subagentes" agents={subagents} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        <div className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          {!draft ? (
            <Card>
              <EmptyState
                title={loading ? "Carregando…" : "Selecione um agente"}
                description="Escolha um agente à esquerda para editar prompt, provedor, parâmetros do modelo e ferramentas."
              />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {draft.name}
                      <Badge tone={draft.role === "orchestrator" ? "accent" : "neutral"}>{ROLE_LABEL[draft.role]}</Badge>
                    </span>
                  }
                  subtitle={`ID ${draft.id}`}
                  action={
                    canWrite ? (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="primary" onClick={save} disabled={saving}>
                          {saving ? <Spinner /> : <Save className="size-3.5" />} Salvar
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => remove(draft)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ) : null
                  }
                />

                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  <Field label="Nome">
                    <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                  </Field>
                  <Field label="Função">
                    <Select
                      value={draft.role}
                      onChange={(e) => patch({ role: e.target.value as AgentDto["role"] })}
                    >
                      <option value="orchestrator">Orquestrador (raiz do fluxo, delega)</option>
                      <option value="agent">Agente (delega e executa)</option>
                      <option value="subagent">Subagente (só executa)</option>
                    </Select>
                  </Field>
                  <Field label="Descrição" hint="mostrada ao orquestrador" className="lg:col-span-2">
                    <Input
                      value={draft.description}
                      onChange={(e) => patch({ description: e.target.value })}
                      placeholder="Especialista em pesquisa e sumarização."
                    />
                  </Field>
                  <Field label="System prompt" className="lg:col-span-2">
                    <Textarea
                      rows={6}
                      value={draft.systemPrompt}
                      onChange={(e) => patch({ systemPrompt: e.target.value })}
                    />
                  </Field>
                </div>
              </Card>

              {canBeRoot(draft.role) && draft.flowId ? <FlowPanel flowId={draft.flowId} /> : null}

              <RoutingPanel draft={draft} setDraft={setDraft} providers={providers} canWrite={canWrite} />

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Provedor e modelo" subtitle="Troque de provedor sem recriar o agente." />
                  <div className="space-y-4 p-5">
                    <Field label="Provedor">
                      <Select
                        value={draft.providerId ?? ""}
                        onChange={(e) => {
                          const providerId = e.target.value || null;
                          const provider = providers.find((p) => p.id === providerId);
                          patch({ providerId, model: provider?.models[0] ?? "" });
                        }}
                      >
                        <option value="">— nenhum —</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.kind})
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field
                      label="Modelo"
                      hint={selectedProvider?.models.length ? undefined : "descubra os modelos em Provedores"}
                    >
                      {selectedProvider?.models.length ? (
                        <Select value={draft.model} onChange={(e) => patch({ model: e.target.value })}>
                          <option value="">— selecione —</option>
                          {selectedProvider.models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          value={draft.model}
                          onChange={(e) => patch({ model: e.target.value })}
                          placeholder="claude-opus-4-8"
                        />
                      )}
                    </Field>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Parâmetros do modelo" />
                  <div className="space-y-4 p-5">
                    <Slider
                      label="Temperature"
                      value={draft.temperature}
                      min={0}
                      max={2}
                      step={0.05}
                      onChange={(temperature) => patch({ temperature })}
                    />
                    <Slider
                      label="Top P"
                      value={draft.topP}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(topP) => patch({ topP })}
                    />
                    <Slider
                      label="Top K"
                      value={draft.topK}
                      min={0}
                      max={200}
                      step={1}
                      onChange={(topK) => patch({ topK })}
                      hint="0 desativa (só Anthropic e compatíveis)"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Max tokens">
                        <Input
                          type="number"
                          value={draft.maxTokens}
                          onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
                        />
                      </Field>
                      <Field label="Max passos" hint="loop de tools">
                        <Input
                          type="number"
                          value={draft.maxSteps}
                          onChange={(e) => patch({ maxSteps: Number(e.target.value) })}
                        />
                      </Field>
                    </div>
                    <Field label="Stop sequences" hint="separadas por vírgula">
                      <Input
                        value={draft.stopSequences.join(", ")}
                        onChange={(e) =>
                          patch({
                            stopSequences: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                  </div>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Servidores MCP" subtitle="Tools disponíveis para este agente." />
                  <div className="space-y-1.5 p-5">
                    {servers.length === 0 ? (
                      <p className="text-xs text-fg-muted">
                        Nenhum servidor cadastrado. <Link href="/mcp" className="text-accent">Cadastrar</Link>
                      </p>
                    ) : (
                      servers.map((server) => (
                        <Toggle
                          key={server.id}
                          checked={draft.mcpServerIds.includes(server.id)}
                          onChange={() => patch({ mcpServerIds: toggleId(draft.mcpServerIds, server.id) })}
                          label={server.name}
                          detail={`${server.tools.length} tools · ${server.transport}`}
                        />
                      ))
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    title="Delegação"
                    subtitle={
                      canDelegate(draft.role)
                        ? "Cada um vira uma tool delegate_to_*."
                        : "Só orquestradores e agentes podem delegar."
                    }
                  />
                  <div className="space-y-1.5 p-5">
                    {agents.filter((a) => a.id !== draft.id && canBeChild(a.role)).length === 0 ? (
                      <p className="text-xs text-fg-muted">Crie um agente ou subagente para poder delegar.</p>
                    ) : (
                      agents
                        .filter((a) => a.id !== draft.id && canBeChild(a.role))
                        .map((agent) => (
                          <Toggle
                            key={agent.id}
                            disabled={!canDelegate(draft.role)}
                            checked={draft.childIds.includes(agent.id)}
                            onChange={() => patch({ childIds: toggleId(draft.childIds, agent.id) })}
                            label={agent.name}
                            detail={ROLE_LABEL[agent.role]}
                          />
                        ))
                    )}
                  </div>
                </Card>
              </div>

              <Playground agent={draft} canRun={canRun} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function AgentList({
  title,
  agents,
  selectedId,
  onSelect,
}: {
  title: string;
  agents: AgentDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={`${agents.length} agente(s)`} />
      <div className="p-2">
        {agents.length === 0 ? (
          <p className="px-3 py-4 text-xs text-fg-muted">Nenhum ainda.</p>
        ) : (
          agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition",
                selectedId === agent.id ? "bg-accent-soft text-accent" : "hover:bg-surface-hover",
              )}
            >
              <Workflow className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{agent.name}</span>
                <span className="block truncate text-[11px] text-fg-muted">
                  {agent.model || "sem modelo"}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  detail,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        "flex items-center gap-3 rounded-lg px-2.5 py-2",
        disabled ? "opacity-50" : "cursor-pointer hover:bg-surface-hover",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="size-4 accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        <span className="block truncate text-[11px] text-fg-muted">{detail}</span>
      </span>
    </label>
  );
}

function FlowPanel({ flowId }: { flowId: string }) {
  const { me } = useMe();
  const canPublish = can(me, "flow.publish");
  const [flow, setFlow] = useState<(FlowDto & { isDirty: boolean }) | null>(null);
  const [message, setMessage] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.get<FlowDto & { isDirty: boolean }>(`/api/flows/${flowId}`).then(setFlow);
  }, [flowId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      await api.post(`/api/flows/${flowId}/publish`, { message });
      setMessage("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  if (!flow) return null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <GitBranch className="size-3.5" /> Fluxo
          </span>
        }
        subtitle="Este orquestrador é a raiz de um fluxo versionável (RQ-VER-01)."
        action={
          <div className="flex items-center gap-2">
            <Badge tone={flow.isDirty ? "warning" : "success"}>
              {flow.isDirty ? "não publicado" : "publicado"}
            </Badge>
            <Link href={`/flows/${flowId}`} className="text-xs text-accent hover:underline">
              ver versões →
            </Link>
          </div>
        }
      />
      {canPublish && flow.isDirty ? (
        <div className="flex items-end gap-3 p-5">
          <Field label="Mensagem da versão" className="flex-1">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="O que mudou?" />
          </Field>
          <Button variant="primary" size="sm" onClick={publish} disabled={publishing}>
            {publishing ? <Spinner /> : <Upload className="size-3.5" />} Publicar
          </Button>
        </div>
      ) : null}
      {error ? <p className="px-5 pb-4 text-xs text-danger">{error}</p> : null}
    </Card>
  );
}

/**
 * Roteamento do agente (design 007): política reutilizável + sobrescrita própria.
 * A sobrescrita prevalece sobre a política, sem alterá-la (RQ-ROT-03).
 */
function RoutingPanel({
  draft,
  setDraft,
  providers,
  canWrite,
}: {
  draft: AgentDto;
  setDraft: (next: AgentDto) => void;
  providers: ProviderDto[];
  canWrite: boolean;
}) {
  const [policies, setPolicies] = useState<ModelPolicyDto[]>([]);
  const [health, setHealth] = useState<ModelHealthDto[]>([]);

  useEffect(() => {
    api.get<ModelPolicyDto[]>("/api/model-policies").then(setPolicies).catch(() => setPolicies([]));
    api.get<ModelHealthDto[]>("/api/model-health").then(setHealth).catch(() => setHealth([]));
  }, []);

  const policy = policies.find((p) => p.id === draft.modelPolicyId) ?? null;
  const overriding = draft.candidates.length > 0;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Route className="size-3.5" /> Roteamento de modelos
          </span>
        }
        subtitle="Ordem de preferência por tipo de tarefa; se um modelo estiver indisponível, o próximo assume (RQ-ROT-06)."
        action={
          overriding ? (
            <Badge tone="accent">sobrescrita própria</Badge>
          ) : policy ? (
            <Badge tone="neutral">segue a política</Badge>
          ) : (
            <Badge tone="neutral">modelo único</Badge>
          )
        }
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Política" hint="cadeia reutilizável">
            <Select
              value={draft.modelPolicyId ?? ""}
              disabled={!canWrite}
              onChange={(e) => setDraft({ ...draft, modelPolicyId: e.target.value || null })}
            >
              <option value="">nenhuma</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de tarefa padrão" hint="usado quando a run não pede outro">
            <Input
              value={draft.taskType}
              disabled={!canWrite}
              onChange={(e) => setDraft({ ...draft, taskType: e.target.value })}
              placeholder="default"
            />
          </Field>
        </div>

        {policy && !overriding ? (
          <div className="rounded-lg bg-bg-subtle p-3">
            <p className="mb-2 text-[11px] text-fg-muted">
              Cadeia herdada de <span className="font-medium text-fg">{policy.name}</span>:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {policy.candidates.length === 0 ? (
                <span className="text-[11px] text-fg-muted">(política sem candidatos)</span>
              ) : (
                policy.candidates.map((c, i) => (
                  <Badge key={i} tone={c.taskType === draft.taskType ? "accent" : "neutral"}>
                    {c.taskType}: {c.model}
                  </Badge>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-medium">Cadeia própria deste agente</p>
          <CandidateEditor
            candidates={draft.candidates}
            providers={providers}
            health={health}
            disabled={!canWrite}
            onChange={(candidates) => setDraft({ ...draft, candidates })}
          />
        </div>
      </div>
    </Card>
  );
}

const PLAYGROUND_STATUS_TONE = {
  queued: "neutral",
  running: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  timed_out: "danger",
} as const;

function Playground({ agent, canRun }: { agent: AgentDto; canRun: boolean }) {
  const [input, setInput] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [enqueuing, setEnqueuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowDto | null>(null);
  const [useCurrentVersion, setUseCurrentVersion] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { run, spans, isActive, cancel } = useRunLive(runId);
  const { graph } = useRunGraph(runId);

  useEffect(() => {
    setFlow(null);
    if (canBeRoot(agent.role) && agent.flowId) {
      api.get<FlowDto>(`/api/flows/${agent.flowId}`).then(setFlow).catch(() => setFlow(null));
    }
  }, [agent.role, agent.flowId]);

  async function execute() {
    setEnqueuing(true);
    setError(null);
    setRunId(null);
    try {
      const enqueued = await api.post<EnqueuedRunDto>("/api/runs", {
        agentId: agent.id,
        input,
        ...(useCurrentVersion && flow?.currentVersion ? { flowVersion: "current" } : {}),
      });
      setRunId(enqueued.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnqueuing(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Playground"
        subtitle="Executa o agente de verdade — chama o provedor e os servidores MCP."
        action={
          canRun ? (
            <Button variant="primary" size="sm" onClick={execute} disabled={enqueuing || isActive || !input.trim()}>
              {enqueuing ? <Spinner /> : <Play className="size-3.5" />} Executar
            </Button>
          ) : null
        }
      />
      <div className="space-y-4 p-5">
        <Textarea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Descreva a tarefa para o agente…"
        />

        {flow?.currentVersion ? (
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={useCurrentVersion}
              onChange={(e) => setUseCurrentVersion(e.target.checked)}
              className="size-3.5 accent-[var(--accent)]"
            />
            Executar a versão publicada (v{flow.currentVersion.version}) em vez do rascunho ao vivo
          </label>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}

        {run ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={PLAYGROUND_STATUS_TONE[run.status] ?? "neutral"}>{run.status}</Badge>
              <Badge>{spans.length} spans</Badge>
              <Badge>
                {run.inputTokens} in / {run.outputTokens} out
              </Badge>
              <Link href={`/runs/${run.id}`} className="text-accent hover:underline">
                ver trace completo →
              </Link>
              {isActive ? (
                <Button size="sm" variant="danger" onClick={cancel} disabled={!!run.cancelRequestedAt}>
                  <X className="size-3.5" /> {run.cancelRequestedAt ? "Cancelando…" : "Cancelar"}
                </Button>
              ) : null}
            </div>
            {graph ? (
              <GraphView graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} className="max-w-xl" />
            ) : null}
            <div className="rounded-lg bg-bg-subtle p-4 text-sm whitespace-pre-wrap">
              {run.output || run.error || (isActive ? "na fila / executando…" : "(sem saída)")}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
