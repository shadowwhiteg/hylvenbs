# Design 010 · API OpenAI-compatível e tutorial de integração

**Cobre:** RQ-OAI-01 … RQ-OAI-12
**Depende de:** 001 (tokens de API), 002 (versão do fluxo), 004 (fila e `?wait=`), 007 (roteamento)

## O problema

Integrar o orquestrador a um sistema existente hoje custa código: autenticar, `POST
/api/runs` → 202, guardar o `id`, abrir o SSE ou fazer polling, ler o `output`. É um
contrato correto e assíncrono — e é um contrato que ninguém mais fala.

O dialeto `chat/completions` é o denominador comum: SDKs oficiais em toda linguagem,
n8n, Dify, Open WebUI, LibreChat, plugins de IDE e praticamente qualquer ferramenta com
um campo "base URL + API key + model". Falar esse dialeto transforma cada orquestrador
publicado num modelo plugável — integração por configuração, não por código.

A tensão do design é uma só: **o orquestrador não é um modelo**. Ele é assíncrono, não
produz tokens incrementais, tem topologia versionada e ignora `temperature`. Compatível
aqui significa *o cliente não quebra*, não *finge ser um LLM*.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Montar em `/api/v1/…`, não em `/v1/…` | Middleware, `permissionForRoute` e o teste de cobertura de rotas keyam em `/api/`. Cliente configura `base_url = <host>/api/v1` e o SDK acrescenta `/chat/completions` — mesmo resultado, zero exceção na malha de auth. |
| D2 | `model` = `<slug do fluxo \| id do agente>[@<versão\|current>]` | Muitos clientes só oferecem um campo de texto para o modelo. Tudo que precisa ser escolhido tem que caber ali (RQ-OAI-02, RQ-OAI-04). Slug primeiro porque é legível e estável; id como escape. |
| D3 | Extensões também por corpo (`orq_task_type`, `orq_flow_version`), com o sufixo do `model` tendo precedência | Clientes que permitem corpo extra ganham ergonomia; o sufixo continua sendo o caminho universal. Precedência fixa evita conflito ambíguo. |
| D4 | Uma requisição = uma run, sem estado | Sessão implícita no servidor criaria memória invisível ao cliente e vazamento entre chamadas do mesmo token (RQ-OAI-07). O histórico vem no `messages`, como no dialeto original. |
| D5 | `messages` achatado num único texto rotulado por papel | O orquestrador recebe `input: string`. Achatar rotulado preserva a informação; descartar tudo menos a última mensagem perderia o contexto que o cliente enviou (RQ-OAI-06). |
| D6 | Espera limitada reusando `waitForTerminal`; estouro → 504 **sem cancelar** a run | A execução continua e fica consultável pelo `run_id` devolvido. Cancelar desperdiçaria trabalho já pago por um limite que é do transporte, não do fluxo (RQ-OAI-08). |
| D7 | `stream: true` responde chunks reais, mas não incrementais: `role` → conteúdo final → `[DONE]` | Recusar streaming quebraria a maioria das integrações (muitas o ativam por padrão). Fatiar o texto final em pedaços fingidos simularia progresso que não existe. Chunk único é compatível e honesto (RQ-OAI-09). |
| D8 | `tools`/`functions`/`n>1` → 400; parâmetros de amostragem ignorados e documentados | Ferramentas quem decide é o fluxo (MCP + delegação): aceitá-las silenciosamente prometeria algo que não acontece. Já `temperature` ignorado é inofensivo e recusá-lo quebraria clientes que sempre o enviam (RQ-OAI-10). |
| D9 | Erros no envelope `{"error": {message, type, code}}` da OpenAI | É o que os SDKs desempacotam; devolver o `{error, code}` da casa produziria exceção de parsing em vez de mensagem legível (RQ-OAI-01). |
| D10 | Tutorial de integração vive **na tela de tokens**, com seletor de orquestrador | É onde o token é emitido e o único lugar em que ele existe em claro por um instante — o trecho pronto para copiar tem que estar ao lado dele (RQ-OAI-12). |

## Superfície

```
POST /api/v1/chat/completions    run.create   conversa → execução
GET  /api/v1/models              agent.read   catálogo de orquestradores
```

Ambas entram no [api-registry](../../src/lib/api-registry.ts) (T4, RQ-NFR-05), o que já
lhes dá permissão resolvida, página `/api`, Postman Collection e cobertura no teste de
rotas. Autenticação exclusivamente por `Authorization: Bearer <token>` (RQ-OAI-05) — o
mesmo header que o dialeto usa para a chave de API, o que faz a compatibilidade sair de
graça.

### `GET /api/v1/models`

```json
{ "object": "list", "data": [
  { "id": "atendimento-fiat", "object": "model", "created": 1739750400,
    "owned_by": "orquestrador",
    "orq": { "agent_id": "clx…", "flow_id": "clx…", "published_version": 3, "name": "Atendimento Fiat" } }
]}
```

Um item por agente `orchestrator` não excluído. `id` é o slug do fluxo quando existe, o
id do agente quando o orquestrador ainda não foi agrupado — e é exatamente o valor aceito
em `model` (RQ-OAI-03). Campos fora do padrão ficam sob a chave `orq`, que clientes
ignoram.

### `POST /api/v1/chat/completions`

Entrada relevante: `model`, `messages`, `stream`. Ignorados com registro em log de
`debug`: `temperature`, `top_p`, `max_tokens`, `stop`, `presence_penalty`,
`frequency_penalty`, `seed`, `user`. Recusados com 400: `tools`, `functions`,
`tool_choice`, `n > 1`, `logprobs` (D8).

Resolução do `model` (D2/D3):

```
"atendimento-fiat"        → rascunho vigente do fluxo   (= POST /api/runs sem flowVersion)
"atendimento-fiat@3"      → versão publicada 3
"atendimento-fiat@current"→ versão publicada atual
"clx123…"                 → mesmo, pelo id do agente raiz
desconhecido              → 404 { error: { code: "model_not_found" } }
```

Achatamento das mensagens (D5), determinístico e testável:

```
[system] Você é um atendente.
[user] Qual a garantia do Pulse?
[assistant] São 3 anos.
[user] E do Argo?
```

Partes de conteúdo (`content: [{type:"text",text:"…"}]`) são concatenadas; partes de
imagem/áudio produzem 400 `unsupported_content` — melhor recusar que descartar em
silêncio. Uma conversa de uma única mensagem `user` vira o texto puro, sem rótulo: é o
caso mais comum e o rótulo só ruído.

Resposta:

```json
{ "id": "chatcmpl-<runId>", "object": "chat.completion", "created": 1739750400,
  "model": "atendimento-fiat@3",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "…" },
                "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 812, "completion_tokens": 240, "total_tokens": 1052 },
  "orq": { "run_id": "…", "flow_version": 3, "model_failover": false, "cost_usd": 0.0031 } }
```

`id` embute o `runId` (RQ-OAI-11) e `orq.run_id` o repete sem prefixo, para o cliente que
quiser abrir `GET /api/runs/:id`. Tokens vêm dos agregados da run — a soma de **todas**
as chamadas de modelo do fluxo, não de uma; a documentação diz isso, porque o número não
é comparável ao de um LLM único.

Mapa de término:

| Run | HTTP | `finish_reason` / erro |
| --- | --- | --- |
| `succeeded` | 200 | `stop` |
| `succeeded` com `max_steps_exceeded` | 200 | `length` |
| `failed` | 502 | `type: "upstream_error"`, com `run_id` |
| `cancelled` | 409 | `type: "run_cancelled"` |
| `timed_out` | 504 | `type: "run_timeout"` |
| ainda executando ao fim da espera | 504 | `type: "run_pending"`, com `run_id` (D6) |

### Streaming (D7)

```
data: {"id":"chatcmpl-…","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}
data: {"id":"chatcmpl-…","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"…"}}]}
data: {"id":"chatcmpl-…","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

O primeiro chunk sai assim que a run é enfileirada — o cliente confirma a conexão sem
esperar o fluxo inteiro. Durante a espera, comentários SSE (`: keep-alive`) a cada 15 s
evitam que proxies derrubem a conexão. Erro no meio do stream vira um chunk com
`orq.error` seguido de `[DONE]`, porque o status HTTP já foi enviado.

## Origem da execução (RQ-OAI-11)

`Run` ganha `source String @default("ui")` — `"ui"`, `"api"`, `"openai"`. É a única
mudança de schema desta fase, aditiva e com valor padrão. Serve para responder "quanto do
tráfego vem das integrações externas" sem inferir por heurística, e aparece na listagem
de execuções como etiqueta.

## Tutorial em "Meus tokens" (D10, RQ-OAI-12)

A tela [/conta/tokens](../../src/app/conta/tokens/page.tsx) ganha, abaixo da lista, um
bloco **"Conectar via API OpenAI-compatível"** com dois seletores — orquestrador
(carregado de `GET /api/v1/models`) e versão (rascunho / publicada atual / número) — que
regeneram, ao vivo:

| Campo | Valor gerado |
| --- | --- |
| URL base | `<origin>/api/v1` |
| API key | o token recém-criado quando há um; senão `SEU_TOKEN` |
| Model | `atendimento-fiat@current` |

E os trechos, em abas: `curl`, Python (SDK `openai`), JavaScript (SDK `openai`), e
**"Outro sistema"** — a tabela de para-onde-vai-cada-campo em n8n, Dify, Open WebUI e
similares, que é onde a maioria trava.

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/api/v1", api_key="SEU_TOKEN")
r = client.chat.completions.create(
    model="atendimento-fiat@current",
    messages=[{"role": "user", "content": "Qual a garantia do Pulse?"}],
)
print(r.choices[0].message.content)
```

O bloco traz as três armadilhas em destaque, porque são as que geram chamado: **sem
memória entre chamadas** (D4), **`temperature` e afins são ignorados** (D8), e **a
primeira resposta demora o que o fluxo demorar** — com a recomendação de subir o timeout
do cliente.

## Alternativas rejeitadas

- **Rewrite de `/v1/*` para `/api/v1/*`** — economiza quatro caracteres na URL do cliente
  e abre um buraco na malha de auth, que é toda ancorada em `/api/` (D1). Reavaliável se
  algum cliente relevante fixar `/v1` na raiz.
- **`model` = id do agente apenas** — funciona, mas o usuário cola um cuid opaco num
  campo de configuração que ele vai reler daqui a seis meses. O slug é a mesma
  informação, legível.
- **Streaming fatiado artificialmente** — dividir a resposta final em pedaços de N
  caracteres com atraso simularia progresso inexistente: a resposta só existe quando o
  fluxo inteiro termina (D7).
- **Aceitar `tools` repassando ao orquestrador** — as tools do fluxo vêm dos servidores
  MCP e da delegação, congeladas no snapshot. Aceitar tools do cliente exigiria um
  protocolo de devolução de tool-calls através de uma execução assíncrona de vários
  níveis — outra fase, não um detalhe deste endpoint (D8).
- **Endpoint `/v1/completions` (legado) e `/v1/embeddings`** — o primeiro está morto no
  ecossistema, o segundo não tem nada a ver com orquestração.
- **Autenticar com chave dedicada por orquestrador** — duplicaria o sistema de tokens já
  existente, com outro ciclo de revogação. O token da plataforma já carrega papel e
  auditoria (RQ-OAI-05).

## Plano de verificação

1. SDK oficial `openai` (Python) com `base_url = <host>/api/v1` recebe resposta válida,
   sem tratamento especial (RQ-OAI-01).
2. `GET /api/v1/models` lista os orquestradores; cada `id` devolvido funciona como
   `model` (RQ-OAI-02, RQ-OAI-03).
3. `model: "<slug>@2"` com a versão 3 publicada executa a 2 — conferido pelo
   `flowVersionId` da run (RQ-OAI-04).
4. Sem header → 401; token de `viewer` → 403 em completions e 200 em models (RQ-OAI-05).
5. Conversa de três turnos: `Run.input` contém os três rótulos na ordem (RQ-OAI-06).
6. Teto de espera de 5 s com fluxo mais longo → 504 com `run_id`, e a run chega a
   `succeeded` depois (RQ-OAI-08).
7. `stream=True` no SDK oficial monta a resposta completa e encerra em `[DONE]`
   (RQ-OAI-09).
8. `n: 2` → 400 `unsupported_parameter`; `temperature: 0` não altera o valor do snapshot
   registrado no span (RQ-OAI-10).
9. `id` da resposta contém o `runId` e `GET /api/runs/:id` traz `source: "openai"`
   (RQ-OAI-11).
10. Na tela de tokens, trocar o orquestrador atualiza os três trechos; o `curl` exibido,
    colado num terminal com um token válido, responde 200 (RQ-OAI-12).
