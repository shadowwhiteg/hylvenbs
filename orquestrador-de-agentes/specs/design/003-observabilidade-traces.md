# Design 003 · Observabilidade, traces e logs

**Cobre:** RQ-OBS-01 … RQ-OBS-10, RQ-NFR-02, RQ-NFR-03
**Depende de:** nada (pode andar em paralelo com 001) · **Bloqueia:** 004 (SSE) e 006 (grafo ao vivo)

## O problema

`RunStep` é uma lista plana com `depth` como dica visual. Não há relação pai/filho real,
nem categoria de erro, nem log — quando algo falha, resta ler o texto de uma coluna
`output`. A visualização (006) e o acompanhamento ao vivo (004) precisam de uma estrutura
que ainda não existe.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Spans com `parentSpanId`, semântica OpenTelemetry | Vocabulário conhecido, hierarquia real, e caminho de exportação sem retrabalho (RQ-OBS-09). |
| D2 | Implementação própria, sem SDK OTel | O SDK traz instrumentação automática e peso que não usamos; precisamos de ~200 linhas e do banco local (T1). |
| D3 | `Span` e `LogEntry` separados | Span é a unidade de duração; log é evento pontual. Amontoar os dois num só torna a consulta "só erros" cara. |
| D4 | `seq` monotônico por run | Timestamps do SQLite empatam em milissegundo; `seq` dá ordem estável e serve de cursor para o SSE (RQ-ASY-04). |
| D5 | Escrita em lote, com buffer | Uma run com 200 spans faria 200 gravações concorrendo com a fila (RQ-NFR-03). |
| D6 | Telemetria nunca derruba a execução | Falha de observação vira log de processo, não erro de negócio (RQ-OBS-10). |

## Modelo de trace

Um trace por run. Hierarquia:

```
run  (traceId)
└── agent:Coordenador                    kind=agent      depth 0
    ├── model:claude-opus-4-8            kind=model
    ├── delegate:Pesquisador             kind=delegate
    │   └── agent:Pesquisador            kind=agent      depth 1
    │       ├── mcp.connect:filesystem   kind=mcp.connect
    │       ├── model:claude-sonnet-5    kind=model
    │       └── tool:filesystem__list_directory  kind=tool
    └── model:claude-opus-4-8            kind=model
```

`traceId` = 16 bytes hex; `spanId` = 8 bytes hex (`crypto.randomBytes`). Contexto
propagado por parâmetro explícito no orquestrador — sem `AsyncLocalStorage`, já que o
fluxo de chamadas é direto e passar o contexto deixa a relação óbvia no código.

**Invariante:** todo span filho abre depois e fecha antes do pai. Um teste percorre a
árvore e verifica isso (aceite do RQ-OBS-01).

## Atributos (RQ-OBS-02)

Span de modelo:

| Atributo | Origem |
| --- | --- |
| `gen_ai.system` | `provider.kind` |
| `gen_ai.request.model` | `params.model` |
| `gen_ai.request.temperature` / `.top_p` / `.top_k` / `.max_tokens` | parâmetros efetivos |
| `gen_ai.usage.input_tokens` / `.output_tokens` | resposta do provedor |
| `gen_ai.response.finish_reason` | `stopReason` |
| `orq.turn` / `orq.tools_offered` | loop do orquestrador |

Span de tool: `orq.tool.name`, `orq.mcp.server`, `orq.tool.args_size`,
`orq.tool.result_size`, `orq.tool.is_error`.
Span de delegação: `orq.delegate.child_agent_id`, `orq.delegate.depth`.

Argumentos e resultados grandes são truncados em 8 KB com marca `…[truncado]`, e passam
pelo mascarador antes de gravar (RQ-SEC-08).

## Taxonomia de erros (RQ-OBS-03)

| `errorType` | Quando | Retentável (004) |
| --- | --- | :-: |
| `provider_error` | HTTP 4xx/5xx do provedor, resposta malformada | 5xx: sim |
| `provider_rate_limit` | 429 ou `rate_limit` no corpo | sim |
| `mcp_connection_error` | handshake, processo morto, timeout de transporte | sim |
| `tool_error` | tool executou e retornou `isError` | não |
| `validation_error` | schema de argumento inválido, tool inexistente | não |
| `timeout` | limite de run ou de passo estourado | não |
| `max_steps_exceeded` | loop atingiu `maxSteps` | não |
| `cancelled` | cancelamento do usuário | não |
| `internal_error` | defeito nosso | não |

A classificação vive em `src/lib/telemetry/errors.ts` e é usada por trace, log, UI,
métricas e política de retentativa — uma definição só.

## Log estruturado (RQ-OBS-04, RQ-OBS-05)

```ts
log.error("Falha ao chamar tool", {
  spanId, errorType: "mcp_connection_error",
  payload: { server: "filesystem", tool: "list_directory", args, attempt: 2 },
});
```

Todo erro registra: categoria, entidade afetada, tentativa e o payload que provocou a
falha, mascarado. Erro de provedor grava status HTTP e corpo truncado em 2 KB — o
suficiente para diagnosticar sem armazenar a resposta inteira.

Níveis: `debug` (payloads completos, desligado por padrão), `info` (marcos), `warn`
(drift, retentativa, truncamento), `error`.

## Escrita em lote (D5, RQ-NFR-03)

```
emit(span|log) → buffer em memória → flush por 250 ms ou 50 registros
                                   → createMany em uma transação
```

- `flush` forçado nas transições de estado da run e ao fechar o SSE, para o cliente nunca
  ver estado parado.
- Buffer com teto de 5.000 registros; ao estourar, descarta `debug` primeiro e emite um
  `warn` contabilizando o descarte.
- `PRAGMA journal_mode=WAL` + `busy_timeout=5000` na inicialização.
- Falha de flush é registrada no stderr e a execução segue (D6/RQ-OBS-10).

## Custo (RQ-OBS-06)

`ModelPrice` (providerKind, model) → custo = tokens/1e6 × preço. Sem preço cadastrado,
`costUsd` fica nulo e a UI mostra "—" em vez de zero. O rótulo é sempre "estimado":
cache de prompt e descontos não são conhecidos aqui.

## Métricas (RQ-OBS-07)

`GET /api/metrics?flowId=&agentId=&window=24h` agrega sobre `Run`/`Span`:
execuções por status, taxa de erro por `errorType`, latência p50/p95, tokens e custo,
tools mais usadas e mais falhas. Percentis por consulta ordenada — o volume não justifica
estrutura pré-agregada; se passar de ~100 mil runs, materializa-se em tabela horária.

## Retenção (RQ-OBS-08)

`Setting` `telemetry.retentionDays` (padrão 30). Rotina diária apaga `Span` e `LogEntry`
mais antigos que o limite e mantém `Run` com os totais já agregados — o histórico de
"o que rodou e como terminou" sobrevive; o detalhe caro, não. `VACUUM` semanal.

## Exportação OTLP (RQ-OBS-09, P2)

Com `OTEL_EXPORTER_OTLP_ENDPOINT` definido, os spans finalizados são convertidos para
OTLP/HTTP JSON e enviados em lote, com falha tolerada (fila em memória, descarte após 3
tentativas). Nenhum atributo com segredo é exportado.

## Impacto no código existente

- [src/lib/orchestrator.ts](../../src/lib/orchestrator.ts): `recordStep` sai; entram
  `tracer.startSpan/endSpan` e `log.*`. O `ctx` passa a carregar `traceId` e o `spanId` corrente.
- [src/lib/providers.ts](../../src/lib/providers.ts) e
  [src/lib/mcp.ts](../../src/lib/mcp.ts): erros passam a subir com categoria em vez de
  `Error` genérico (`ProviderError`, `McpError` com `errorType`).
- Página de execução passa a renderizar árvore + log virtualizado (RQ-NFR-02).
- Migração converte `RunStep` em `Span` preservando ordem e profundidade.

## Alternativas rejeitadas

- **SDK OpenTelemetry + coletor obrigatório** — exigiria infraestrutura externa para ver
  o próprio trace na UI; aqui o banco local é a fonte primária e o OTLP é opcional.
- **Manter `RunStep` e só acrescentar colunas** — não resolve hierarquia real nem log, e
  a visualização (006) precisa das duas coisas.
- **Guardar log como texto no `Run`** — impossível filtrar por nível ou correlacionar
  com span, que é exatamente o que o painel de erros do 006 exige.

## Plano de verificação

1. Run com delegação e tool: árvore correta e invariante de contenção temporal.
2. Derrubar o servidor MCP no meio: span com `mcp_connection_error` e log com args.
3. `GET /api/runs/:id/logs?level=error` devolve só erros, em ordem estável.
4. 4 runs simultâneas gravando spans sem `SQLITE_BUSY`.
5. Banco de telemetria indisponível: a run termina certo e o incidente vai para o stderr.
6. Varredura de spans e logs em busca de segredos cadastrados: nenhum resultado.
7. 1.000 spans e 5.000 logs na página de execução sem travar a interface.
