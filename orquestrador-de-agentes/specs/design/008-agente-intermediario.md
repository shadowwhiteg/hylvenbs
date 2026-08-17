# Design 008 · Papel intermediário "Agente" entre orquestrador e subagente

**Cobre:** RQ-HIER-01 … RQ-HIER-08
**Depende de:** 002 (snapshot e publicação), 006 (grafo), 003 (spans de delegação)

## O problema

`Agent.role` admite dois valores e o código lê esse campo como um booleano disfarçado:
`role === "orchestrator"` decide **três** coisas diferentes em lugares diferentes —

| Onde | O que decide hoje |
| --- | --- |
| [snapshot.ts](../../src/lib/flows/snapshot.ts) `resolveFlowGraph` | se a travessia desce para os filhos |
| [orchestrator.ts](../../src/lib/orchestrator.ts) `buildTools` | se o agente ganha tools `delegate_to_*` |
| [snapshot.ts](../../src/lib/flows/snapshot.ts) `validateSnapshot` e [api/flows](../../src/app/api/flows/route.ts) | se pode ser raiz de um fluxo |

São três conceitos empacotados num só: **descer no grafo**, **poder delegar** e **ser
raiz**. Um nível intermediário precisa dos dois primeiros sem o terceiro. Enquanto os
três estiverem colados no mesmo `=== "orchestrator"`, não existe onde encaixá-lo.

Sem esse nível, um orquestrador com doze especialistas recebe doze tools de delegação de
uma vez: o modelo escolhe pior quanto maior o catálogo, e o prompt do orquestrador vira
um índice de especialistas em vez de uma instrução de coordenação.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Terceiro valor `"agent"` no campo `role` existente | `role` já é `String` no Prisma — nenhuma migração, nenhum dado tocado (RQ-HIER-08, T6). |
| D2 | Trocar os três `=== "orchestrator"` por dois predicados nomeados: `canDelegate(role)` e `canBeRoot(role)` | O acoplamento acidental é a causa raiz; nomear as capacidades é o que torna o terceiro papel possível sem espalhar `if`. |
| D3 | `orchestrator` não pode ser filho de ninguém | Um orquestrador é a raiz de um fluxo versionável; virar filho o colocaria em dois fluxos ao mesmo tempo, e o snapshot deixaria de ter dono único (RQ-HIER-03). |
| D4 | `agent → agent` permitido, limitado por `MAX_DEPTH` | Proibir custaria uma regra a mais e não evitaria nada: a profundidade já é limitada e o ciclo já é cortado. Três níveis é a **recomendação**, não a restrição (RQ-HIER-05). |
| D5 | A capacidade de delegar vem do **papel**, não da existência de filhos | Um `subagent` com vínculos herdados de uma edição anterior não pode virar delegador por acidente (RQ-HIER-04). |
| D6 | Rótulo na UI: "Agente" para `agent`, mantendo "Orquestrador" e "Subagente" | É o vocabulário que o usuário pediu; a ambiguidade com o termo genérico "agente" é resolvida pelo contexto (a coluna do meio) e pela descrição do papel. |
| D7 | Novo tipo de nó `agent` no grafo, com forma própria além da cor | RQ-HIER-07 e RQ-VIS-11 — erro e papel não podem depender só de cor. |

### Predicados (D2)

```ts
// src/lib/agents/roles.ts — fonte única do vocabulário de papéis
export const AGENT_ROLES = ["orchestrator", "agent", "subagent"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Recebe tools delegate_to_* e faz a travessia descer para os filhos. */
export const canDelegate = (role: string) => role === "orchestrator" || role === "agent";
/** Pode ser raiz de um Flow versionável (D3). */
export const canBeRoot = (role: string) => role === "orchestrator";
/** Pode ser filho de outro agente — o contrapositivo de canBeRoot (D3). */
export const canBeChild = (role: string) => role !== "orchestrator";
```

Todo `=== "orchestrator"` do código passa a chamar um destes. O teste de arquitetura
([tests/architecture.test.ts](../../tests/architecture.test.ts)) ganha uma regra: fora de
`roles.ts`, comparar `role` com literal só é permitido em rotulagem de UI.

## O que muda, arquivo a arquivo

**Resolução do grafo** — `resolveFlowGraph` troca `row.role === "orchestrator"` por
`canDelegate(row.role)`. O `visited` que já existe continua cortando ciclos: cada agente
entra uma vez, a aresta repetida permanece em `edges` (RQ-HIER-06 é satisfeito pelo
mecanismo atual, só faltava alcançá-lo).

**Validação da publicação** — `validateSnapshot` mantém "a raiz é `orchestrator`" via
`canBeRoot`, e ganha uma regra nova: nenhuma aresta pode apontar para um agente com
`canBeRoot` verdadeiro (D3). É a checagem de rede — a API já recusa antes.

**Catálogo de tools** — `buildTools` troca a guarda por `canDelegate(agent.role)`. A
descrição da tool deixa de dizer "subagente" e passa a nomear o papel do filho:
`Delega uma tarefa ao agente "X"` / `ao subagente "X"`. O texto importa: é o que o
modelo lê para decidir quando delegar.

**API de agentes** — `role` vira `z.enum(AGENT_ROLES)` em `POST` e `PATCH`. A criação
automática de `Flow` continua condicionada a `canBeRoot` — um `agent` **não** cria fluxo.
`childIds` passa a validar `canBeChild` de cada filho, respondendo 422
`invalid_child_role` (RQ-HIER-03).

**Grafo e UI** — `GraphNodeType` ganha `"agent"`; `build.ts` mapeia por papel em vez do
ternário atual. A tela de agentes passa de duas colunas para três, o seletor de papel
ganha a opção do meio, e a lista de filhos passa a ser oferecida a quem `canDelegate`,
filtrando candidatos por `canBeChild`.

## Semântica de execução

```
Orquestrador  depth 0   delega          (raiz do fluxo, dono da resposta final)
   └─ Agente  depth 1   delega e executa (coordenador de domínio)
       └─ Subagente depth 2  executa     (especialista, folha)
```

Nada mais muda no motor: `executeAgent` já é recursivo e agnóstico de papel, o span
`agent:` já carrega `orq.agent.role` e `orq.delegate.depth`, e o failover de modelo
(design 007) opera por agente — cada nível resolve **sua** cadeia, com seu `taskType`.

`MAX_DEPTH` permanece 3. Com o papel do meio isso passa a significar: a delegação para de
ser oferecida a partir da profundidade 3, então a cadeia mais longa executável é
`orquestrador → agent → agent → subagent`. A run não falha ao atingir o limite — o
agente do último nível simplesmente não recebe tools de delegação e responde com o que
tem (RQ-HIER-05).

## Alternativas rejeitadas

- **Campo booleano `canDelegate` no `Agent`, sem papel novo** — permitiria as mesmas
  topologias, mas deixaria de existir vocabulário: a UI, o grafo e o tutorial precisam
  nomear "o do meio". Papel é a mesma informação com nome.
- **Sub-fluxo: um orquestrador filho de outro orquestrador** — é o modelo mais poderoso
  (cada nível versionado em separado) e o mais caro: exigiria snapshot aninhado,
  publicação em cascata e uma resposta para "o que acontece quando o sub-fluxo é
  republicado no meio de uma run". Fica registrado como evolução; D3 não a impede.
- **Profundidade ilimitada com detecção de ciclo em tempo de execução** — o custo de uma
  cadeia profunda é pago em latência e tokens a cada nível, e o limite existente já é o
  freio certo. Nada a ganhar.
- **Inferir o papel pela topologia** (tem filhos ⇒ delega) — quebra RQ-HIER-04 e torna o
  comportamento de um agente dependente de quem o editou por último.
- **`enum` no Prisma para `role`** — SQLite não tem enum nativo; o Prisma o emula com
  `CHECK`, e a migração converteria uma coluna que hoje não precisa ser tocada (T6).

## Plano de verificação

1. Criar `orquestrador → agent → subagent`, publicar e executar: três spans `agent:`
   aninhados com `orq.delegate.depth` 0/1/2 (RQ-HIER-02).
2. `PATCH` de `childIds` com um orquestrador → 422 `invalid_child_role` (RQ-HIER-03).
3. `subagent` com filho vinculado: catálogo sem nenhuma tool `delegate_to_*` (RQ-HIER-04).
4. Cadeia de quatro níveis: o último não recebe delegação e a run conclui (RQ-HIER-05).
5. Ciclo A↔B entre dois `agent`: publica; snapshot com dois agentes e duas arestas
   (RQ-HIER-06).
6. `GET /api/flows/:id/graph` devolve `type: "agent"`; a suíte anterior segue verde e
   `prisma migrate status` não acusa migração pendente (RQ-HIER-07, RQ-HIER-08).
