# Design 004 · Execução assíncrona

**Cobre:** RQ-ASY-01 … RQ-ASY-12
**Depende de:** 003 (spans e logs viajam pelo SSE) · **Bloqueia:** 006 (estado ao vivo)

## O problema

`POST /api/runs` executa a orquestração dentro do handler e só responde no fim
([src/app/api/runs/route.ts](../../src/app/api/runs/route.ts), `maxDuration = 300`).
Consequências: o cliente fica preso, não há cancelamento, um `Ctrl+C` no servidor perde a
run sem deixar registro, e não existe limite de execuções simultâneas — dez cliques dão
dez orquestrações concorrendo pelo mesmo SQLite.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Fila no próprio SQLite, worker no mesmo processo | Sem Redis, sem serviço extra (T1/T3). A carga alvo é dezenas de runs/dia. |
| D2 | Claim atômico com `UPDATE … WHERE status='queued'` | Correção sob concorrência sem lock de aplicação; funciona também se um dia houver dois processos. |
| D3 | SSE, não WebSocket | O fluxo é unidirecional (servidor→cliente), reconecta sozinho e tem `Last-Event-ID` nativo — que é exatamente o RQ-ASY-04. |
| D4 | Cancelamento cooperativo com `AbortSignal` | `fetch` e o cliente MCP já aceitam signal; matar thread não existe em Node e matar o processo levaria tudo junto. |
| D5 | Retentativa só para erro transitório | Repetir `tool_error` ou `max_steps_exceeded` gasta dinheiro e repete o mesmo defeito. |
| D6 | `?wait=` preservado para automação | A Postman Collection e scripts continuam com uma chamada só, sem voltar ao modelo síncrono por baixo (RQ-ASY-11). |

## Máquina de estados (RQ-ASY-02)

```
            ┌──────────► cancelled ◄─────────┐
            │                                │
queued ──► running ──► succeeded             │
   │          │                              │
   │          ├──► failed ──(transitório)──► queued   (retentativa, RQ-ASY-09)
   │          └──► timed_out                 │
   └────────────────────────────────────────-┘  (cancelamento antes de iniciar)
```

Transições passam por `transition(runId, from[], to)` que aplica `WHERE status IN (from)`.
Zero linhas afetadas = transição inválida → `internal_error` registrado. Estados finais
(`succeeded`, `cancelled`, `timed_out`, `failed` sem retentativa restante) não voltam.

## Fila e worker

**Claim (D2)** — uma sentença, sem transação de aplicação:

```sql
UPDATE Run
   SET status='running', lockedBy=?, lockedAt=?, heartbeatAt=?, startedAt=COALESCE(startedAt,?),
       attempt = attempt + 1
 WHERE id = (SELECT id FROM Run
              WHERE status='queued'
                AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
              ORDER BY priority DESC, queuedAt ASC
              LIMIT 1)
   AND status='queued'
RETURNING id;
```

**Ciclo do worker**

```
instrumentation.ts (register)
  └── Worker.start()
        ├── recovery()   ← na subida
        ├── loop: enquanto ativos < concorrência → claim() → execute()
        └── tick a cada 500 ms ou quando notificado por evento interno
```

- **Concorrência** (`Setting` `queue.concurrency`, padrão 3) limita execuções simultâneas;
  o excedente espera por ordem de chegada (RQ-ASY-06).
- **Heartbeat** a cada 10 s durante a execução.
- **Recuperação (RQ-ASY-07)**: na subida, runs `running` com `lockedBy` deste processo,
  ou com `heartbeatAt` mais velho que 60 s, viram `failed`/`internal_error` com log
  explicando; runs `queued` voltam ao loop. Ninguém é executado duas vezes porque o claim
  exige `status='queued'`.
- **Timeout (RQ-ASY-08)**: `AbortController` armado com `Run.timeoutMs` (padrão 10 min);
  ao disparar, a run vira `timed_out` e libera a vaga.

**Nota de escala (T3):** worker in-process significa que reiniciar a aplicação interrompe
execuções em andamento — recuperadas como `failed`, nunca perdidas em silêncio. Para
múltiplas réplicas, o `lockedBy` + heartbeat já suportam vários workers; o que muda é o
barramento de eventos (ver abaixo).

## Retentativa (RQ-ASY-09)

Só para `errorType` marcado como retentável em
[003](003-observabilidade-traces.md#taxonomia-de-erros-rq-obs-03).

```
espera = min(2^(attempt-1) × 1000 ms, 60 s) × (0,5 + random/2)     // jitter
```

`maxAttempts` padrão 3 para erro transitório, 1 para o resto. Cada tentativa é um span
próprio com `attempt`, então o trace mostra as três chamadas — e não uma só.

## Transmissão ao vivo (RQ-ASY-03, RQ-ASY-04)

```
GET /api/runs/:id/events            (text/event-stream)
  Last-Event-ID: 128                ← cursor = LogEntry.seq / Span.seq
```

Eventos: `status` (mudança de estado), `span.start`, `span.end`, `log`, `done`.
Cada um leva `id: <seq>`; o cliente reconecta e o servidor reenvia `seq > cursor` do banco
antes de voltar ao tempo real — o mesmo caminho serve para abrir a página no meio da
execução.

**Barramento:** `EventEmitter` in-process; o handler SSE assina por `runId`. Se o
emissor não estiver no mesmo processo, cai para polling do banco a cada 1 s (mesmo
contrato, latência maior). Keep-alive `:ping` a cada 15 s. Ao final: evento `done` e
fechamento pelo servidor — o cliente não fica reconectando em run terminada.

## Cancelamento (RQ-ASY-05)

```
POST /api/runs/:id/cancel
  queued  → cancelled imediatamente
  running → grava cancelRequestedAt e dispara o AbortController do worker
```

O signal é propagado até `fetch` (provedores) e até o cliente MCP — o que exige
acrescentar `signal` em [src/lib/providers.ts](../../src/lib/providers.ts) e
[src/lib/mcp.ts](../../src/lib/mcp.ts). O loop do orquestrador também checa o signal entre
passos, garantindo parada mesmo se a chamada em andamento ignorar o abort. Spans abertos
fecham como `cancelled`. Alvo: 2 s (aceite do RQ-ASY-05).

## Idempotência (RQ-ASY-10)

Header `Idempotency-Key` → coluna `Run.idempotencyKey @unique`. Chave repetida devolve
200 com a run original em vez de 202 — protege o duplo clique e o retry de rede do CI.

## Contratos de API

| Método | Rota | Resposta |
| --- | --- | --- |
| POST | `/api/runs` | **202** `{ id, status: "queued" }` (era 201 síncrono) |
| POST | `/api/runs?wait=30` | 200 com a run concluída, ou 200 com `status: "running"` se estourar |
| GET | `/api/runs/:id` | run + totais (spans sob demanda) |
| GET | `/api/runs/:id/events` | SSE |
| GET | `/api/runs/:id/logs?level=&spanId=&after=` | log paginado por `seq` |
| POST | `/api/runs/:id/cancel` | 202 · 409 se já finalizada |
| GET | `/api/health` | `{ queue: { depth, running, oldestWaitMs }, db, version }` |

**Quebra de contrato assumida:** quem hoje espera o resultado no corpo do `POST /api/runs`
precisa passar a usar `?wait=` ou consultar depois. A Postman Collection e o Playground
são atualizados junto; está registrado no CHANGELOG e nas notas da collection.

## UI

- Playground: dispara, mostra "na fila / executando" com botão *Cancelar*, e o trace
  crescendo ao vivo pelo SSE.
- Listagem de execuções: contadores de fila e filtro por estado, incluindo `cancelled` e
  `timed_out`.
- Página de execução: reconecta sozinha e funciona igual para run em andamento ou concluída.

## Alternativas rejeitadas

- **BullMQ/Redis** — resolveria fila e eventos, mas exige serviço externo, contrariando o
  alvo self-host de processo único (T3).
- **Worker em processo separado** — mais robusto (reiniciar a web não mata as runs), porém
  duplica o bootstrap e exige IPC ou polling. Registrado como evolução natural quando
  houver necessidade real de isolamento.
- **WebSocket** — bidirecionalidade não é necessária; SSE reconecta e retoma sozinho.
- **Polling puro na UI** — simples, mas gera latência visível no grafo ao vivo (006) e
  carga constante no SQLite.

## Plano de verificação

1. `POST /api/runs` responde &lt;300 ms para fluxo longo.
2. Concorrência 2 com 5 runs: no máximo 2 `running`, ordem de chegada respeitada.
3. Cancelar durante chamada de modelo: `cancelled` em até 2 s, span marcado.
4. Matar o processo com run em andamento e reiniciar: exatamente uma run finalizada.
5. Timeout de 10 s com tool lenta → `timed_out`.
6. Provedor com 429, 429, 200 → `succeeded` em `attempt: 3`, três spans.
7. Desconectar o SSE por 5 s e reconectar com `Last-Event-ID`: sequência completa.
8. Dois POST com o mesmo `Idempotency-Key` → mesmo `id`.
9. Transições inválidas rejeitadas.
