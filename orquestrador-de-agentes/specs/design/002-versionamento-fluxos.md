# Design 002 · Versionamento de fluxos

**Cobre:** RQ-VER-01 … RQ-VER-12
**Depende de:** 001 (autoria) · **Bloqueia:** 006 (grafo histórico)

## O problema

Editar um agente hoje é destrutivo: a run de ontem aponta para uma configuração que já
não existe, e o trace mostra o prompt de hoje. Sem isso não há como comparar mudanças,
voltar atrás nem confiar no histórico.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Versionar o **grafo inteiro**, não cada agente isoladamente | Uma run precisa de um conjunto coerente. "Agente v3 + subagente v1" seria uma combinação que nunca existiu como todo. |
| D2 | Snapshot imutável em JSON, não linhas versionadas | O snapshot é lido por inteiro na execução e na visualização; normalizar em tabelas versionadas traria junções caras e nenhum ganho de consulta. |
| D3 | Rascunho = as linhas `Agent` ao vivo | Mantém a edição atual funcionando sem uma segunda representação. Publicar é congelar o rascunho. |
| D4 | Rollback publica versão nova | Histórico append-only: nunca se apaga o caminho percorrido (RQ-VER-08). |
| D5 | Segredos ficam fora; entra referência + `configHash` | Snapshot é dado consultável e exportável (RQ-VER-09); segredo cifrado não pertence a ele. |
| D6 | Exclusão lógica de agentes e servidores referenciados | Versão publicada tem que continuar executável (RQ-VER-11). |

## Formato do snapshot

Gerado a partir da raiz por travessia em largura sobre `AgentLink`. Ciclos são cortados
(um agente aparece uma vez; a aresta repetida é preservada em `edges`).

```jsonc
{
  "schemaVersion": 1,
  "rootAgentId": "agt_a1",
  "agents": [
    {
      "id": "agt_a1",
      "name": "Coordenador",
      "description": "…",
      "role": "orchestrator",
      "systemPrompt": "…",
      "provider": { "id": "prv_1", "kind": "anthropic", "name": "Anthropic produção" },
      "model": "claude-opus-4-8",
      "params": { "temperature": 0.7, "maxTokens": 2048, "topP": 1, "topK": 0,
                  "stopSequences": [], "maxSteps": 12 },
      "mcpServerIds": ["mcp_1"]
    }
  ],
  "edges": [{ "from": "agt_a1", "to": "agt_b2", "kind": "delegate" }],
  "mcpServers": [
    {
      "id": "mcp_1", "name": "filesystem", "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "url": null,
      "envKeys": ["GITHUB_TOKEN"],      // nomes apenas — nunca valores (RQ-VER-09)
      "headerKeys": [],
      "configHash": "sha256:…"
    }
  ]
}
```

**Hash de conteúdo** — serialização canônica (chaves ordenadas, sem espaços, arrays de
ids ordenados) → `sha256`. É o que decide se a publicação é redundante (RQ-VER-04) e o
que identifica uma versão semanticamente igual a outra.

**O que o snapshot não garante.** Ele fixa topologia, prompts e parâmetros. Não fixa: o
comportamento do modelo remoto, o conteúdo dos segredos, nem o estado do servidor MCP.
Reprodutibilidade aqui é de *configuração*, não de *resultado* — e isso é dito na UI para
não criar expectativa falsa.

## Publicação

```
POST /api/flows/:id/publish { message, tag? }
  1. resolve o grafo a partir de rootAgentId              (rascunho ao vivo)
  2. valida: sem agente sem provedor/modelo; raiz é orchestrator; MCP existentes
  3. canonicaliza → contentHash
  4. se contentHash == currentVersion.contentHash → 409 no_changes            [RQ-VER-04]
  5. cria FlowVersion(version = max+1) e aponta Flow.currentVersionId
  6. audita flow.published                                                    [RQ-AUTH-14]
```

Tudo em uma transação. `@@unique([flowId, version])` protege contra publicação simultânea:
a segunda falha e é repetida com o número seguinte.

**`isDirty` (RQ-VER-03)** — `GET /api/flows/:id` recalcula o hash do rascunho e compara
com o da versão atual. Custo desprezível nesta escala (dezenas de agentes) e sempre
correto, ao contrário de um flag mantido à mão.

## Rollback (RQ-VER-08)

```
POST /api/flows/:id/versions/:n/rollback
  1. lê snapshot de n
  2. aplica sobre as linhas ao vivo:
       - agente do snapshot que não existe mais → recria com o mesmo id (estava soft-deleted)
       - agente ao vivo ausente do snapshot     → soft delete
       - parâmetros, prompts, vínculos MCP e arestas → sobrescritos
  3. publica nova versão com message "rollback para v<n>"
```

Nenhuma versão é apagada ou reescrita.

## Diff (RQ-VER-07)

Comparação estrutural entre dois snapshots, não textual:

```
agent.added      { agentId, name }
agent.removed    { agentId, name }
agent.changed    { agentId, field: "systemPrompt"|"model"|"params.temperature"|…, from, to }
edge.added       { from, to }
edge.removed     { from, to }
mcp.bound        { agentId, mcpServerId }
mcp.unbound      { agentId, mcpServerId }
mcp.configChanged{ mcpServerId, from: configHash, to: configHash }
```

Campos de texto longo (prompt) trazem também um diff por linha para a UI. Alterar só a
`temperature` produz exatamente uma entrada `agent.changed` — critério de aceite do RQ-VER-07.

## Execução fixada em versão (RQ-VER-05)

```
POST /api/runs { flowId, flowVersion?: number | "current" | "draft", input }
```

O orquestrador deixa de ler `Agent` durante a execução e passa a receber um **plano
resolvido** derivado do snapshot. Impacto concreto em
[src/lib/orchestrator.ts](../../src/lib/orchestrator.ts): `loadAgent`/`buildTools` trocam
a consulta ao Prisma por leitura do snapshot; apenas provedor (segredo) e servidor MCP
(processo/URL) são resolvidos ao vivo, por id.

**Detecção de drift (RQ-VER-10)** — antes de executar, recalcula-se o `configHash` de
cada servidor MCP e compara-se com o gravado no snapshot. Divergência não impede a
execução: marca `configDrift: true`, grava `driftDetail` e emite log `warn`. Bloquear
seria pior — o operador que trocou o caminho de um servidor precisa conseguir rodar.

Execução de rascunho grava o snapshot efêmero em `Run.draftSnapshot` (RQ-VER-06), então
todo trace tem sempre a configuração exata que rodou, publicada ou não.

## Contratos de API

| Método | Rota | Permissão | Notas |
| --- | --- | --- | --- |
| GET/POST | `/api/flows` | `flow.read` / `flow.write` | POST recebe `rootAgentId` |
| GET/PATCH | `/api/flows/:id` | idem | GET traz topologia resolvida + `isDirty` |
| POST | `/api/flows/:id/publish` | `flow.publish` | 201 · 409 `no_changes` |
| GET | `/api/flows/:id/versions` | `flow.read` | paginado |
| GET | `/api/flows/:id/versions/:n` | `flow.read` | snapshot completo |
| POST | `/api/flows/:id/versions/:n/rollback` | `flow.rollback` | cria versão nova |
| GET | `/api/flows/:id/diff?from=&to=` | `flow.read` | `from`/`to` aceitam número, `tag` ou `draft` |
| POST | `/api/flows/:id/versions/:n/tag` | `flow.publish` | move a etiqueta |

## UI

- **Agentes** ganha o conceito de fluxo: seletor no topo, aviso "alterações não
  publicadas" com botões *Publicar* e *Descartar*.
- **Fluxo → Versões**: linha do tempo com versão, etiqueta, autor, mensagem e ações
  *Ver*, *Comparar*, *Rollback*.
- **Comparar**: diff lado a lado por entidade.
- **Execução** exibe a versão usada, com link para o snapshot e aviso de drift.

## Alternativas rejeitadas

- **Git como armazenamento das versões** — daria diff e histórico de graça, mas
  acrescenta binário externo, resolução de conflito e um segundo lugar de verdade para
  sincronizar com o banco.
- **Versionar cada agente** — combinações incoerentes na execução (D1) e diff por fluxo
  vira uma junção de linhas do tempo.
- **Event sourcing das edições** — reconstruir estado a cada leitura é caro e a única
  pergunta real ("como estava a configuração quando isto rodou?") é respondida por
  snapshot com uma leitura.
- **Bloquear execução em caso de drift** — impede o operador de trabalhar; sinalizar é
  suficiente e honesto.

## Plano de verificação

1. Publicar → editar → publicar: v1 e v2 com hashes diferentes; snapshot de v1 intacto.
2. Publicar sem alterações → 409.
3. Executar v1 depois de editar o rascunho: trace mostra o prompt da v1.
4. Rollback v3→v1 cria v4 idêntica à v1; v2 e v3 seguem consultáveis.
5. Excluir subagente publicado: versão continua executável (soft delete).
6. Busca por segredos dentro de `snapshot` não retorna nada.
7. Alterar args de servidor MCP e re-executar versão antiga: `configDrift: true`.
