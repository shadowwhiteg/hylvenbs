"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Select } from "@/components/ui";
import type { ModelCandidateDto, ModelHealthDto, ProviderDto } from "@/lib/client";

/**
 * Editor da cadeia ordenada de modelos (design 007). A ordem das linhas **é** a
 * prioridade — subir/descer reescreve o rank, então não há campo numérico para o
 * usuário errar. Agrupa por tipo de tarefa porque cada tipo é uma cadeia própria.
 */
export function CandidateEditor({
  candidates,
  providers,
  health,
  onChange,
  disabled,
}: {
  candidates: ModelCandidateDto[];
  providers: ProviderDto[];
  health?: ModelHealthDto[];
  onChange: (next: ModelCandidateDto[]) => void;
  disabled?: boolean;
}) {
  const taskTypes = [...new Set(candidates.map((c) => c.taskType))].sort();
  const healthByKey = new Map((health ?? []).map((h) => [`${h.providerId} ${h.model}`, h]));

  function update(index: number, patch: Partial<ModelCandidateDto>) {
    onChange(candidates.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function remove(index: number) {
    onChange(candidates.filter((_, i) => i !== index).map((c, i) => ({ ...c, rank: i })));
  }

  /** Move dentro do mesmo tipo de tarefa — trocar de posição entre cadeias não faz sentido. */
  function move(index: number, direction: -1 | 1) {
    const target = candidates[index]!;
    const siblings = candidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.taskType === target.taskType);
    const pos = siblings.findIndex(({ i }) => i === index);
    const swapWith = siblings[pos + direction];
    if (!swapWith) return;

    const next = [...candidates];
    next[index] = swapWith.c;
    next[swapWith.i] = target;
    onChange(next.map((c, i) => ({ ...c, rank: i })));
  }

  function add(taskType: string) {
    const first = providers[0];
    onChange([
      ...candidates,
      {
        taskType,
        rank: candidates.length,
        providerId: first?.id ?? "",
        model: first?.models[0] ?? "",
        maxTokens: null,
        temperature: null,
        enabled: true,
      },
    ]);
  }

  function addTaskType() {
    const name = prompt('Nome do tipo de tarefa (ex.: "reasoning", "coding"):');
    if (!name?.trim()) return;
    add(name.trim());
  }

  return (
    <div className="space-y-4">
      {taskTypes.length === 0 ? (
        <p className="text-xs text-fg-muted">
          Nenhum candidato. Sem cadeia, o agente usa o provedor/modelo único configurado acima.
        </p>
      ) : null}

      {taskTypes.map((taskType) => {
        const rows = candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.taskType === taskType);
        return (
          <div key={taskType} className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge tone={taskType === "default" ? "neutral" : "accent"}>{taskType}</Badge>
                <span className="text-[11px] text-fg-muted">
                  {rows.length} candidato(s) — o primeiro é tentado primeiro
                </span>
              </div>
              {!disabled ? (
                <Button size="sm" variant="ghost" onClick={() => add(taskType)}>
                  <Plus className="size-3.5" /> Candidato
                </Button>
              ) : null}
            </div>

            <ul className="divide-y divide-border">
              {rows.map(({ c, i }, posInGroup) => {
                const provider = providers.find((p) => p.id === c.providerId);
                const modelHealth = healthByKey.get(`${c.providerId} ${c.model}`);
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="w-6 shrink-0 text-center font-mono text-[11px] text-fg-muted">
                      {posInGroup + 1}
                    </span>

                    <Select
                      value={c.providerId}
                      disabled={disabled}
                      onChange={(e) => update(i, { providerId: e.target.value, model: "" })}
                      className="w-40"
                    >
                      <option value="">provedor…</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>

                    {provider && provider.models.length > 0 ? (
                      <Select
                        value={c.model}
                        disabled={disabled}
                        onChange={(e) => update(i, { model: e.target.value })}
                        className="w-52"
                      >
                        <option value="">modelo…</option>
                        {provider.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        value={c.model}
                        disabled={disabled}
                        onChange={(e) => update(i, { model: e.target.value })}
                        placeholder="modelo"
                        className="w-52"
                      />
                    )}

                    {modelHealth?.inCooldown ? (
                      <span title={modelHealth.lastErrorMessage ?? undefined}>
                        <Badge tone="warning">⚠ em carência</Badge>
                      </span>
                    ) : null}
                    {!c.enabled ? <Badge tone="neutral">desabilitado</Badge> : null}

                    {!disabled ? (
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Subir prioridade"
                          onClick={() => move(i, -1)}
                          disabled={posInGroup === 0}
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Descer prioridade"
                          onClick={() => move(i, 1)}
                          disabled={posInGroup === rows.length - 1}
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Remover" onClick={() => remove(i)}>
                          <Trash2 className="size-3.5 text-danger" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {!disabled ? (
        <div className="flex gap-2">
          {!taskTypes.includes("default") ? (
            <Button size="sm" onClick={() => add("default")}>
              <Plus className="size-3.5" /> Cadeia padrão
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={addTaskType}>
            <Plus className="size-3.5" /> Tipo de tarefa
          </Button>
        </div>
      ) : null}
    </div>
  );
}
