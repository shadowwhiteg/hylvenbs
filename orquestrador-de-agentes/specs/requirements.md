# Requisitos

Notação EARS. `DEVE` = obrigatório, `PODE` = opcional. Cada requisito tem critério de
aceite verificável — se não dá para executar o critério, o requisito está mal escrito.

Índice: [Auth/RBAC](#1-autenticação-e-autorização-rq-auth) ·
[Versionamento](#2-versionamento-de-fluxos-rq-ver) ·
[Observabilidade](#3-observabilidade-e-traces-rq-obs) ·
[Execução assíncrona](#4-execução-assíncrona-rq-asy) ·
[Segredos](#5-criptografia-de-segredos-rq-sec) ·
[Visualização](#6-visualização-gráfica-do-fluxo-rq-vis) ·
[Roteamento de modelos](#7-roteamento-de-modelos-rq-rot) ·
[Hierarquia de agentes](#8-hierarquia-de-agentes-rq-hier) ·
[Tutorial](#9-tutorial-da-plataforma-rq-tut) ·
[API OpenAI-compatível](#10-api-openai-compatível-rq-oai) ·
[Não-funcionais](#11-requisitos-não-funcionais-rq-nfr)

---

## 1. Autenticação e autorização (`RQ-AUTH`)

Contexto: hoje a API é totalmente aberta. A plataforma passa a ter usuários criados
**por administradores** — não existe auto-cadastro público.

### RQ-AUTH-01 · Sessão por credencial — P0
QUANDO um usuário submete e-mail e senha válidos, o sistema DEVE criar uma sessão e
devolver um cookie `httpOnly`, `SameSite=Lax` e `Secure` quando servido sobre HTTPS.

**Aceite:** login válido responde 200 e o cookie não é legível por `document.cookie`;
uma requisição subsequente a `/api/agents` responde 200 sem outras credenciais.

### RQ-AUTH-02 · Acesso negado por padrão — P0
O sistema DEVE recusar toda requisição não autenticada a qualquer rota de página ou de
API, exceto `/login`, `/api/auth/login`, `/api/health` e os assets estáticos.

**Aceite:** `curl` sem cookie nem token em cada rota do
[api-registry](../src/lib/api-registry.ts) responde 401; a lista de exceções é exatamente
a acima.

### RQ-AUTH-03 · Cadastro apenas por administrador — P0
QUANDO um usuário com papel `admin` cria um usuário informando e-mail, nome e papel, o
sistema DEVE criar a conta com senha temporária e marcá-la para troca obrigatória.

**Aceite:** `POST /api/users` com sessão `admin` responde 201 e devolve a senha
temporária **uma única vez**; a mesma chamada com sessão `editor` ou `viewer` responde 403.

### RQ-AUTH-04 · Sem auto-cadastro — P0
O sistema NÃO DEVE expor nenhuma rota de registro público, recuperação de senha por
e-mail ou convite auto-servido.

**Aceite:** não existe rota que crie `User` sem sessão `admin` autenticada; a única
exceção é o bootstrap do RQ-AUTH-05.

### RQ-AUTH-05 · Bootstrap do primeiro administrador — P0
ENQUANTO não existir nenhum usuário cadastrado, o sistema DEVE permitir a criação do
primeiro `admin` — e SOMENTE do primeiro — via comando de linha (`npm run create-admin`)
ou via tela de configuração inicial.

**Aceite:** com a tabela `User` vazia a tela `/setup` responde 200 e cria um `admin`;
com um usuário existente a mesma tela responde 404 e o comando falha com mensagem clara.

### RQ-AUTH-06 · Troca obrigatória de senha — P0
ENQUANTO a conta estiver marcada com `mustChangePassword`, o sistema DEVE bloquear todas
as rotas exceto `/api/auth/me`, `/api/auth/change-password` e `/api/auth/logout`.

**Aceite:** usuário recém-criado recebe 403 com `code: "password_change_required"` em
`GET /api/agents`, e 200 depois de trocar a senha.

### RQ-AUTH-07 · Papéis e permissões — P0
O sistema DEVE implementar os papéis `admin`, `editor` e `viewer` conforme a matriz do
[design 001](design/001-auth-rbac.md#matriz-de-permissões), negando por omissão.

**Aceite:** para cada par (papel × endpoint) da matriz existe um teste que confirma
200/403; um endpoint novo sem entrada na matriz é negado a todos exceto `admin`.

### RQ-AUTH-08 · Execução é operação privilegiada — P1
O sistema DEVE tratar disparar execução como escrita: `viewer` PODE ler fluxos, runs e
traces, mas NÃO PODE criar execuções.

**Aceite:** `POST /api/runs` com sessão `viewer` responde 403; `GET /api/runs/:id` responde 200.

### RQ-AUTH-09 · Tokens de API para automação — P0
O sistema DEVE permitir que um usuário autenticado emita tokens de API portadores do seu
próprio papel, aceitos em `Authorization: Bearer <token>`.

**Aceite:** a Postman Collection exportada autentica com a variável `apiToken` e executa
o fluxo completo (criar provedor → criar agente → executar) sem cookie.

### RQ-AUTH-10 · Revogação — P1
QUANDO um token é revogado ou uma sessão é encerrada, o sistema DEVE recusar a próxima
requisição que a utilize, sem depender de expiração.

**Aceite:** `DELETE /api/tokens/:id` e a requisição seguinte com aquele token responde 401.

### RQ-AUTH-11 · Desativação preserva histórico — P1
QUANDO um `admin` desativa um usuário, o sistema DEVE invalidar as sessões e tokens dele
e manter intactos os registros de autoria já gravados.

**Aceite:** após desativar, o login responde 401 e as versões/execuções criadas por ele
continuam exibindo o nome do autor.

### RQ-AUTH-12 · Proteção contra força bruta — P1
SE houver 5 tentativas de login malsucedidas para o mesmo e-mail em 15 minutos, ENTÃO o
sistema DEVE bloquear novas tentativas daquela conta por 15 minutos e registrar o evento
de auditoria.

**Aceite:** a 6ª tentativa responde 429 mesmo com a senha correta; passados 15 minutos o
login válido volta a funcionar.

### RQ-AUTH-13 · Senha nunca recuperável — P0
O sistema DEVE armazenar senhas apenas como hash com sal por usuário e função de
derivação de custo configurável, e NÃO DEVE oferecer nenhum caminho que exiba a senha.

**Aceite:** inspeção da tabela `User` não revela senha; o campo tem o formato
`scrypt$N=…$<sal>$<hash>`; comparação usa `timingSafeEqual`.

### RQ-AUTH-14 · Auditoria — P1
QUANDO ocorrer login, logout, criação/alteração/desativação de usuário, emissão ou
revogação de token, publicação de versão ou alteração de segredo, o sistema DEVE gravar
registro de auditoria com autor, ação, alvo, IP e instante.

**Aceite:** `GET /api/audit` (somente `admin`) lista os eventos; nenhum deles contém
segredo em claro.

---

## 2. Versionamento de fluxos (`RQ-VER`)

Contexto: um "fluxo" é o grafo **orquestrador + subagentes alcançáveis + vínculos MCP +
prompts + parâmetros**. Hoje editar um agente sobrescreve o passado.

### RQ-VER-01 · Fluxo como agregado — P0
O sistema DEVE permitir agrupar um agente orquestrador e seu grafo de subagentes em um
Fluxo nomeado, versionável como unidade.

**Aceite:** `POST /api/flows` com um `rootAgentId` cria o fluxo; `GET /api/flows/:id`
devolve a topologia resolvida a partir da raiz.

### RQ-VER-02 · Publicação cria versão imutável — P0
QUANDO um usuário publica um fluxo, o sistema DEVE gravar um snapshot completo e
imutável do grafo, com número sequencial, hash de conteúdo, mensagem e autor.

**Aceite:** publicar duas vezes gera as versões 1 e 2; qualquer `UPDATE` ou `DELETE`
sobre uma versão publicada é rejeitado pela camada de acesso a dados.

### RQ-VER-03 · Rascunho vs. publicado — P0
O sistema DEVE tratar a configuração ao vivo dos agentes como rascunho, e DEVE indicar
quando o rascunho difere da última versão publicada.

**Aceite:** alterar a `temperature` de um agente do fluxo faz `GET /api/flows/:id`
retornar `isDirty: true` e a UI exibir "alterações não publicadas".

### RQ-VER-04 · Publicação idempotente — P1
SE o rascunho for idêntico à última versão publicada (mesmo hash), ENTÃO o sistema DEVE
recusar a publicação com 409 em vez de criar versão duplicada.

**Aceite:** publicar duas vezes sem alterações responde 409 `code: "no_changes"`.

### RQ-VER-05 · Execução fixa a versão — P0
QUANDO uma execução é criada, o sistema DEVE registrar qual versão do fluxo foi usada e
DEVE executar exatamente a topologia e os parâmetros daquele snapshot.

**Aceite:** publicar v1, executar, alterar o prompt, publicar v2, executar: as duas runs
apontam para versões diferentes e o trace da primeira mostra o prompt da v1.

### RQ-VER-06 · Execução de rascunho é rotulada — P1
QUANDO uma execução é disparada a partir do rascunho, o sistema DEVE marcá-la como
`draft` e gravar o snapshot efêmero usado.

**Aceite:** run de rascunho aparece com etiqueta `rascunho` na listagem e seu snapshot
é consultável, mesmo sem versão publicada.

### RQ-VER-07 · Diff entre versões — P1
O sistema DEVE apresentar as diferenças entre duas versões por entidade e por campo
(agente adicionado/removido, prompt, modelo, parâmetro, vínculo MCP, aresta de delegação).

**Aceite:** `GET /api/flows/:id/diff?from=1&to=2` devolve lista estruturada de mudanças;
alterar só a `temperature` produz exatamente uma entrada.

### RQ-VER-08 · Rollback sem reescrever histórico — P0
QUANDO um usuário faz rollback para a versão N, o sistema DEVE reaplicar o snapshot N ao
rascunho e publicar uma nova versão, preservando todas as versões intermediárias.

**Aceite:** rollback de v3 para v1 cria a v4 com o conteúdo da v1; v2 e v3 continuam
consultáveis e as runs delas continuam íntegras.

### RQ-VER-09 · Snapshot sem segredo — P0
O sistema NÃO DEVE incluir chaves de API, valores de variáveis de ambiente ou headers de
autenticação no snapshot; DEVE guardar apenas referências e os **nomes** das variáveis.

**Aceite:** busca textual por qualquer segredo cadastrado dentro de `FlowVersion.snapshot`
não retorna nada; o snapshot lista `envKeys: ["GITHUB_TOKEN"]` sem o valor.

### RQ-VER-10 · Reprodutibilidade declarada — P1
O sistema DEVE registrar, junto da execução, o hash da configuração externa efetivamente
usada (servidores MCP e provedor) e DEVE sinalizar quando ela divergir do snapshot.

**Aceite:** alterar os argumentos de um servidor MCP e re-executar uma versão antiga
produz run com `configDrift: true` e o detalhe do que mudou.

### RQ-VER-11 · Entidade referenciada não some — P0
SE um agente ou servidor MCP referenciado por alguma versão publicada for excluído,
ENTÃO o sistema DEVE fazer exclusão lógica e manter as versões consultáveis e executáveis.

**Aceite:** excluir um subagente publicado mantém `GET /api/flows/:id/versions/1`
íntegro; a run daquela versão continua executando com a configuração do snapshot.

### RQ-VER-12 · Etiqueta e changelog — P2
O usuário PODE atribuir uma etiqueta (ex.: `producao`) e uma mensagem a cada versão, e o
sistema DEVE garantir unicidade da etiqueta dentro do fluxo.

**Aceite:** reutilizar uma etiqueta a move para a nova versão e registra o evento.

---

## 3. Observabilidade e traces (`RQ-OBS`)

Contexto: `RunStep` é uma lista plana. Vira árvore de spans com semântica de tracing.

### RQ-OBS-01 · Trace hierárquico — P0
O sistema DEVE representar cada execução como um trace com spans encadeados por
`parentSpanId`, cobrindo agente, chamada de modelo, chamada de tool MCP, delegação e
conexão a servidor MCP.

**Aceite:** uma run com delegação e uso de tool produz árvore com pai/filho corretos, e
a soma das durações dos filhos nunca excede a do pai.

### RQ-OBS-02 · Atributos padronizados — P1
O sistema DEVE registrar em cada span de modelo o provedor, o modelo, os parâmetros
efetivos, os tokens de entrada/saída e a razão de parada, com nomes compatíveis com a
convenção `gen_ai.*` do OpenTelemetry.

**Aceite:** o span traz `gen_ai.system`, `gen_ai.request.model`,
`gen_ai.request.temperature`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`.

### RQ-OBS-03 · Taxonomia de erro — P0
QUANDO um passo falhar, o sistema DEVE classificá-lo em uma das categorias
`provider_error`, `provider_rate_limit`, `mcp_connection_error`, `tool_error`,
`validation_error`, `timeout`, `max_steps_exceeded`, `cancelled`, `internal_error`.

**Aceite:** derrubar o servidor MCP no meio da run produz span com
`errorType: "mcp_connection_error"`; a categoria aparece na UI e na API.

### RQ-OBS-04 · Log estruturado correlacionado — P0
O sistema DEVE gravar entradas de log com nível (`debug`|`info`|`warn`|`error`),
mensagem, instante, número de sequência e vínculo com run e span.

**Aceite:** `GET /api/runs/:id/logs?level=error` devolve só os erros, em ordem estável, e
cada entrada aponta para um span existente.

### RQ-OBS-05 · Erro sempre acionável — P0
QUANDO ocorrer erro, o sistema DEVE registrar categoria, mensagem, entidade afetada
(agente/tool/servidor), tentativa e o payload que provocou a falha, com segredos mascarados.

**Aceite:** erro de tool grava os argumentos enviados; erro de provedor grava status HTTP
e corpo truncado; nenhum deles contém a chave de API.

### RQ-OBS-06 · Custo e tokens — P1
O sistema DEVE agregar tokens por run e PODE estimar custo a partir de uma tabela de
preços por modelo configurável.

**Aceite:** a run exibe total de tokens e, havendo preço cadastrado, o custo estimado com
a indicação de que é estimativa.

### RQ-OBS-07 · Métricas agregadas — P1
O sistema DEVE expor, por fluxo/agente e por janela de tempo, contagem de execuções,
taxa de erro, latência p50/p95 e tokens.

**Aceite:** `GET /api/metrics?flowId=…&window=24h` responde com os agregados; a UI mostra
os mesmos números do endpoint.

### RQ-OBS-08 · Retenção — P1
O sistema DEVE aplicar política de retenção configurável para traces e logs, removendo
dados mais antigos que o limite.

**Aceite:** com retenção de 7 dias, um trace de 8 dias some após a rotina de limpeza e a
run permanece com seus totais agregados.

### RQ-OBS-09 · Exportação — P2
O sistema PODE exportar traces em formato OTLP/JSON para um coletor externo, sob
configuração.

**Aceite:** habilitado o `OTEL_EXPORTER_OTLP_ENDPOINT`, os spans chegam ao coletor com a
mesma árvore da UI.

### RQ-OBS-10 · Observar não altera comportamento — P0
SE a gravação de span ou log falhar, ENTÃO o sistema DEVE seguir a execução e registrar a
falha de telemetria separadamente.

**Aceite:** com o banco de telemetria indisponível, a run termina com resultado correto e
o incidente aparece no log do processo.

---

## 4. Execução assíncrona (`RQ-ASY`)

Contexto: hoje `POST /api/runs` segura a conexão HTTP até o fim da orquestração.

### RQ-ASY-01 · Criação não bloqueante — P0
QUANDO uma execução é solicitada, o sistema DEVE responder 202 com o identificador da run
em estado `queued`, sem aguardar a orquestração.

**Aceite:** `POST /api/runs` responde em menos de 300 ms mesmo para um fluxo que leva
minutos.

### RQ-ASY-02 · Ciclo de vida explícito — P0
O sistema DEVE modelar os estados `queued`, `running`, `succeeded`, `failed`,
`cancelled` e `timed_out`, com transições unidirecionais.

**Aceite:** existe teste para cada transição válida e para a rejeição das inválidas
(ex.: `succeeded` → `running`).

### RQ-ASY-03 · Acompanhamento ao vivo — P0
ENQUANTO uma execução estiver em `queued` ou `running`, o sistema DEVE transmitir spans,
logs e mudanças de estado ao cliente conectado, em tempo real.

**Aceite:** `GET /api/runs/:id/events` (SSE) emite eventos durante a execução e encerra
com o evento final de status.

### RQ-ASY-04 · Reconexão sem perda — P1
QUANDO um cliente reconectar informando o último evento recebido, o sistema DEVE reenviar
o que ele perdeu antes de retomar a transmissão.

**Aceite:** desconectar por 5 s no meio da run e reconectar com `Last-Event-ID` resulta na
mesma sequência completa de eventos.

### RQ-ASY-05 · Cancelamento cooperativo — P0
QUANDO o cancelamento for solicitado, o sistema DEVE interromper a execução no próximo
ponto seguro, abortar a chamada HTTP ou MCP em andamento e finalizar como `cancelled`.

**Aceite:** cancelar durante uma chamada de modelo encerra a run em até 2 s com o span
em andamento marcado `cancelled`.

### RQ-ASY-06 · Limite de concorrência — P0
O sistema DEVE processar no máximo N execuções simultâneas (configurável) e manter as
demais em fila por ordem de chegada.

**Aceite:** com N=2 e 5 runs disparadas, no máximo 2 ficam `running` e a ordem de início
respeita a chegada.

### RQ-ASY-07 · Recuperação após queda — P0
QUANDO o processo reiniciar, o sistema DEVE retomar execuções `queued` e marcar como
`failed` (`errorType: "internal_error"`) as `running` órfãs, sem duplicar trabalho.

**Aceite:** matar o processo com uma run em andamento e reiniciar produz exatamente uma
run finalizada, com o motivo registrado.

### RQ-ASY-08 · Tempo limite — P0
SE uma execução exceder o tempo máximo configurado, ENTÃO o sistema DEVE encerrá-la como
`timed_out`, liberando a vaga na fila.

**Aceite:** com limite de 10 s, uma run travada em uma tool lenta termina em `timed_out`.

### RQ-ASY-09 · Retentativa seletiva — P1
QUANDO uma execução falhar por causa transitória (`provider_rate_limit`, rede), o sistema
DEVE reprocessá-la com espera exponencial e jitter, até o limite configurado.

**Aceite:** provedor devolvendo 429 duas vezes e 200 na terceira resulta em run
`succeeded` com `attempt: 3` visível no trace.

### RQ-ASY-10 · Idempotência — P1
QUANDO a criação de execução repetir a mesma chave de idempotência, o sistema DEVE
devolver a run original em vez de criar outra.

**Aceite:** dois `POST /api/runs` com o mesmo `Idempotency-Key` retornam o mesmo `id`.

### RQ-ASY-11 · Modo de espera para automação — P1
O sistema PODE aceitar `?wait=<segundos>` para aguardar o término e responder com o
resultado, sem abandonar o modelo assíncrono por baixo.

**Aceite:** `POST /api/runs?wait=30` devolve a run concluída, e devolve 200 com a run
ainda `running` se o tempo estourar — a execução continua.

### RQ-ASY-12 · Fila observável — P1
O sistema DEVE expor profundidade da fila, execuções em andamento e tempo médio de espera.

**Aceite:** `GET /api/health` traz `queue: { depth, running, oldestWaitMs }`.

---

## 5. Criptografia de segredos (`RQ-SEC`)

Contexto: `Provider.apiKey`, `McpServer.env` e `McpServer.headers` estão em texto plano.

### RQ-SEC-01 · Cifra em repouso — P0
O sistema DEVE armazenar chave de API de provedor, variáveis de ambiente e headers de
servidor MCP cifrados com AES-256-GCM, com IV único por operação de escrita.

**Aceite:** consulta SQL direta às colunas não devolve nada legível; o formato é
`v<versão>:<iv>:<tag>:<ciphertext>` em base64url.

### RQ-SEC-02 · Chave mestra fora do banco — P0
O sistema DEVE derivar a chave de cifra de `ENCRYPTION_KEY` (32 bytes), fornecida por
ambiente, e NUNCA DEVE persistir essa chave no banco.

**Aceite:** o `.env` contém a chave, o banco não; o `.gitignore` cobre o `.env`.

### RQ-SEC-03 · Falha explícita — P0
SE existirem segredos cifrados e `ENCRYPTION_KEY` estiver ausente ou inválida, ENTÃO o
sistema DEVE recusar iniciar com mensagem acionável, em vez de degradar silenciosamente.

**Aceite:** subir sem a variável aborta o boot citando o comando de geração da chave.

### RQ-SEC-04 · Integridade verificada — P0
QUANDO um segredo for decifrado, o sistema DEVE validar a tag de autenticação e tratar
falha como `internal_error`, sem usar o valor.

**Aceite:** adulterar um byte do ciphertext faz a operação falhar com erro claro e sem
chamar o provedor.

### RQ-SEC-05 · Migração dos dados atuais — P0
QUANDO a migração for executada, o sistema DEVE cifrar todos os segredos em texto plano
existentes, de forma idempotente.

**Aceite:** rodar `npm run migrate:secrets` duas vezes deixa o banco consistente e sem
nenhum valor em claro.

### RQ-SEC-06 · Rotação de chave — P1
O sistema DEVE suportar rotação: re-cifrar todos os segredos com uma nova versão de chave
mantendo a anterior disponível durante a transição.

**Aceite:** `npm run rotate-keys` migra tudo para `v2`; antes e depois as execuções
funcionam sem reconfiguração.

### RQ-SEC-07 · Escopo mínimo de decifragem — P0
O sistema DEVE decifrar segredos apenas no momento da chamada ao provedor ou ao servidor
MCP, e NÃO DEVE mantê-los em cache além do necessário nem gravá-los em disco.

**Aceite:** revisão de código confirma que só o adaptador de provedor e o cliente MCP
chamam `decrypt`; nenhum segredo em claro atravessa serialização.

### RQ-SEC-08 · Nunca vaza pela borda — P0
O sistema NÃO DEVE expor segredo em resposta de API, span, log, snapshot de versão,
mensagem de erro ou export do Postman; apenas máscara (`sk-a…z9`).

**Aceite:** teste automatizado varre respostas de todos os endpoints, spans, logs e a
collection procurando os segredos cadastrados, e não encontra nenhum.

### RQ-SEC-09 · Acesso a segredo é auditado — P1
QUANDO um segredo for criado, alterado, removido ou rotacionado, o sistema DEVE registrar
auditoria com autor e alvo — nunca com o valor.

**Aceite:** trocar a chave de um provedor gera evento `secret.updated` com `providerId`.

### RQ-SEC-10 · Escrita sem exigir o valor atual — P1
O sistema DEVE permitir atualizar outros campos de um provedor ou servidor MCP sem
reenviar o segredo, e DEVE interpretar string vazia como "manter o valor atual".

**Aceite:** `PATCH /api/providers/:id` com `{"name":"x"}` preserva a chave cifrada.

---

## 6. Visualização gráfica do fluxo (`RQ-VIS`)

Contexto: a topologia só existe como caixas de seleção; não há como ver o fluxo nem
acompanhar onde ele falhou.

### RQ-VIS-01 · Grafo do fluxo — P0
O sistema DEVE apresentar o fluxo como grafo dirigido: nós para orquestrador,
subagentes e servidores MCP; arestas para delegação e uso de tool.

**Aceite:** um fluxo com 1 orquestrador, 2 subagentes e 1 servidor MCP renderiza 4 nós e
as arestas correspondentes, sem sobreposição de nós.

### RQ-VIS-02 · Layout determinístico — P1
O sistema DEVE posicionar os nós de forma estável e reprodutível: mesma topologia, mesmo
desenho, sem "pular" a cada renderização.

**Aceite:** renderizar o mesmo fluxo duas vezes produz coordenadas idênticas; incluir um
subagente não reposiciona os demais de forma arbitrária.

### RQ-VIS-03 · Estado ao vivo — P0
ENQUANTO uma execução estiver em andamento, o sistema DEVE refletir no grafo o estado de
cada nó (`ocioso`, `executando`, `concluído`, `falhou`, `cancelado`) conforme os eventos
chegam.

**Aceite:** durante a run o nó ativo fica destacado e, ao delegar, o subagente muda para
`executando` em menos de 1 s após o evento.

### RQ-VIS-04 · Erro visível no grafo — P0
QUANDO um nó falhar, o sistema DEVE destacá-lo com a categoria do erro e permitir abrir o
detalhe da falha a partir do próprio nó.

**Aceite:** falha de tool MCP pinta o nó do servidor, exibe `mcp_connection_error` e um
clique abre a mensagem, os argumentos enviados e a tentativa.

### RQ-VIS-05 · Painel de log integrado — P0
O sistema DEVE exibir, junto ao grafo, um log em ordem cronológica com nível, instante,
agente/tool de origem e mensagem, com filtro por nível e por nó.

**Aceite:** filtrar por `error` mostra apenas erros; selecionar um nó restringe o log
àquele nó; o painel acompanha a execução ao vivo com opção de fixar a rolagem.

### RQ-VIS-06 · Navegação cruzada — P1
QUANDO o usuário selecionar uma entrada de log, o sistema DEVE destacar o nó e o span
correspondentes — e vice-versa.

**Aceite:** clicar em um erro do painel seleciona o nó; clicar no nó filtra o log.

### RQ-VIS-07 · Métrica no nó — P1
O sistema DEVE mostrar em cada nó chamadas, duração acumulada e tokens, e em cada aresta
a quantidade de acionamentos.

**Aceite:** delegar duas vezes ao mesmo subagente exibe `×2` na aresta e a soma das
durações no nó.

### RQ-VIS-08 · Grafo de execução histórica — P1
O sistema DEVE reconstruir o grafo de uma execução concluída a partir do trace e do
snapshot da versão, inclusive para versões antigas.

**Aceite:** abrir uma run de 3 versões atrás desenha a topologia daquela época, não a atual.

### RQ-VIS-09 · Interação básica de canvas — P1
O sistema DEVE oferecer zoom, deslocamento e enquadramento automático, com desempenho
fluido até 50 nós.

**Aceite:** com 50 nós, arrastar e dar zoom mantém taxa de quadros interativa; o botão
"ajustar" reenquadra tudo.

### RQ-VIS-10 · Equivalente acessível — P1
O sistema DEVE oferecer, além do grafo, uma representação em árvore/tabela navegável por
teclado e legível por leitor de tela, com a mesma informação de estado e erro.

**Aceite:** é possível percorrer todos os nós e abrir os erros usando apenas o teclado; o
grafo tem `role`/`aria-label` adequados.

### RQ-VIS-11 · Coerência com o tema — P1
O sistema DEVE renderizar o grafo com os tokens de tema existentes, legível nos temas
claro e escuro, e NÃO DEVE depender apenas de cor para indicar erro.

**Aceite:** nos dois temas o contraste atende WCAG AA; o estado de erro traz ícone e
rótulo além da cor.

### RQ-VIS-12 · Exportação da visão — P2
O usuário PODE exportar o grafo como SVG/PNG e o log como texto ou JSON.

**Aceite:** o SVG exportado abre fora da aplicação preservando rótulos e estados.

---

## 7. Roteamento de modelos (`RQ-ROT`)

### RQ-ROT-01 · Lista ordenada de modelos — P0
O sistema DEVE permitir definir, para um agente, uma lista **ordenada** de modelos
candidatos (provedor + modelo) em vez de um único modelo fixo.

**Aceite:** um agente com três candidatos executa sempre pelo primeiro enquanto ele
estiver saudável; `GET /api/agents/:id` devolve a lista na ordem configurada.

### RQ-ROT-02 · Política reutilizável — P0
O sistema DEVE permitir agrupar uma lista de candidatos numa **política** nomeada,
reutilizável por vários agentes, para que a mesma cadeia não precise ser redigitada.

**Aceite:** `POST /api/model-policies` cria a política; dois agentes apontando para ela
resolvem a mesma cadeia.

### RQ-ROT-03 · Sobrescrita por agente — P1
SE um agente definir candidatos próprios, ENTÃO estes DEVEM prevalecer sobre os da
política à qual ele aponta, sem alterar a política.

**Aceite:** um agente com candidatos próprios e uma política associada executa pelos
próprios; os demais agentes da política seguem inalterados.

### RQ-ROT-04 · Seleção por tipo de tarefa — P0
O sistema DEVE permitir associar candidatos a um **tipo de tarefa** e DEVE escolher a
cadeia correspondente ao tipo da execução.

**Aceite:** com candidatos para `reasoning` e para `default`, uma run com
`taskType: "reasoning"` usa a primeira cadeia; sem `taskType`, usa a segunda.

### RQ-ROT-05 · Prioridade explícita — P0
O sistema DEVE ordenar os candidatos de um mesmo tipo de tarefa por uma prioridade
explícita, determinística e editável.

**Aceite:** trocar a prioridade de dois candidatos inverte a ordem de tentativa na
execução seguinte, sem ambiguidade de empate.

### RQ-ROT-06 · Failover por indisponibilidade — P0
QUANDO a chamada ao modelo falhar por indisponibilidade do provedor (erro 5xx, limite de
taxa, modelo inexistente), o sistema DEVE tentar automaticamente o próximo candidato da
ordem, dentro da mesma execução.

**Aceite:** com o primeiro candidato apontando para um provedor fora do ar, a execução
conclui pelo segundo candidato e o trace registra as duas tentativas.

### RQ-ROT-07 · Erro não-transitório não faz failover — P0
SE a falha não indicar indisponibilidade (cancelamento, timeout da run, erro de
validação), ENTÃO o sistema NÃO DEVE tentar outro candidato e DEVE propagar o erro.

**Aceite:** cancelar uma run durante a chamada ao modelo encerra a execução sem tentar o
candidato seguinte.

### RQ-ROT-08 · Ordenação por disponibilidade — P0
O sistema DEVE registrar a saúde observada de cada par (provedor, modelo) e DEVE
despriorizar temporariamente um candidato que acabou de falhar, sem removê-lo da cadeia.

**Aceite:** após falhas consecutivas, o candidato entra em carência e passa a ser tentado
por último; terminada a carência, volta à posição original.

### RQ-ROT-09 · Esgotamento da cadeia — P0
SE todos os candidatos falharem, ENTÃO o sistema DEVE falhar a execução com o erro do
**último** candidato tentado e registrar quantos foram tentados.

**Aceite:** com todos os provedores fora do ar, a run termina `failed` e o log lista as
tentativas por candidato.

### RQ-ROT-10 · Roteamento entra no snapshot — P0
O sistema DEVE congelar a cadeia resolvida no snapshot da versão publicada, para que
editar uma política depois não altere o que uma versão publicada executa.

**Aceite:** publicar, editar a política e reexecutar a versão publicada usa a cadeia
original; o diff entre versões mostra a mudança de roteamento.

### RQ-ROT-11 · Observabilidade do roteamento — P1
O sistema DEVE registrar no trace qual candidato serviu cada chamada, sua posição na
ordem e se houve failover.

**Aceite:** o span do modelo traz o modelo efetivamente usado e a UI marca a execução que
precisou de failover.

### RQ-ROT-12 · Compatibilidade com o modelo único — P0
O sistema DEVE continuar executando agentes sem política nem candidatos, usando o
`provider`/`model` já configurado como candidato único.

**Aceite:** agentes existentes continuam executando sem nenhuma configuração nova.

---

## 8. Hierarquia de agentes (`RQ-HIER`)

Contexto: hoje `Agent.role` só admite `orchestrator` (delega, é raiz de fluxo) e
`subagent` (executa, folha). Não existe nível intermediário — um coordenador de
domínio que recebe delegação do orquestrador **e** delega para especialistas. Sem ele,
todo orquestrador precisa conhecer todos os especialistas, e o catálogo de tools de
delegação cresce até o prompt do orquestrador virar um índice.

### RQ-HIER-01 · Papel intermediário — P0
O sistema DEVE admitir um terceiro papel de agente, `agent`, que PODE receber delegação
de um orquestrador ou de outro `agent` **e** PODE delegar para seus próprios filhos.

**Aceite:** `POST /api/agents` com `role: "agent"` responde 201; `GET /api/agents/:id`
devolve `role: "agent"` e aceita `childIds`.

### RQ-HIER-02 · Delegação em três níveis — P0
QUANDO um orquestrador delega para um agente de papel `agent` que possui filhos, o
sistema DEVE expor a esse agente as tools de delegação dos seus filhos, na mesma
execução.

**Aceite:** fluxo `Orquestrador → Agente → Subagente` executa e o trace mostra três
spans `agent:` aninhados, com `orq.delegate.depth` 0, 1 e 2.

### RQ-HIER-03 · Orquestrador é sempre raiz — P0
O sistema NÃO DEVE permitir que um agente de papel `orchestrator` seja filho de outro
agente.

**Aceite:** `PATCH /api/agents/:id` com `childIds` contendo um orquestrador responde 422
com `code: "invalid_child_role"`; a UI não oferece orquestradores na lista de filhos.

### RQ-HIER-04 · Folha não delega — P1
ENQUANTO um agente tiver papel `subagent`, o sistema NÃO DEVE expor tools de delegação a
ele, mesmo que existam vínculos `AgentLink` herdados de uma configuração anterior.

**Aceite:** um `subagent` com filhos vinculados executa sem nenhuma tool
`delegate_to_*` no catálogo; o snapshot registra o vínculo, a execução o ignora.

### RQ-HIER-05 · Profundidade limitada — P0
O sistema DEVE limitar a profundidade de delegação a `MAX_DEPTH` níveis e DEVE
interromper a expansão do catálogo de tools ao atingir o limite, sem falhar a execução.

**Aceite:** cadeia `orquestrador → agent → agent → agent` não expõe delegação no último
nível; a run conclui com resposta, não com erro.

### RQ-HIER-06 · Ciclo não trava a resolução — P0
SE o grafo contiver um ciclo entre agentes de papel `agent`, ENTÃO o sistema DEVE
resolver o snapshot uma única vez por agente e DEVE concluir a publicação.

**Aceite:** A→B e B→A publica; `snapshot.agents` traz A e B uma vez cada e `edges` traz
as duas arestas.

### RQ-HIER-07 · Grafo distingue os três papéis — P1
O sistema DEVE representar o papel `agent` como um tipo de nó próprio no grafo do fluxo
e da execução, distinguível de orquestrador e de subagente sem depender só de cor.

**Aceite:** `GET /api/flows/:id/graph` devolve `type: "agent"` para esses nós; em escala
de cinza os três papéis continuam distinguíveis (mesma regra do RQ-VIS-11).

### RQ-HIER-08 · Compatibilidade dos agentes existentes — P0
O sistema DEVE preservar o comportamento de todo agente já cadastrado como
`orchestrator` ou `subagent`, sem migração de dados nem mudança de schema.

**Aceite:** a suíte anterior a esta fase segue verde; nenhuma migração Prisma nova é
gerada para o papel.

---

## 9. Tutorial da plataforma (`RQ-TUT`)

Contexto: a plataforma tem sete áreas (provedores, MCP, agentes, fluxos, roteamento,
execuções, tokens) cuja ordem de uso não é óbvia — cadastrar um agente antes de um
provedor leva a um beco sem saída. O README explica a arquitetura, não o caminho.

### RQ-TUT-01 · Tutorial completo e navegável — P0
O sistema DEVE oferecer, dentro da aplicação autenticada, um tutorial que cubra o
caminho completo do primeiro provedor até a execução observada, dividido em passos
ordenados.

**Aceite:** `/tutorial` responde 200 para qualquer papel autenticado e cobre, em ordem,
provedores → servidores MCP → agentes → fluxos e publicação → roteamento → execuções e
trace → tokens e API.

### RQ-TUT-02 · Cada passo aponta para a tela e para a API — P0
Cada passo do tutorial DEVE citar a tela onde a ação é feita **e** a chamada de API
equivalente, coerente com o `api-registry`.

**Aceite:** todo passo tem um link interno e ao menos um endpoint citado; um teste
verifica que cada link corresponde a uma rota existente e cada endpoint citado existe em
`API_ENDPOINTS` (RQ-NFR-05).

### RQ-TUT-03 · Progresso a partir do estado real — P1
O sistema DEVE marcar cada passo como concluído a partir do estado real da instalação,
não de marcação manual do usuário.

**Aceite:** com um provedor cadastrado e nenhum agente, o passo de provedores aparece
concluído e o de agentes pendente; excluir o provedor reverte o estado no próximo
carregamento.

### RQ-TUT-04 · Passos respeitam a permissão do papel — P1
ENQUANTO o usuário não tiver a permissão exigida por um passo, o sistema DEVE exibir o
passo como informativo e indicar qual papel é necessário, sem oferecer a ação.

**Aceite:** um `viewer` vê o passo "cadastrar provedor" com aviso de permissão e sem
link de ação; um `admin` vê o link.

### RQ-TUT-05 · Conteúdo versionado com o código — P0
O sistema DEVE manter o conteúdo do tutorial no repositório, como dado tipado, sem
depender de banco, CMS ou dependência nova de runtime.

**Aceite:** o tutorial renderiza num banco recém-criado e vazio; `package.json` não ganha
dependência (RQ-NFR-04).

### RQ-TUT-06 · Tutorial acessível de onde a dúvida aparece — P2
O sistema PODE oferecer, nas telas cobertas pelo tutorial, um atalho para o passo
correspondente.

**Aceite:** o atalho leva ao passo correto e o passo fica visível sem rolagem manual.

---

## 10. API OpenAI-compatível (`RQ-OAI`)

Contexto: integrar o orquestrador a um sistema existente hoje exige aprender a API
própria (`POST /api/runs` → 202 → SSE/polling). A maior parte das ferramentas de mercado
já fala o dialeto `chat/completions`; expor esse dialeto transforma qualquer
orquestrador publicado num "modelo" plugável sem código de integração.

### RQ-OAI-01 · Endpoint de conversa compatível — P0
O sistema DEVE expor `POST /api/v1/chat/completions` aceitando o corpo de
`chat/completions` da OpenAI e devolvendo um objeto `chat.completion` válido.

**Aceite:** o SDK oficial `openai` configurado com `base_url = <host>/api/v1` e
`api_key = <token da plataforma>` recebe resposta sem tratamento especial; a resposta tem
`object: "chat.completion"`, `choices[0].message.content` e `usage`.

### RQ-OAI-02 · Escolha do orquestrador pelo campo `model` — P0
O sistema DEVE interpretar o campo `model` como o identificador do orquestrador a
executar, aceitando o slug do fluxo ou o id do agente raiz.

**Aceite:** `model: "atendimento-fiat"` e `model: "<agentId>"` executam o mesmo
orquestrador; um identificador desconhecido responde 404 no envelope de erro da OpenAI
com `code: "model_not_found"`.

### RQ-OAI-03 · Catálogo de orquestradores como modelos — P0
O sistema DEVE expor `GET /api/v1/models` listando os orquestradores visíveis ao
portador do token, no formato de lista de modelos da OpenAI.

**Aceite:** a lista traz um item por orquestrador não excluído, com `id` igual ao valor
aceito em `model` (RQ-OAI-02); clientes que populam um seletor de modelos exibem os
orquestradores.

### RQ-OAI-04 · Fixar versão publicada e tipo de tarefa — P1
O sistema DEVE permitir escolher a versão do fluxo e o tipo de tarefa pela própria
string do `model` (`<id>@<versão|current>`) e, alternativamente, por campos de extensão
no corpo.

**Aceite:** `model: "atendimento-fiat@2"` executa a versão 2 mesmo com a 3 publicada;
sem sufixo, executa o rascunho vigente, como `POST /api/runs` sem `flowVersion`.

### RQ-OAI-05 · Autenticação por token da plataforma — P0
O sistema DEVE autenticar essas rotas exclusivamente por `Authorization: Bearer <token
de API>`, aplicando a permissão `run.create` para conversas e `agent.read` para o
catálogo.

**Aceite:** sem header responde 401 no envelope de erro da OpenAI; com token de `viewer`
responde 403 em `chat/completions` e 200 em `models`.

### RQ-OAI-06 · Conversa mapeada para a entrada do orquestrador — P0
O sistema DEVE converter o array `messages` numa única entrada textual preservando a
ordem e o papel de cada mensagem, incluindo mensagens `system` e conteúdo em partes.

**Aceite:** uma conversa de três turnos gera uma run cujo `input` contém os três turnos
rotulados; `content` em array de partes de texto é achatado sem perda.

### RQ-OAI-07 · Sem estado entre requisições — P0
O sistema DEVE tratar cada requisição como uma execução independente, sem memória
implícita entre chamadas, e DEVE documentar isso.

**Aceite:** duas requisições seguidas sem histórico no corpo não compartilham contexto; a
documentação do tutorial diz que o histórico é responsabilidade do cliente.

### RQ-OAI-08 · Espera limitada e erro honesto — P0
O sistema DEVE aguardar o término da execução até um teto configurável e, estourado o
teto, DEVE responder erro citando o `id` da run para consulta posterior — sem cancelar a
execução.

**Aceite:** com teto de 5 s e execução mais longa, a resposta é 504 no envelope da OpenAI
contendo o `run_id`; `GET /api/runs/:id` mostra a run seguindo até o fim.

### RQ-OAI-09 · Streaming compatível — P1
ONDE o cliente enviar `stream: true`, o sistema DEVE responder em `text/event-stream` no
formato `chat.completion.chunk`, encerrando com `data: [DONE]`.

**Aceite:** o SDK oficial com `stream=True` itera os chunks e monta a resposta final sem
erro de parsing.

### RQ-OAI-10 · Parâmetros não suportados são explícitos — P1
SE a requisição usar recursos que mudariam a semântica da execução (`tools`,
`functions`, `n` > 1), ENTÃO o sistema DEVE recusar com 400 no envelope da OpenAI, e
DEVE ignorar — documentando — os parâmetros de amostragem já fixados pelo fluxo.

**Aceite:** `n: 2` responde 400 com `code: "unsupported_parameter"`; `temperature`
enviado não altera o valor usado, que vem do snapshot.

### RQ-OAI-11 · Rastreabilidade da chamada externa — P1
O sistema DEVE permitir correlacionar cada resposta com a execução que a produziu,
devolvendo o identificador da run e registrando a origem externa na run.

**Aceite:** `id` da resposta contém o `runId` e `GET /api/runs/:id` devolve a mesma
execução, com a origem marcada.

### RQ-OAI-12 · Tutorial de integração em "Meus tokens" — P0
O sistema DEVE apresentar, na tela de tokens, um tutorial de integração que permita
**escolher o orquestrador** e gerar os trechos de configuração prontos — URL base,
identificador do modelo e exemplos em `curl`, Python e JavaScript.

**Aceite:** selecionar outro orquestrador atualiza todos os trechos; copiar o `curl`
exibido e executá-lo num terminal, trocando apenas o token, devolve uma resposta válida.

---

## 11. Requisitos não-funcionais (`RQ-NFR`)

### RQ-NFR-01 · Migração sem perda — P0
O sistema DEVE migrar um banco existente para o novo schema preservando provedores,
servidores MCP, agentes, execuções e traces já gravados.

**Aceite:** partindo de um banco da versão atual, `prisma migrate deploy` +
`npm run migrate:data` mantém todos os registros consultáveis.

### RQ-NFR-02 · Desempenho da UI — P1
O sistema DEVE renderizar a página de execução com 1.000 spans e 5.000 linhas de log sem
travar a interface.

**Aceite:** o log é virtualizado e a interação permanece responsiva com esse volume.

### RQ-NFR-03 · Limites de escrita concorrente — P1
O sistema DEVE lidar com a serialização de escrita do SQLite sob execuções paralelas,
usando WAL e escrita de telemetria em lote.

**Aceite:** 4 runs simultâneas gravando spans não produzem `SQLITE_BUSY`.

### RQ-NFR-04 · Sem dependência pesada nova — P1
O sistema DEVE implementar hash de senha, cifra, fila e layout do grafo com a biblioteca
padrão do Node; qualquer exceção precisa estar justificada no design.

**Aceite:** o `package.json` final não ganha dependência de runtime não justificada.

### RQ-NFR-05 · Superfície documentada — P0
O sistema DEVE registrar todo endpoint novo em `api-registry.ts`, refletindo-o na página
`/api` e na Postman Collection, com autenticação por token configurada.

**Aceite:** a collection exportada cobre 100% das rotas do registro e roda ponta a ponta
autenticada.
