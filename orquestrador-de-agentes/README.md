# Orquestrador de Agentes

Plataforma para desenvolver e gerenciar orquestradores de agentes e subagentes, com
web UI (tema claro/escuro), troca de provedores de LLM, ajuste dos parâmetros do
modelo, gerenciamento de servidores MCP e exportação de **Postman Collection** de
toda a API.

## Rodando

```bash
npm install
npm run generate-key    # gera ENCRYPTION_KEY — copie a saída para o .env
npm run dev              # aplica as migrações do Prisma e sobe em http://localhost:3000
```

Com o banco vazio, acesse `/setup` (ou rode `npm run create-admin`) para criar o
primeiro administrador — não há auto-cadastro. Todo usuário depois disso é criado
por um admin em **Usuários**, com senha temporária mostrada uma única vez.

`ENCRYPTION_KEY` é obrigatória assim que houver algum segredo cifrado no banco; sem
ela e com dados existentes o servidor recusa subir (ver
[specs/design/005-criptografia-segredos.md](specs/design/005-criptografia-segredos.md)).
Chaves de API e variáveis de ambiente/headers de servidores MCP são cifradas em
repouso (AES-256-GCM) — nunca aparecem em claro nas respostas da API. Chaves de
provedor também podem vir de `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` no `.env`.

```bash
npm test                 # testes de unidade e de arquitetura (node --test)
npm run migrate:secrets  # idempotente — cifra qualquer valor legado em claro
npm run migrate:flows    # idempotente — agrupa orquestradores pré-Fase-5 num fluxo com v1 publicada
npm run rotate-keys      # rotação de chave mestra (ver ENCRYPTION_KEY_V<N-1>)
npm run create-admin     # cria o primeiro admin por linha de comando (alternativa a /setup)
```

## Fluxo de uso

1. **Provedores** — cadastre Anthropic, OpenAI ou qualquer endpoint compatível
   (Ollama, vLLM, Groq…). O botão *Modelos* consulta o `/models` do provedor e
   preenche a lista; se falhar, cai numa lista sugerida. Só `admin` grava a chave.
2. **Servidores MCP** — registre servidores por `stdio` (comando + args + env) ou
   `http` (URL + headers). Um `editor` pode declarar os *nomes* das variáveis; só um
   `admin` preenche os *valores* (botão de segredo no card). *Testar* faz o
   handshake MCP e lista as tools.
3. **Agentes** — crie subagentes, agentes intermediários e um orquestrador. No editor
   você troca de provedor/modelo, ajusta temperature, top_p, top_k, max tokens, stop
   sequences e o limite de passos do loop de tools, e marca quais servidores MCP e
   quais agentes/subagentes o agente pode delegar (orquestrador e agente delegam;
   subagente só executa). Todo orquestrador é a raiz de um **fluxo**, criado
   automaticamente — o card *Fluxo* mostra se há alterações não publicadas e publica
   versões direto dali. Um **agente** intermediário nunca é raiz de fluxo.
4. **Roteamento** — cadeias ordenadas de modelos por tipo de tarefa, reutilizáveis
   entre agentes; se o modelo preferido estiver fora do ar, o próximo assume sozinho.
5. **Fluxos** — linha do tempo de versões de cada orquestrador, com publicar,
   comparar (diff estrutural), rollback e o **Grafo**: topologia da versão escolhida
   (ou do rascunho), com zoom/pan/ajustar, exportação SVG/PNG e uma árvore acessível
   equivalente ao lado.
6. **Playground** — enfileira a execução de verdade e acompanha ao vivo (fila →
   executando → resultado), com botão para cancelar, opção de fixar a versão
   publicada em vez do rascunho ao vivo, e um grafo compacto mostrando a delegação
   acontecer nó a nó.
7. **Execuções** — grafo da execução em cima (estado por nó/aresta ao vivo, sempre a
   partir do snapshot que rodou) e log virtualizado embaixo, sincronizados: clicar num
   nó filtra o log, clicar numa linha de log seleciona o nó; filtro por estado
   (`queued`, `running`, `succeeded`, `failed`, `cancelled`, `timed_out`) na listagem e
   a versão do fluxo usada em cada run.
8. **API & Postman** — baixe a collection e controle tudo por HTTP com um token de
   API (**Meus tokens**, `Authorization: Bearer oaa_...`). A mesma tela traz o tutorial
   de integração via API OpenAI-compatível, com seletor de orquestrador e versão.
9. **Tutorial** — o percurso completo da plataforma numa única tela, com progresso
   derivado do estado real (nunca marcado à mão) e um atalho contextual em cada tela
   apontando para o passo correspondente.
10. **Usuários** (só `admin`) — cadastro, troca de papel, redefinição de senha e
    desativação. **Auditoria** lista os eventos sensíveis.

## Como a orquestração funciona

Cada agente ou subagente ligado a um orquestrador ou agente intermediário vira uma
tool `delegate_to_<nome>` com um único parâmetro `task`. Cada tool de servidor MCP
vira `<servidor>__<tool>`. O agente roda um loop de tool-calling até responder sem
chamar tools ou atingir `maxSteps`; delegações recursivas são limitadas a 3 níveis,
então a cadeia executável mais longa é orquestrador → agente → agente → subagente.

## Observabilidade

Cada execução gera uma árvore de `Span` (`agent` → `model`/`tool`/`delegate`/
`mcp.connect`, com `parentSpanId` e profundidade reais) e `LogEntry` correlacionado,
gravados em lote (`src/lib/telemetry/buffer.ts`) para não concorrer com o resto da
aplicação. Erros são classificados numa taxonomia única (`provider_error`,
`provider_rate_limit`, `mcp_connection_error`, `tool_error`, `validation_error`,
`timeout`, `max_steps_exceeded`, `cancelled`, `internal_error`) usada pelo trace, pelo
log, pela UI e pelo `GET /api/metrics` (execuções por status, taxa de erro, latência
p50/p95, tokens, custo estimado e tools mais usadas). Atributos e payloads passam por
um mascarador antes de gravar — nunca guardam segredo em claro. Retenção diária
(`Setting.telemetry.retentionDays`, padrão 30 dias) apaga spans/logs antigos e mantém
os totais agregados na própria `Run`.

## Execução assíncrona

`POST /api/runs` enfileira e responde **202** com `{ id, status: "queued" }` — não
segura mais a conexão até a orquestração terminar. Um worker in-process
(`src/lib/queue/worker.ts`) reivindica runs com um `UPDATE ... WHERE status='queued'`
atômico, respeita `Setting.queue.concurrency` (padrão 3) e dá heartbeat a cada 10s.
`GET /api/runs/:id/events` transmite spans, logs e mudanças de estado ao vivo por SSE,
com `Last-Event-ID` para retomar sem perda numa reconexão. `POST /api/runs/:id/cancel`
propaga um `AbortSignal` até o `fetch` do provedor e o cliente MCP — cancela em até
~2s. Runs com erro transitório (`provider_rate_limit`, `mcp_connection_error`) voltam
sozinhas para a fila com espera exponencial e jitter; as demais falham direto. Um
timeout por run (`Run.timeoutMs`, padrão 10min) libera a vaga sozinho. Reiniciar o
processo marca qualquer run `running` órfã como `failed`/`internal_error` — nenhuma
roda duas vezes. `?wait=<segundos>` (máx. 120) e o header `Idempotency-Key` continuam
disponíveis para automação que prefere uma chamada só. `GET /api/health` expõe
profundidade da fila, execuções em andamento e espera mais antiga.

## Versionamento de fluxos

Todo orquestrador é a raiz de um `Flow`, criado junto com o agente. A configuração
ao vivo dos agentes (prompt, parâmetros, vínculos MCP, arestas de delegação) é o
**rascunho**; `POST /api/flows/:id/publish` resolve o grafo a partir da raiz por
travessia em `AgentLink`, canonicaliza e grava um `FlowVersion` imutável com hash de
conteúdo — publicar sem mudanças responde **409** `no_changes`. `GET /api/flows/:id`
recalcula o hash do rascunho e devolve `isDirty` sempre correto (sem flag mantido à
mão). `GET /api/flows/:id/diff?from=&to=` compara duas versões (ou o rascunho) campo a
campo; `POST .../versions/:n/rollback` reaplica um snapshot antigo sobre o rascunho e
publica uma versão **nova** — nada do histórico é apagado ou reescrito. Etiquetas
(`POST .../versions/:n/tag`) são únicas por fluxo; mover uma etiqueta é só apontar
para outra versão.

`POST /api/runs` aceita `flowVersion` opcional (`"current"` ou um número) — sem ele a
run executa o rascunho ao vivo e grava o snapshot efêmero usado (`Run.draftSnapshot`,
rotulada `sourceKind: "draft"`); com ele, a execução fica fixada na topologia e nos
parâmetros daquele `FlowVersion.snapshot`, mesmo que o rascunho mude depois. Só
provedor (segredo) e servidor MCP (processo/URL) são resolvidos ao vivo, por id — o
resto vem congelado. Antes de rodar uma versão fixada, o `configHash` de cada servidor
MCP é recalculado e comparado ao gravado no snapshot; divergência não bloqueia, só
marca `Run.configDrift: true` e `driftDetail`, e emite um log `warn`. Excluir um
agente ou servidor MCP referenciado por uma versão publicada é sempre exclusão lógica
(`deletedAt`) — a versão continua íntegra e executável; a linha só some das listagens
e do próximo snapshot publicado.

## Visualização gráfica

`GET /api/flows/:id/graph?version=` e `GET /api/runs/:id/graph` devolvem nós e
arestas prontos para desenhar (`src/lib/graph/build.ts`), a partir do mesmo
`FlowSnapshot` que já alimenta versionamento e execução — nunca da configuração
atual, então abrir uma run antiga ou uma versão antiga desenha a topologia daquela
época. `src/lib/graph/layout.ts` é um layout em camadas puro e determinístico (BFS a
partir da raiz + duas passadas de baricentro para reduzir cruzamentos, empate
resolvido pelo id do nó) — mesma topologia sempre produz as mesmas coordenadas, sem
depender de histórico de renderização ou de uma simulação de força. O SVG
(`src/components/graph/GraphView.tsx`) é renderizado à mão (sem canvas nem
`@xyflow/react`), com zoom/pan/ajustar por `viewBox`.

O estado por nó (`ocioso`/`executando`/`concluído`/`falhou`/`cancelado`) e as
contagens por aresta vêm de `buildRuntime()` (`src/lib/graph/runtime.ts`), que
reconstrói quem chamou quem subindo a cadeia de spans (span do agente → span
`delegate` que o chamou → span do agente chamador) em vez de confiar em atributos
livres, e casa falhas de `mcp.connect` com o servidor MCP pelo nome — uma falha de
conexão marca o **nó do servidor**, não só o agente que tentou usá-lo. O mesmo
`buildRuntime()` roda no servidor (`GET /api/runs/:id/graph`) e no cliente
(`useRunGraph.ts`, reaplicado a cada evento SSE) — um só caminho para "ao vivo" e
"depois", nunca dois reducers divergentes. Erro nunca é só cor: todo nó em falha tem
ícone (⚠) e o `errorType` por extenso ao lado, com contraste verificado nos dois
temas. Uma árvore (`GraphTree.tsx`, `role="tree"`) navegável por setas e Enter é
equivalente ao SVG para quem usa teclado ou leitor de tela.

O log da execução (`src/components/logs/LogPanel.tsx`) é virtualizado à mão (altura
fixa por linha, só a janela visível + folga é renderizada) para aguentar milhares de
linhas sem travar a interface, com filtro por nível/texto/nó selecionado, "seguir
execução" com religamento automático e uma aba só com erros agrupados por tipo.
Clicar num nó do grafo filtra o log por ele; clicar numa linha do log seleciona o nó
correspondente — a mesma seleção também abre o painel de detalhe da falha (mensagem,
métricas, arestas). SVG/PNG do grafo e JSON/texto do log (respeitando os filtros
ativos) podem ser exportados para abrir fora da aplicação.

## Roteamento de modelos

Um agente não precisa ficar preso a um modelo. Uma **cadeia** é uma lista ordenada de
candidatos `(provedor, modelo)` para um **tipo de tarefa** — `POST /api/runs` aceita
`taskType` e escolhe a cadeia correspondente, caindo para a cadeia `default` quando o
tipo não foi declarado. A ordem é a preferência: o primeiro é tentado primeiro.

Cadeias vivem em **políticas** reutilizáveis (`/api/model-policies`) para que a mesma
sequência não seja redigitada em cada agente; um agente pode ainda declarar candidatos
próprios, que prevalecem sobre a política sem alterá-la. Agente sem política e sem
candidatos continua executando pelo `provider`/`model` de sempre — que entra na cadeia
como último recurso, então nada quebra por omissão.

Duas camadas decidem a ordem, e elas são deliberadamente separadas:

- **Preferência declarada** — o `rank` que você editou (empate resolvido pelo id, nunca
  ambíguo).
- **Disponibilidade observada** — falhas consecutivas por par (provedor, modelo) abrem
  uma carência que **desprioriza** o candidato, sem removê-lo. Um sucesso zera o
  contador na hora. `GET /api/model-health` mostra quem está em carência e por quê.
  Bloquear em vez de reordenar transformaria indisponibilidade parcial em falha total
  quando toda a cadeia estivesse em carência.

Quando a chamada falha por indisponibilidade (5xx, limite de taxa, modelo inexistente,
credencial inválida), o próximo candidato é acionado **dentro da mesma execução** — sem
refazer os turnos já pagos. Cancelamento, timeout da run e erro de validação **não**
disparam failover: o primeiro é decisão do usuário, o último falharia igual no próximo
modelo. Cada tentativa gera seu próprio span, então o trace mostra a cadeia inteira
(um span em erro seguido do que serviu), e a run é marcada com `modelFailover` sempre
que a cadeia foi exercitada além do primeiro candidato — inclusive quando todos falham,
caso em que a run falha com o erro do **último** tentado.

A cadeia resolvida é congelada no snapshot da versão publicada, por tipo de tarefa
(RQ-ROT-10): editar uma política depois **não** altera o que uma versão publicada
executa, e o diff entre versões mostra a mudança em `routing.chains`.

## API OpenAI-compatível

Qualquer orquestrador publicado pode ser chamado como se fosse um modelo, pelo dialeto
`chat/completions` que a maioria dos SDKs, n8n, Dify, Open WebUI e afins já fala:

```
POST /api/v1/chat/completions   run.create   { model, messages, stream? }
GET  /api/v1/models             agent.read   catálogo de orquestradores
```

`model` é `"<slug do fluxo|id do agente>[@<versão|current>]"` — o slug é o que a tela
de **Meus tokens** oferece pronto para copiar, junto com um tutorial de integração
(URL base, chave e trechos em curl/Python/JavaScript). `messages` é achatado num único
texto rotulado por papel; uma execução é assíncrona por baixo, então a resposta espera
até um teto e devolve o `run_id` se a run ainda estiver em andamento (nunca cancela por
isso). `stream: true` responde em chunks reais — role, depois o texto final, depois
`[DONE]` — sem fingir progresso token a token, porque a resposta só existe quando o
fluxo inteiro termina. `tools`, `functions` e `n > 1` são recusados; `temperature` e
parâmetros de amostragem são aceitos e ignorados. Detalhes e a tabela de término em
[specs/design/010-api-openai-compativel.md](specs/design/010-api-openai-compativel.md).

## Arquitetura

| Caminho | Papel |
| --- | --- |
| [src/lib/orchestrator.ts](src/lib/orchestrator.ts) | Loop de execução, delegação e trace — executa a partir de um snapshot resolvido |
| [src/lib/flows/snapshot.ts](src/lib/flows/snapshot.ts) | Resolução do grafo, canonicalização e hash de conteúdo |
| [src/lib/flows/diff.ts](src/lib/flows/diff.ts) | Diff estrutural entre dois snapshots |
| [src/lib/flows/drift.ts](src/lib/flows/drift.ts) | Compara `configHash` do snapshot com o servidor MCP ao vivo |
| [src/lib/flows/rollback.ts](src/lib/flows/rollback.ts) | Reaplica um snapshot sobre as linhas ao vivo |
| [src/lib/routing/resolve.ts](src/lib/routing/resolve.ts) | Resolve a cadeia de candidatos por tipo de tarefa e prioridade (função pura) |
| [src/lib/routing/health.ts](src/lib/routing/health.ts) | Saúde por (provedor, modelo), carência e ordenação por disponibilidade |
| [src/lib/routing/failover.ts](src/lib/routing/failover.ts) | Que erro justifica tentar o próximo candidato |
| [src/lib/graph/layout.ts](src/lib/graph/layout.ts) | Layout em camadas puro e determinístico (redução de cruzamentos por baricentro) |
| [src/lib/graph/build.ts](src/lib/graph/build.ts) | Converte um `FlowSnapshot` em nós/arestas para desenhar |
| [src/lib/graph/runtime.ts](src/lib/graph/runtime.ts) | Agrega spans em estado por nó e contagem por aresta — roda no servidor e no cliente |
| [src/components/graph](src/components/graph) | Renderizador SVG, árvore acessível, painel de detalhe e reducer ao vivo |
| [src/components/logs/LogPanel.tsx](src/components/logs/LogPanel.tsx) | Log virtualizado com filtros, seguir execução e aba de erros |
| [src/lib/providers.ts](src/lib/providers.ts) | Adaptadores Anthropic e OpenAI-compatible (formato normalizado de mensagens/tools) |
| [src/lib/mcp.ts](src/lib/mcp.ts) | Cliente MCP JSON-RPC (stdio e HTTP streamable) |
| [src/lib/api-registry.ts](src/lib/api-registry.ts) | Fonte única dos endpoints → alimenta a página `/api` e a Postman Collection |
| [src/lib/tutorial](src/lib/tutorial) | Conteúdo e progresso do tutorial guiado (`/tutorial`) — dado tipado, sem CMS |
| [src/lib/openai-compat](src/lib/openai-compat) | Tradução chat/completions ↔ run e resolução de `model` para `POST /api/v1/chat/completions` |
| [prisma/schema.prisma](prisma/schema.prisma) | Modelo de dados (SQLite) |
| [src/app/api](src/app/api) | Rotas REST |

Endpoint novo: adicione em `api-registry.ts` e ele aparece na documentação e na
collection automaticamente.

## Postman

`GET /api/postman/collection` devolve uma collection v2.1.0 pronta para importar,
agrupada por recurso, com corpos de exemplo e as variáveis `baseUrl`, `provider_id`,
`agent_id`, `mcp_server_id`.

**Quebra de contrato (Fase 4):** `POST /api/runs` deixou de devolver a run concluída
com 201 — agora é 202 com `{ id, status: "queued" }`. Scripts que esperavam o
resultado no corpo devem usar `?wait=<segundos>` ou consultar `GET /api/runs/:id`
depois. **Fase 5** só adiciona campos opcionais (`flowVersion` no corpo de
`POST /api/runs`; `flowId`/`flowVersionId`/`sourceKind`/`configDrift` nas respostas de
`Run`) — nenhum contrato existente muda. **Fase 6** só adiciona dois endpoints novos
(`GET /api/flows/:id/graph`, `GET /api/runs/:id/graph`) — nenhum contrato existente
muda. **Fase 7** adiciona `/api/model-policies`, `/api/model-health` e os campos
opcionais `taskType` (corpo de `POST /api/runs`) e `modelPolicyId`/`taskType`/
`candidates` (agente) — também sem quebrar contrato.

## Auth e RBAC

Sessão por cookie `httpOnly` (7 dias, renovada por deslize) ou token de API
(`Authorization: Bearer oaa_...`, mesmo papel do dono). Toda rota nega por omissão —
uma rota sem entrada em `api-registry.ts` fica inacessível, e um teste
(`tests/route-coverage.test.ts`) garante que toda rota implementada está registrada.

| Papel | Pode |
| --- | --- |
| `viewer` | ler tudo, emitir token próprio |
| `editor` | + criar/editar agentes, fluxos e políticas de roteamento, servidores MCP (só nomes de segredo), executar, publicar/rollback |
| `admin` | + gerenciar usuários, preencher segredos, ver auditoria |

## Desenvolvimento orientado por spec

Todas as fases descritas em [specs/](specs/README.md) estão implementadas, com
rastreabilidade completa requisito → tarefa: **Fase 0 (fundação), Fase 1
(criptografia de segredos), Fase 2 (auth e RBAC), Fase 3 (observabilidade e traces),
Fase 4 (execução assíncrona), Fase 5 (versionamento de fluxos), Fase 6 (visualização
gráfica) e Fase 7 (roteamento de modelos)**.

## Limitações conhecidas

- Sem streaming de tokens dentro de uma resposta do modelo — o SSE transmite spans e
  logs completos assim que fecham, não token a token (fora de escopo do design 004).
- Sem exportação OTLP (RQ-OBS-09, marcado P2 no design 003 — não implementado).
- O grafo é visualização, não editor — editar topologia continua nos formulários de
  Agentes (decisão D5 do design 006); o layout também não é recalculado durante
  zoom/pan, só a matriz de visualização muda.
- O roteamento não escolhe modelo por custo ou latência medidos — a ordem é declarada
  por quem configura, e só a disponibilidade a reordena (ver alternativas rejeitadas no
  design 007). A carência também é por processo: com várias réplicas, cada uma observa
  a saúde a partir da mesma tabela, mas sem coordenação de relógio.
- Worker in-process (T3): reiniciar o servidor interrompe execuções em andamento
  (recuperadas como `failed`/`internal_error`, nunca perdidas em silêncio, nunca
  reexecutadas). Múltiplas réplicas exigiriam trocar o barramento de eventos SSE por
  algo além do `EventEmitter` local — registrado no design 004 como evolução natural.
- Um subagente delegado por mais de um orquestrador pertence, na migração automática
  (`npm run migrate:flows`) e na criação de fluxo, ao primeiro fluxo que o alcançou —
  ele pode continuar sendo referenciado por outros grafos sem problema (a resolução do
  snapshot não depende de `Agent.flowId`), mas a listagem/agrupamento na UI mostra só
  um dono.
