# Specs — Orquestrador de Agentes

Desenvolvimento orientado a especificação (SDD). Nenhuma linha de código destas frentes
é escrita antes de a spec correspondente estar revisada e aprovada.

## O ciclo

```
requirements.md  →  design/*.md  →  tasks.md  →  código  →  verificação
   (o quê)          (como)          (em que ordem)          (contra os critérios)
```

1. **Requisitos** — o que o sistema deve fazer, em EARS, sem decidir implementação.
   Cada requisito tem ID estável e critérios de aceite verificáveis.
2. **Design** — como será feito: schema, contratos de API, algoritmos, e as
   **alternativas rejeitadas com o motivo**. Todo design cita os requisitos que cobre.
3. **Tarefas** — plano incremental. Cada tarefa cita requisitos e tem critério de
   pronto. A matriz de rastreabilidade em [tasks.md](tasks.md) garante que nenhum
   requisito ficou órfão.
4. **Verificação** — um requisito só é dado como pronto quando seu critério de aceite
   foi executado de verdade (teste automatizado ou roteiro manual registrado).

Mudou o escopo? Edita-se a spec primeiro, depois o código. Spec e código divergentes
são tratados como defeito.

## Documentos

| Documento | Conteúdo |
| --- | --- |
| [requirements.md](requirements.md) | Todos os requisitos das 6 frentes, em EARS, com IDs `RQ-<área>-<n>` |
| [design/data-model.md](design/data-model.md) | Schema Prisma consolidado (fonte única — os designs não redefinem modelos) |
| [design/001-auth-rbac.md](design/001-auth-rbac.md) | Autenticação, cadastro por administrador, RBAC, tokens de API |
| [design/002-versionamento-fluxos.md](design/002-versionamento-fluxos.md) | Fluxos, versões imutáveis, publicação, diff e rollback |
| [design/003-observabilidade-traces.md](design/003-observabilidade-traces.md) | Spans, logs estruturados, taxonomia de erros, métricas e custo |
| [design/004-execucao-assincrona.md](design/004-execucao-assincrona.md) | Fila, worker, SSE, cancelamento, retentativa |
| [design/005-criptografia-segredos.md](design/005-criptografia-segredos.md) | AES-256-GCM em repouso, rotação de chave, migração |
| [design/006-visualizacao-fluxo.md](design/006-visualizacao-fluxo.md) | Grafo do fluxo, estados ao vivo, painel de log e erros |
| [design/007-roteamento-modelos.md](design/007-roteamento-modelos.md) | Cadeia de modelos por tarefa, prioridade, saúde e failover |
| [design/008-agente-intermediario.md](design/008-agente-intermediario.md) | Papel `agent` entre orquestrador e subagente |
| [design/009-tutorial-plataforma.md](design/009-tutorial-plataforma.md) | Tutorial guiado, progresso derivado do estado real |
| [design/010-api-openai-compativel.md](design/010-api-openai-compativel.md) | `/api/v1/chat/completions`, catálogo de orquestradores, tutorial de integração |
| [tasks.md](tasks.md) | Plano incremental por fase + matriz de rastreabilidade |

## Ponto de partida (estado atual do código)

O que já existe e que estas specs alteram:

- **Sem qualquer noção de usuário.** Toda a API é aberta; não há sessão, papel ou auditoria.
- **`Provider.apiKey`, `McpServer.env` e `McpServer.headers` em texto plano** no SQLite.
- **`POST /api/runs` é síncrono** ([src/app/api/runs/route.ts](../src/app/api/runs/route.ts)):
  segura a requisição até a orquestração terminar, `maxDuration = 300`.
- **Trace plano**: `RunStep` com `index`/`depth`/`durationMs`
  ([prisma/schema.prisma](../prisma/schema.prisma)) — sem hierarquia real de spans,
  sem taxonomia de erro, sem custo, sem log estruturado.
- **Sem versionamento**: editar um agente sobrescreve a configuração e execuções
  antigas passam a apontar para uma configuração que não é mais a que rodou.
- **Sem visualização**: a topologia orquestrador→subagentes→MCP só existe como
  checkboxes na tela de edição.
- **`prisma db push`** no `npm run dev`, sem histórico de migração.

## Decisões transversais

Valem para as seis frentes; um design só as contraria justificando.

- **T1 — Zero dependências novas pesadas.** O projeto já evita SDKs (provedores e MCP
  são implementados sobre `fetch`/`node:child_process`). Criptografia, hash de senha,
  fila e layout do grafo usam a biblioteca padrão do Node. Toda dependência nova
  precisa ser justificada no design.
- **T2 — Migrações versionadas.** `prisma db push` sai; entra `prisma migrate`. A
  partir de agora existe dado que não pode ser perdido (usuários, versões, traces).
- **T3 — Instância única.** O alvo continua sendo um processo Node local/self-hosted.
  Fila e barramento de eventos são in-process; cada design registra explicitamente o
  que quebra em múltiplas réplicas e qual é o caminho de saída.
- **T4 — A API é o produto.** Tudo que a UI faz é possível por HTTP, e todo endpoint
  novo entra em [src/lib/api-registry.ts](../src/lib/api-registry.ts) — a página `/api`
  e a Postman Collection são geradas dali.
- **T5 — Segredo nunca sai.** Nenhuma resposta de API, log, span, snapshot de versão
  ou mensagem de erro contém segredo em claro. Mascarar é o padrão, não a exceção.
- **T6 — Compatibilidade de dados.** Toda mudança de schema vem com script de migração
  de dados existentes; nenhuma frente exige recriar o banco.

## Ordem de implementação

```
Fase 1  Criptografia de segredos      (independente, pequena, fecha um buraco de segurança)
Fase 2  Auth + RBAC                   (bloqueia autoria/auditoria das demais)
Fase 3  Observabilidade               (pode andar em paralelo com a Fase 2)
Fase 4  Execução assíncrona           (depende de 3: o SSE transporta spans e logs)
Fase 5  Versionamento de fluxos       (depende de 2 para autoria; de 4 para fixar a versão da run)
Fase 6  Visualização gráfica          (depende de 3, 4 e 5)
Fase 7  Roteamento de modelos         (depende de 2, 3 e 4)
Fase 8  Papel intermediário "Agente"  (depende de 5 e 6; sem migração)
Fase 9  Tutorial da plataforma        (depende de 8: descreve os três papéis)
Fase 10 API OpenAI-compatível         (depende de 8 e 9)
```

Detalhamento e critérios de pronto em [tasks.md](tasks.md).

## Convenções

- **IDs de requisito**: `RQ-AUTH-01`, `RQ-VER-01`, `RQ-OBS-01`, `RQ-ASY-01`,
  `RQ-SEC-01`, `RQ-VIS-01`, `RQ-ROT-01`, `RQ-HIER-01`, `RQ-TUT-01`, `RQ-OAI-01`.
  Nunca são renumerados; requisito removido vira
  `~~RQ-XXX-nn~~ (removido em <data>: motivo)`.
- **EARS**: `QUANDO <gatilho>, o sistema DEVE <resposta>` (evento),
  `ENQUANTO <estado>, o sistema DEVE <resposta>` (estado),
  `SE <condição indesejada>, ENTÃO o sistema DEVE <resposta>` (exceção),
  `ONDE <configuração>, o sistema DEVE <resposta>` (opcional),
  e a forma ubíqua `O sistema DEVE <resposta>`.
- **Prioridade**: `P0` sem isso a frente não entrega valor · `P1` esperado na entrega ·
  `P2` pode ficar para depois sem quebrar nada.
