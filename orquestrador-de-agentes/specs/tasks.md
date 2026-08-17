# Plano de tarefas

Ordem derivada das dependências entre designs. Cada tarefa tem **critério de pronto**
verificável; nenhuma é dada como concluída sem o critério executado.

Estimativas em "pontos" relativos (1 ≈ meio dia de trabalho focado), não em datas.

---

## Fase 0 · Fundação — 5 pontos

Nada de funcionalidade nova; prepara o terreno para as cinco fases seguintes.

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T0.1 | Trocar `prisma db push` por migrações versionadas; criar a baseline do schema atual | `package.json`, `prisma/migrations/` | RQ-NFR-01 | `prisma migrate deploy` reproduz o banco atual do zero e sobre um banco existente sem perda |
| T0.2 | `PRAGMA journal_mode=WAL` e `busy_timeout` na inicialização do Prisma | `src/lib/db.ts` | RQ-NFR-03 | 4 escritas concorrentes sem `SQLITE_BUSY` |
| T0.3 | `instrumentation.ts` com hook de boot (validações, worker, rotinas) | `src/instrumentation.ts` | — | Boot executa as validações e loga a versão |
| T0.4 | Harness de teste com `node --test` + fixtures de banco temporário | `tests/`, `package.json` | RQ-NFR-04 | `npm test` roda verde em banco descartável |
| T0.5 | Modelos `Setting` e `ModelPrice` + leitura com cache | `prisma/schema.prisma`, `src/lib/settings.ts` | RQ-OBS-06, RQ-ASY-06 | Alterar um setting reflete sem reiniciar |

---

## Fase 1 · Criptografia de segredos — 8 pontos

Independente e pequena; fecha o buraco de segurança antes de o banco ganhar usuários.

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T1.1 | `encrypt`/`decrypt`/`isEnvelope`/`mask` com AES-256-GCM e AAD | `src/lib/crypto/secrets.ts` | RQ-SEC-01, RQ-SEC-04 | Testes de ida e volta, adulteração e AAD trocado |
| T1.2 | Validação de `ENCRYPTION_KEY` no boot + `npm run generate-key` | `src/instrumentation.ts`, `scripts/generate-key.ts` | RQ-SEC-02, RQ-SEC-03 | Sem chave e com dados cifrados, o boot aborta com mensagem acionável |
| T1.3 | Migração de schema: `apiKeyEnc`, `envEnc`/`envKeys`, `headersEnc`/`headerKeys`, `configHash` | `prisma/migrations/` | RQ-NFR-01 | Migração aplica em banco existente |
| T1.4 | `npm run migrate:secrets` idempotente | `scripts/migrate-secrets.ts` | RQ-SEC-05 | Duas execuções seguidas deixam zero valores em claro |
| T1.5 | Decifragem restrita aos adaptadores de provedor e MCP | `src/lib/providers.ts`, `src/lib/mcp.ts` | RQ-SEC-07 | Teste de arquitetura: `decrypt(` só nos arquivos permitidos |
| T1.6 | Máscara na serialização e semântica "vazio = manter" | `src/lib/serialize.ts`, rotas de provider/mcp | RQ-SEC-08, RQ-SEC-10 | `PATCH` só com `name` preserva a chave |
| T1.7 | Teste de sentinela varrendo endpoints, spans, logs e collection | `tests/leak.test.ts` | RQ-SEC-08 | Nenhuma ocorrência de segredo cadastrado |
| T1.8 | `npm run rotate-keys` com convivência de versões | `scripts/rotate-keys.ts` | RQ-SEC-06 | Tudo migra para `v2`; execuções funcionam antes e depois |

---

## Fase 2 · Auth e RBAC — 13 pontos

Bloqueia autoria e auditoria das fases seguintes.

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T2.1 | Modelos `User`/`Session`/`ApiToken`/`AuditLog` + migração | `prisma/schema.prisma` | RQ-NFR-01 | Migração aplica sobre banco com dados |
| T2.2 | Hash de senha com `scrypt` e comparação em tempo constante | `src/lib/auth/password.ts` | RQ-AUTH-13 | Formato `scrypt$…`; teste de verificação e de tempo constante |
| T2.3 | Login, logout, sessão por cookie, renovação por deslize | `src/app/api/auth/*`, `src/lib/auth/session.ts` | RQ-AUTH-01, RQ-AUTH-10 | Cookie `httpOnly`; logout invalida na requisição seguinte |
| T2.4 | Middleware + `requireUser(permission)` negando por omissão | `src/middleware.ts`, `src/lib/auth/guard.ts` | RQ-AUTH-02, RQ-AUTH-07 | Toda rota fora da lista de exceções responde 401 sem credencial |
| T2.5 | Mapa rota→permissão cobrindo o `api-registry` | `src/lib/auth/permissions.ts` | RQ-AUTH-07, RQ-AUTH-08 | Teste falha se alguma rota do registro não estiver mapeada |
| T2.6 | Bootstrap: `npm run create-admin` e `/setup` com re-checagem transacional | `scripts/create-admin.ts`, `src/app/setup/` | RQ-AUTH-05 | Com usuário existente, `/setup` responde 404; corrida não cria dois admins |
| T2.7 | CRUD de usuários por `admin`, senha temporária exibida uma vez | `src/app/api/users/*`, `src/app/admin/usuarios/` | RQ-AUTH-03, RQ-AUTH-04 | `editor` recebe 403; nenhuma rota cria usuário sem sessão `admin` |
| T2.8 | Troca obrigatória de senha e bloqueio das demais rotas | `src/lib/auth/guard.ts`, `src/app/api/auth/change-password` | RQ-AUTH-06 | Usuário novo recebe `password_change_required` até trocar |
| T2.9 | Desativação revogando sessões e tokens, preservando autoria | `src/app/api/users/[id]` | RQ-AUTH-11 | Após desativar, login 401 e autoria histórica intacta |
| T2.10 | Bloqueio por tentativas + resposta genérica em tempo constante | `src/app/api/auth/login` | RQ-AUTH-12 | 6ª tentativa responde 429 mesmo com senha correta |
| T2.11 | Tokens de API (emissão, listagem, revogação) e aceite de `Bearer` | `src/app/api/tokens/*`, `src/lib/auth/guard.ts` | RQ-AUTH-09, RQ-AUTH-10 | Token revogado recusado na requisição seguinte |
| T2.12 | Auditoria dos eventos sensíveis + `GET /api/audit` | `src/lib/audit.ts` | RQ-AUTH-14, RQ-SEC-09 | Eventos gravados sem segredo; visível só para `admin` |
| T2.13 | Registrar rotas de auth no `api-registry`; collection com `bearer` e `apiToken` | `src/lib/api-registry.ts` | RQ-NFR-05 | Collection roda ponta a ponta só com `apiToken` |
| T2.14 | UI: `/login`, conta, tokens, administração de usuários; sidebar por permissão | `src/app/login/`, `src/components/` | RQ-AUTH-01, RQ-AUTH-07 | Ações sem permissão ocultas na UI e negadas no backend |
| T2.15 | Fluxo do `editor` declarar `envKeys` e do `admin` preencher valores | `src/app/api/mcp/[id]/secrets` | RQ-SEC-07, RQ-AUTH-07 | Servidor sem segredo fica `awaiting_secret` e não executa |

---

## Fase 3 · Observabilidade — 13 pontos

Pode andar em paralelo com a Fase 2 (não compartilham arquivos críticos).

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T3.1 | Modelos `Span`/`LogEntry` + migração; remoção de `RunStep` | `prisma/schema.prisma` | RQ-OBS-01 | Migração aplica e índices existem |
| T3.2 | Tracer: ids, contexto explícito, `startSpan`/`endSpan`, invariante pai/filho | `src/lib/telemetry/tracer.ts` | RQ-OBS-01 | Teste de árvore e de contenção temporal |
| T3.3 | Buffer com flush por tempo/tamanho, teto e descarte de `debug` | `src/lib/telemetry/buffer.ts` | RQ-NFR-03, RQ-OBS-10 | 4 runs simultâneas sem `SQLITE_BUSY`; falha de flush não derruba a run |
| T3.4 | Taxonomia de erros + `ProviderError`/`McpError` tipados | `src/lib/telemetry/errors.ts`, `providers.ts`, `mcp.ts` | RQ-OBS-03 | Servidor MCP derrubado → `mcp_connection_error` |
| T3.5 | Instrumentar o orquestrador (spans de agente, modelo, tool, delegação) | `src/lib/orchestrator.ts` | RQ-OBS-01, RQ-OBS-02 | Atributos `gen_ai.*` presentes nos spans de modelo |
| T3.6 | Log estruturado correlacionado, com payload mascarado e truncado | `src/lib/telemetry/log.ts` | RQ-OBS-04, RQ-OBS-05 | `?level=error` devolve só erros, em ordem estável |
| T3.7 | Migração de dados `RunStep` → `Span` | `scripts/migrate-runsteps.ts` | RQ-NFR-01 | Traces antigos consultáveis com ordem e profundidade preservadas |
| T3.8 | Custo estimado a partir de `ModelPrice` | `src/lib/telemetry/cost.ts` | RQ-OBS-06 | Sem preço cadastrado, exibe "—"; com preço, valor rotulado como estimativa |
| T3.9 | `GET /api/metrics` com taxa de erro, p50/p95, tokens e custo | `src/app/api/metrics/` | RQ-OBS-07 | Números do endpoint batem com os da UI |
| T3.10 | Rotina de retenção + `VACUUM` semanal | `src/lib/telemetry/retention.ts` | RQ-OBS-08 | Trace além do limite é removido; `Run` mantém agregados |
| T3.11 | UI da execução: árvore de spans + log virtualizado | `src/app/runs/[id]/` | RQ-NFR-02 | 1.000 spans e 5.000 logs sem travar |
| T3.12 | Exportador OTLP opcional (P2) | `src/lib/telemetry/otlp.ts` | RQ-OBS-09 | Com endpoint configurado, spans chegam ao coletor |

---

## Fase 4 · Execução assíncrona — 13 pontos

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T4.1 | Colunas de fila em `Run` + `transition()` com guarda de estado | `prisma/`, `src/lib/queue/state.ts` | RQ-ASY-02 | Transições inválidas rejeitadas por teste |
| T4.2 | Claim atômico e loop do worker com limite de concorrência | `src/lib/queue/worker.ts` | RQ-ASY-06 | Concorrência 2 com 5 runs respeita ordem e limite |
| T4.3 | Heartbeat e recuperação na subida | `src/lib/queue/recovery.ts` | RQ-ASY-07 | Matar o processo e reiniciar finaliza exatamente uma run |
| T4.4 | `POST /api/runs` → 202; `?wait=` para automação | `src/app/api/runs/route.ts` | RQ-ASY-01, RQ-ASY-11 | Responde &lt;300 ms para fluxo longo |
| T4.5 | SSE com cursor `seq` e `Last-Event-ID` | `src/app/api/runs/[id]/events/` | RQ-ASY-03, RQ-ASY-04 | Reconexão após 5 s reproduz a sequência completa |
| T4.6 | `AbortSignal` ponta a ponta + `POST /api/runs/:id/cancel` | `providers.ts`, `mcp.ts`, `orchestrator.ts` | RQ-ASY-05 | Cancelamento durante chamada de modelo encerra em até 2 s |
| T4.7 | Timeout por run liberando a vaga | `src/lib/queue/worker.ts` | RQ-ASY-08 | Tool lenta com limite de 10 s → `timed_out` |
| T4.8 | Retentativa com espera exponencial e jitter, só para transitório | `src/lib/queue/retry.ts` | RQ-ASY-09 | 429, 429, 200 → `succeeded` com `attempt: 3` e três spans |
| T4.9 | `Idempotency-Key` | `src/app/api/runs/route.ts` | RQ-ASY-10 | Dois POST com a mesma chave devolvem o mesmo `id` |
| T4.10 | `GET /api/health` com profundidade de fila e espera mais antiga | `src/app/api/health/` | RQ-ASY-12 | Campos presentes e corretos sob carga |
| T4.11 | UI ao vivo: Playground e página de execução com estado, cancelar e reconexão | `src/app/agents/`, `src/app/runs/` | RQ-ASY-03, RQ-ASY-05 | Trace cresce durante a execução; cancelar funciona pela UI |
| T4.12 | Atualizar `api-registry`, collection e notas de quebra de contrato | `src/lib/api-registry.ts`, `README.md` | RQ-NFR-05 | Collection reflete 202, `?wait=`, cancelamento e SSE |

---

## Fase 5 · Versionamento de fluxos — 13 pontos

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T5.1 | Modelos `Flow`/`FlowVersion` + migração; agrupar agentes existentes | `prisma/`, `scripts/migrate-flows.ts` | RQ-VER-01, RQ-NFR-01 | Cada orquestrador existente vira um fluxo com v1 publicada |
| T5.2 | Resolução do grafo, snapshot canônico e `contentHash` | `src/lib/flows/snapshot.ts` | RQ-VER-02, RQ-VER-09 | Busca por segredo no snapshot não retorna nada |
| T5.3 | Publicação transacional + imutabilidade + 409 idempotente | `src/app/api/flows/[id]/publish/` | RQ-VER-02, RQ-VER-04 | Publicar sem mudanças → 409 `no_changes` |
| T5.4 | `isDirty` por comparação de hash | `src/app/api/flows/[id]/` | RQ-VER-03 | Alterar `temperature` marca o rascunho como sujo |
| T5.5 | Orquestrador executa a partir do plano do snapshot | `src/lib/orchestrator.ts` | RQ-VER-05, RQ-VER-06 | Trace de run antiga mostra o prompt daquela versão |
| T5.6 | Detecção de drift por `configHash` com aviso, sem bloquear | `src/lib/flows/drift.ts` | RQ-VER-10 | Alterar args de MCP → `configDrift: true` e log `warn` |
| T5.7 | Diff estrutural entre versões (e contra o rascunho) | `src/lib/flows/diff.ts` | RQ-VER-07 | Mudar só a `temperature` gera exatamente uma entrada |
| T5.8 | Rollback publicando versão nova | `src/app/api/flows/[id]/versions/[n]/rollback/` | RQ-VER-08 | v3→v1 cria v4; v2 e v3 seguem consultáveis |
| T5.9 | Exclusão lógica de agente e servidor referenciados | rotas de agents/mcp, `serialize.ts` | RQ-VER-11 | Versão com subagente excluído continua executável |
| T5.10 | Etiquetas únicas por fluxo | `src/app/api/flows/[id]/versions/[n]/tag/` | RQ-VER-12 | Reutilizar etiqueta a move e registra o evento |
| T5.11 | UI: seletor de fluxo, aviso de não publicado, linha do tempo, comparação | `src/app/flows/` | RQ-VER-03, RQ-VER-07 | Publicar, comparar e voltar versão pela interface |
| T5.12 | Registrar rotas de fluxo no `api-registry` | `src/lib/api-registry.ts` | RQ-NFR-05 | Collection cobre publicação, diff e rollback |

---

## Fase 6 · Visualização gráfica — 13 pontos

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T6.1 | Layout em camadas puro e determinístico com redução de cruzamentos | `src/lib/graph/layout.ts` | RQ-VIS-01, RQ-VIS-02 | Mesma topologia → coordenadas idênticas; sem sobreposição |
| T6.2 | Endpoints de grafo do fluxo e da execução (com agregados) | `src/app/api/flows/[id]/graph/`, `src/app/api/runs/[id]/graph/` | RQ-VIS-01, RQ-VIS-08 | Run antiga devolve a topologia da versão que rodou |
| T6.3 | Renderizador SVG com zoom, pan e enquadrar | `src/components/graph/` | RQ-VIS-09 | 50 nós com interação fluida |
| T6.4 | Reducer de estado ao vivo consumindo o SSE (e o histórico) | `src/components/graph/useRunGraph.ts` | RQ-VIS-03 | Delegação reflete no subagente em menos de 1 s |
| T6.5 | Destaque de erro no nó + painel de detalhe da falha | `src/components/graph/NodeDetail.tsx` | RQ-VIS-04 | Falha de tool mostra categoria, args e tentativa |
| T6.6 | Painel de log virtualizado com filtros, seguir execução e aba Erros | `src/components/logs/` | RQ-VIS-05, RQ-NFR-02 | Filtro por nível e por nó; 5.000 linhas fluidas |
| T6.7 | Navegação cruzada log ↔ grafo | `src/components/graph/selection.ts` | RQ-VIS-06 | Clique nos dois sentidos seleciona e enquadra |
| T6.8 | Métricas em nós e contadores em arestas | `src/components/graph/` | RQ-VIS-07 | Duas delegações exibem `×2` na aresta |
| T6.9 | Árvore acessível equivalente e navegação por teclado | `src/components/graph/GraphTree.tsx` | RQ-VIS-10 | Percurso completo só com teclado; leitor de tela anuncia estado |
| T6.10 | Tema claro/escuro, contraste AA e erro não dependente de cor | `src/components/graph/`, `globals.css` | RQ-VIS-11 | Erro identificável em escala de cinza |
| T6.11 | Grafo no Playground e na página de execução | `src/app/agents/`, `src/app/runs/[id]/` | RQ-VIS-03, RQ-VIS-05 | Mesma tela mostra grafo e log sincronizados |
| T6.12 | Exportar SVG/PNG e log em JSON/texto (P2) | `src/lib/graph/export.ts` | RQ-VIS-12 | SVG abre fora da aplicação com rótulos e estados |

---

## Fase 7 · Roteamento de modelos — 10 pontos

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T7.1 | Modelos `ModelPolicy`, `ModelCandidate`, `ModelHealth` + campos em `Agent`/`Run` + migração | `prisma/schema.prisma` | RQ-ROT-01, RQ-ROT-02 | Migração aplica; agente aponta para política e/ou tem candidatos próprios |
| T7.2 | Resolução da cadeia por tipo de tarefa e prioridade | `src/lib/routing/resolve.ts` | RQ-ROT-01, RQ-ROT-03, RQ-ROT-04, RQ-ROT-05, RQ-ROT-12 | Sobrescrita do agente prevalece; empate de rank resolvido pelo id; agente sem config usa o modelo único |
| T7.3 | Saúde por (provedor, modelo) e ordenação por disponibilidade | `src/lib/routing/health.ts` | RQ-ROT-08 | Falhas consecutivas abrem carência e jogam o candidato para o fim; sucesso fecha |
| T7.4 | Failover na chamada ao modelo, com span por tentativa | `src/lib/orchestrator.ts`, `src/lib/routing/failover.ts` | RQ-ROT-06, RQ-ROT-07, RQ-ROT-09, RQ-ROT-11 | Primeiro candidato fora do ar conclui pelo segundo; cancelamento não faz failover |
| T7.5 | Cadeia resolvida entra no snapshot e no diff | `src/lib/flows/snapshot.ts`, `src/lib/flows/diff.ts` | RQ-ROT-10 | Editar a política não altera versão publicada; diff mostra a mudança |
| T7.6 | CRUD de políticas + saúde observada | `src/app/api/model-policies/`, `src/app/api/model-health/` | RQ-ROT-02 | Duas políticas reutilizadas por agentes distintos |
| T7.7 | `taskType` em `POST /api/runs` e campos de roteamento no agente | `src/app/api/runs/`, `src/app/api/agents/` | RQ-ROT-04 | Run com `taskType` usa a cadeia correspondente |
| T7.8 | Permissões `policy.read`/`policy.write` | `src/lib/auth/permissions.ts`, `src/lib/api-registry.ts` | RQ-ROT-02 | `viewer` lê; `editor`/`admin` escrevem |
| T7.9 | UI: página de políticas, roteamento no editor de agente, failover na execução | `src/app/model-policies/`, `src/app/agents/`, `src/app/runs/[id]/` | RQ-ROT-01, RQ-ROT-11 | Cadeia editável por arrastar/ordenar; execução marca failover |
| T7.10 | api-registry, README, testes + smoke | `src/lib/api-registry.ts`, `README.md`, `tests/routing.test.ts` | RQ-NFR-05 | Suíte verde; collection cobre as rotas novas |

---

## Fase 8 · Papel intermediário "Agente" — 6 pontos

Nenhuma migração: `Agent.role` já é `String` (design 008, D1). A fase é sobre desfazer o
acoplamento de `role === "orchestrator"`, não sobre schema.

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T8.1 | Vocabulário de papéis e predicados `canDelegate`/`canBeRoot`/`canBeChild` | `src/lib/agents/roles.ts` | RQ-HIER-01 | Módulo exporta os três papéis; teste de arquitetura proíbe comparar `role` com literal fora dele |
| T8.2 | Travessia do grafo desce por `canDelegate` | `src/lib/flows/snapshot.ts` | RQ-HIER-02, RQ-HIER-06 | Fluxo de três níveis entra inteiro no snapshot; ciclo A↔B publica com dois agentes e duas arestas |
| T8.3 | Catálogo de tools de delegação por `canDelegate`, com descrição pelo papel do filho | `src/lib/orchestrator.ts` | RQ-HIER-02, RQ-HIER-04, RQ-HIER-05 | `subagent` com filho vinculado não recebe `delegate_to_*`; cadeia de 4 níveis conclui sem erro |
| T8.4 | Validação: raiz por `canBeRoot`, filho por `canBeChild`, 422 `invalid_child_role` | `src/app/api/agents/*`, `src/app/api/flows/route.ts`, `src/lib/flows/snapshot.ts` | RQ-HIER-03 | `childIds` com orquestrador → 422; `validateSnapshot` recusa aresta para orquestrador |
| T8.5 | `role: "agent"` nos schemas Zod de criação/atualização, sem criar `Flow` | `src/app/api/agents/route.ts`, `[id]/route.ts` | RQ-HIER-01, RQ-HIER-08 | `POST` com `role: "agent"` → 201 e nenhum `Flow` criado |
| T8.6 | Tipo de nó `agent` no grafo, com forma própria além da cor | `src/lib/graph/*`, `src/components/graph/*` | RQ-HIER-07 | `GET /api/flows/:id/graph` devolve `type: "agent"`; três papéis distinguíveis em escala de cinza |
| T8.7 | UI de agentes em três colunas, seletor de papel e lista de filhos filtrada | `src/app/agents/page.tsx`, `src/lib/client.ts` | RQ-HIER-01, RQ-HIER-03 | Criar e ligar um agente intermediário inteiramente pela interface |
| T8.8 | Testes de hierarquia + atualização de `data-model.md`, README e `api-registry` | `tests/hierarchy.test.ts`, `specs/design/data-model.md` | RQ-HIER-08, RQ-NFR-05 | Suíte verde; `prisma migrate status` sem migração pendente |

---

## Fase 9 · Tutorial da plataforma — 6 pontos

Depende da Fase 8 (o passo 4 descreve o papel intermediário).

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T9.1 | Modelo de conteúdo tipado (`TutorialStep`, `ProgressCheck`) | `src/lib/tutorial/types.ts` | RQ-TUT-05 | Tipos compilam e não permitem passo sem tela, permissão e endpoints |
| T9.2 | Os nove passos, com objetivo, corpo, armadilhas e endpoints citados | `src/lib/tutorial/content.ts` | RQ-TUT-01, RQ-TUT-02 | Cobre provedores → MCP → agentes → fluxo → roteamento → execução → token, em ordem |
| T9.3 | Resolvedores de progresso por contagem no banco | `src/lib/tutorial/progress.ts` | RQ-TUT-03 | Banco vazio → tudo pendente; cadastrar provedor conclui o passo 1 |
| T9.4 | `GET /api/tutorial/progress` + registro no `api-registry` | `src/app/api/tutorial/progress/route.ts` | RQ-TUT-03, RQ-NFR-05 | Rota autenticada devolve os `checks`; collection cobre |
| T9.5 | Página `/tutorial` com estado por passo e destaque do próximo pendente | `src/app/tutorial/page.tsx` | RQ-TUT-01, RQ-TUT-03 | Renderiza em banco vazio; passo pendente em destaque |
| T9.6 | Passo sem permissão informativo, com o papel exigido explícito | `src/app/tutorial/page.tsx` | RQ-TUT-04 | `viewer` vê o passo sem link de ação e com o papel necessário |
| T9.7 | Entrada na navegação e resumo de progresso no painel inicial | `src/components/nav.tsx`, `src/app/page.tsx` | RQ-TUT-01 | Painel aponta para o primeiro passo pendente |
| T9.8 | Teste de anti-deriva (links, endpoints, permissões, checks, ids) | `tests/tutorial.test.ts` | RQ-TUT-02 | Renomear endpoint no registro sem atualizar o conteúdo quebra a suíte |
| T9.9 | Atalho contextual das telas para o passo correspondente (P2) | `src/components/page-header.tsx` | RQ-TUT-06 | Atalho leva ao passo certo, visível sem rolagem |

---

## Fase 10 · API OpenAI-compatível — 10 pontos

Depende da Fase 8 (o catálogo lista orquestradores) e da Fase 9 (o tutorial de tokens
referencia o passo 9).

| ID | Tarefa | Arquivos | Requisitos | Pronto quando |
| --- | --- | --- | --- | --- |
| T10.1 | Coluna `Run.source` + migração aditiva | `prisma/schema.prisma`, `prisma/migrations/` | RQ-OAI-11, RQ-NFR-01 | Migração aplica sobre banco com dados; runs antigas ficam `ui` |
| T10.2 | Tradução do dialeto: `messages` → `input`, envelope de erro, mapa de término | `src/lib/openai-compat/translate.ts` | RQ-OAI-06, RQ-OAI-09 | Testes puros de achatamento (3 turnos, partes de texto, mensagem única) |
| T10.3 | Resolução do `model` (`slug`/`id` + `@versão`) e extensões de corpo | `src/lib/openai-compat/resolve-model.ts` | RQ-OAI-02, RQ-OAI-04 | `@2` executa a versão 2 com a 3 publicada; desconhecido → `model_not_found` |
| T10.4 | `POST /api/v1/chat/completions` com espera limitada e 504 sem cancelar | `src/app/api/v1/chat/completions/route.ts` | RQ-OAI-01, RQ-OAI-07, RQ-OAI-08 | SDK oficial recebe resposta; estouro devolve `run_id` e a run segue |
| T10.5 | Streaming `chat.completion.chunk` com keep-alive e `[DONE]` | mesma rota | RQ-OAI-09 | `stream=True` no SDK oficial monta a resposta sem erro de parsing |
| T10.6 | Recusa de `tools`/`functions`/`n>1` e descarte documentado dos parâmetros de amostragem | mesma rota | RQ-OAI-10 | `n: 2` → 400 `unsupported_parameter`; `temperature` não altera o span |
| T10.7 | `GET /api/v1/models` a partir dos orquestradores visíveis | `src/app/api/v1/models/route.ts` | RQ-OAI-03 | Todo `id` listado funciona como `model` |
| T10.8 | Permissões, `api-registry` e collection das duas rotas | `src/lib/api-registry.ts` | RQ-OAI-05, RQ-NFR-05 | Sem header → 401; `viewer` → 403 em completions e 200 em models |
| T10.9 | Tutorial de integração em "Meus tokens": seletores + `curl`/Python/JS/outros sistemas | `src/app/conta/tokens/page.tsx` | RQ-OAI-12 | Trocar orquestrador atualiza os trechos; `curl` copiado responde 200 |
| T10.10 | Etiqueta de origem na listagem de execuções e testes ponta a ponta | `src/app/runs/page.tsx`, `tests/openai-compat.test.ts` | RQ-OAI-11 | Run criada pelo endpoint aparece como `openai`; suíte verde |

---

## Matriz de rastreabilidade

Todo requisito tem pelo menos uma tarefa; toda tarefa cita pelo menos um requisito.

| Requisito | Tarefas | | Requisito | Tarefas |
| --- | --- | --- | --- | --- |
| RQ-AUTH-01 | T2.3, T2.14 | | RQ-ASY-01 | T4.4 |
| RQ-AUTH-02 | T2.4 | | RQ-ASY-02 | T4.1 |
| RQ-AUTH-03 | T2.7 | | RQ-ASY-03 | T4.5, T4.11 |
| RQ-AUTH-04 | T2.7 | | RQ-ASY-04 | T4.5 |
| RQ-AUTH-05 | T2.6 | | RQ-ASY-05 | T4.6, T4.11 |
| RQ-AUTH-06 | T2.8 | | RQ-ASY-06 | T4.2 |
| RQ-AUTH-07 | T2.4, T2.5, T2.14, T2.15 | | RQ-ASY-07 | T4.3 |
| RQ-AUTH-08 | T2.5 | | RQ-ASY-08 | T4.7 |
| RQ-AUTH-09 | T2.11, T2.13 | | RQ-ASY-09 | T4.8 |
| RQ-AUTH-10 | T2.3, T2.11 | | RQ-ASY-10 | T4.9 |
| RQ-AUTH-11 | T2.9 | | RQ-ASY-11 | T4.4 |
| RQ-AUTH-12 | T2.10 | | RQ-ASY-12 | T4.10 |
| RQ-AUTH-13 | T2.2 | | RQ-SEC-01 | T1.1, T1.3 |
| RQ-AUTH-14 | T2.12 | | RQ-SEC-02 | T1.2 |
| RQ-VER-01 | T5.1 | | RQ-SEC-03 | T1.2 |
| RQ-VER-02 | T5.2, T5.3 | | RQ-SEC-04 | T1.1 |
| RQ-VER-03 | T5.4, T5.11 | | RQ-SEC-05 | T1.4 |
| RQ-VER-04 | T5.3 | | RQ-SEC-06 | T1.8 |
| RQ-VER-05 | T5.5 | | RQ-SEC-07 | T1.5, T2.15 |
| RQ-VER-06 | T5.5 | | RQ-SEC-08 | T1.6, T1.7 |
| RQ-VER-07 | T5.7, T5.11 | | RQ-SEC-09 | T2.12 |
| RQ-VER-08 | T5.8 | | RQ-SEC-10 | T1.6 |
| RQ-VER-09 | T5.2 | | RQ-VIS-01 | T6.1, T6.2 |
| RQ-VER-10 | T5.6 | | RQ-VIS-02 | T6.1 |
| RQ-VER-11 | T5.9 | | RQ-VIS-03 | T6.4, T6.11 |
| RQ-VER-12 | T5.10 | | RQ-VIS-04 | T6.5 |
| RQ-OBS-01 | T3.1, T3.2, T3.5 | | RQ-VIS-05 | T6.6, T6.11 |
| RQ-OBS-02 | T3.5 | | RQ-VIS-06 | T6.7 |
| RQ-OBS-03 | T3.4 | | RQ-VIS-07 | T6.8 |
| RQ-OBS-04 | T3.6 | | RQ-VIS-08 | T6.2 |
| RQ-OBS-05 | T3.6 | | RQ-VIS-09 | T6.3 |
| RQ-OBS-06 | T0.5, T3.8 | | RQ-VIS-10 | T6.9 |
| RQ-OBS-07 | T3.9 | | RQ-VIS-11 | T6.10 |
| RQ-OBS-08 | T3.10 | | RQ-VIS-12 | T6.12 |
| RQ-OBS-09 | T3.12 | | RQ-NFR-01 | T0.1, T1.3, T2.1, T3.7, T5.1 |
| RQ-OBS-10 | T3.3 | | RQ-NFR-02 | T3.11, T6.6 |
| RQ-ASY-06 (config) | T0.5 | | RQ-NFR-03 | T0.2, T3.3 |
| RQ-ROT-01 | T7.1, T7.2, T7.9 | | RQ-NFR-04 | T0.4 |
| RQ-ROT-02 | T7.1, T7.6, T7.8 | | RQ-NFR-05 | T2.13, T4.12, T5.12, T7.10 |
| RQ-ROT-03 | T7.2 | | RQ-ROT-08 | T7.3 |
| RQ-ROT-04 | T7.2, T7.7 | | RQ-ROT-09 | T7.4 |
| RQ-ROT-05 | T7.2 | | RQ-ROT-10 | T7.5 |
| RQ-ROT-06 | T7.4 | | RQ-ROT-11 | T7.4, T7.9 |
| RQ-ROT-07 | T7.4 | | RQ-ROT-12 | T7.2 |

Fases 8 a 10:

| Requisito | Tarefas | | Requisito | Tarefas |
| --- | --- | --- | --- | --- |
| RQ-HIER-01 | T8.1, T8.5, T8.7 | | RQ-OAI-01 | T10.4 |
| RQ-HIER-02 | T8.2, T8.3 | | RQ-OAI-02 | T10.3 |
| RQ-HIER-03 | T8.4, T8.7 | | RQ-OAI-03 | T10.7 |
| RQ-HIER-04 | T8.3 | | RQ-OAI-04 | T10.3 |
| RQ-HIER-05 | T8.3 | | RQ-OAI-05 | T10.8 |
| RQ-HIER-06 | T8.2 | | RQ-OAI-06 | T10.2 |
| RQ-HIER-07 | T8.6 | | RQ-OAI-07 | T10.4 |
| RQ-HIER-08 | T8.5, T8.8 | | RQ-OAI-08 | T10.4 |
| RQ-TUT-01 | T9.2, T9.5, T9.7 | | RQ-OAI-09 | T10.5 |
| RQ-TUT-02 | T9.2, T9.8 | | RQ-OAI-10 | T10.6 |
| RQ-TUT-03 | T9.3, T9.4, T9.5 | | RQ-OAI-11 | T10.1, T10.10 |
| RQ-TUT-04 | T9.6 | | RQ-OAI-12 | T10.9 |
| RQ-TUT-05 | T9.1 | | RQ-NFR-01 | T10.1 |
| RQ-TUT-06 | T9.9 | | RQ-NFR-05 | T8.8, T9.4, T10.8 |

---

## Definição de pronto (por fase)

1. Todos os critérios de pronto das tarefas executados.
2. Todos os critérios de aceite dos requisitos da fase verificados — automatizado quando
   possível, roteiro manual registrado quando não.
3. `npm test` e `npm run build` verdes.
4. Migração aplicada com sucesso sobre um banco da versão anterior, com dados.
5. `api-registry` e Postman Collection atualizados (RQ-NFR-05).
6. README e specs atualizados quando o comportamento mudou.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Escrita concorrente no SQLite entre worker, telemetria e UI | `SQLITE_BUSY`, runs falhando por infraestrutura | WAL + `busy_timeout` (T0.2), telemetria em lote (T3.3), concorrência configurável (T4.2) |
| Quebra de contrato do `POST /api/runs` (201 síncrono → 202) | Automação existente para de funcionar | `?wait=` (T4.4), collection e README atualizados (T4.12), aviso no CHANGELOG |
| Migração `RunStep` → `Span` perder histórico | Traces antigos ilegíveis | Script dedicado (T3.7) com verificação de contagem antes/depois e ensaio sobre cópia do banco |
| Rollback (T5.8) recriar agentes com id reaproveitado | Colisão de chave, vínculo errado | Recriação preserva o id original de agente soft-deleted; teste cobrindo o ciclo excluir→rollback |
| Grafo virar editor por pressão de escopo | Fase 6 estourar | D5 do design 006: grafo é visualização; edição continua nos formulários |
| Worker no mesmo processo derrubar execuções ao reiniciar | Runs interrompidas | Recuperação explícita (T4.3) marcando como `failed` com motivo; worker separado registrado como evolução |
| Auth (Fase 2) travar o uso local de quem só quer testar | Atrito na adoção | Bootstrap em um comando (T2.6) e sessão longa; nenhuma configuração externa exigida |
