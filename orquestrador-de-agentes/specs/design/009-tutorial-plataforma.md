# Design 009 · Tutorial completo da plataforma

**Cobre:** RQ-TUT-01 … RQ-TUT-06
**Depende de:** 001 (permissões por papel), e do `api-registry` como fonte da superfície

## O problema

A plataforma tem uma ordem de uso obrigatória que nenhuma tela declara:

```
provedor → (servidor MCP) → subagentes → orquestrador → publicar fluxo → executar → observar → token/API
```

Quem começa pelo fim encontra becos: a tela de agentes desabilita o botão de criar sem
provedor cadastrado, publicar sem modelo devolve erro de validação, e a diferença entre
"executar o rascunho" e "executar a versão publicada" só aparece depois de a primeira
execução sair diferente do esperado. O README descreve a arquitetura para quem vai
mexer no código — não o percurso de quem vai usar.

Documentação separada do produto envelhece: um passo que cita `POST /api/agents` com um
corpo que mudou é pior que passo nenhum, porque custa a confiança no resto.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Conteúdo como **dado tipado** em `src/lib/tutorial/content.ts`, renderizado por uma página | Sem MDX, sem CMS, sem banco (RQ-TUT-05, T1). Conteúdo em estrutura é verificável por teste; conteúdo em JSX não é. |
| D2 | Todo passo referencia endpoints **por método+caminho do `api-registry`**, não por texto solto | O teste de anti-deriva vira uma comparação de conjuntos; um endpoint renomeado quebra a suíte, não a confiança do usuário (RQ-TUT-02). |
| D3 | Progresso derivado do estado real do banco, nunca marcado à mão | "Concluído" tem que significar "existe um provedor", não "alguém clicou". Some o estado de progresso a persistir e some a chance de mentir (RQ-TUT-03). |
| D4 | Progresso servido por `GET /api/tutorial/progress` | T4 — o que a UI faz é possível por HTTP; e o teste do contrato fica no mesmo lugar dos outros. |
| D5 | Passo sem permissão fica **visível e informativo**, não escondido | Um `viewer` precisa entender o todo para saber o que pedir ao admin; esconder converte falta de permissão em falta de contexto (RQ-TUT-04). |
| D6 | Um passo por área da navegação lateral, na ordem de dependência | O tutorial e o menu passam a se explicar mutuamente; a ordem é a informação que falta hoje. |

## Modelo do conteúdo (D1)

```ts
export type TutorialStep = {
  id: string;                    // estável — usado em âncora e deep link
  title: string;
  goal: string;                  // o que o usuário terá ao fim do passo
  body: string[];                // parágrafos, texto puro
  screen: { href: string; label: string };
  permission: Permission;        // exigida para *executar* o passo (D5)
  endpoints: { method: HttpMethod; path: string }[];   // chaves do api-registry (D2)
  checks: ProgressCheck[];       // como saber que foi feito (D3)
  pitfalls?: string[];           // o beco sem saída que este passo evita
};
```

`ProgressCheck` é um identificador fechado (`"has_provider"`, `"has_subagent"`,
`"has_orchestrator"`, `"has_published_flow"`, `"has_successful_run"`, `"has_token"`, …),
resolvido no servidor por uma contagem Prisma. É união de literais, não função: conteúdo
é dado, e dado não executa consulta.

### Os passos (D6)

| # | Passo | Tela | Concluído quando |
| --- | --- | --- | --- |
| 1 | Cadastrar um provedor de LLM | `/providers` | existe `Provider` ativo |
| 2 | Conectar um servidor MCP *(opcional)* | `/mcp` | existe `McpServer` com `lastStatus = ok` |
| 3 | Criar subagentes especialistas | `/agents` | existe agente `subagent` |
| 4 | Criar o agente intermediário *(opcional)* | `/agents` | existe agente `agent` com filhos |
| 5 | Criar o orquestrador e ligar os filhos | `/agents` | existe `orchestrator` com ≥1 `AgentLink` |
| 6 | Publicar a primeira versão do fluxo | `/flows` | existe `FlowVersion` |
| 7 | Roteamento: cadeia de modelos e failover | `/model-policies` | existe `ModelCandidate` ou `ModelPolicy` |
| 8 | Executar e ler o trace | `/runs` | existe `Run` `succeeded` |
| 9 | Emitir um token e chamar de fora | `/conta/tokens` | existe `ApiToken` não revogado |

O passo 4 depende do [design 008](008-agente-intermediario.md) e o 9 aponta para o
tutorial de integração do [design 010](010-api-openai-compativel.md) — o tutorial geral
apresenta, o específico aprofunda; nenhum dos dois repete o outro.

## Página e API

```
/tutorial                     página (server component), permissão authenticated
GET /api/tutorial/progress    { checks: Record<ProgressCheck, boolean> }, permissão authenticated
```

A página é server component: lê os passos do módulo, resolve os `checks` na mesma
requisição e renderiza. O endpoint existe para paridade de contrato (D4) e para o atalho
contextual do RQ-TUT-06, que é client-side.

Entra na navegação lateral com permissão `authenticated`, e o painel inicial
([src/app/page.tsx](../../src/app/page.tsx)) troca o texto de boas-vindas atual por um
resumo de progresso apontando para o primeiro passo pendente.

## Anti-deriva (RQ-TUT-02)

`tests/tutorial.test.ts`, tudo estático e barato:

1. Todo `screen.href` corresponde a uma página existente em `src/app/**/page.tsx`.
2. Todo `endpoints[]` existe em `API_ENDPOINTS` com o mesmo método e caminho.
3. Toda `permission` é uma `Permission` válida.
4. Todo `ProgressCheck` citado no conteúdo tem resolvedor implementado, e vice-versa —
   os dois lados do par têm que fechar.
5. Ids de passo são únicos e estáveis (lista de ids congelada no teste; renomear exige
   editar o teste, que é o ponto: o id é âncora pública).

## Alternativas rejeitadas

- **MDX** — dependência nova, pipeline de build e conteúdo que o teste de anti-deriva não
  consegue inspecionar sem parser (T1, RQ-TUT-05).
- **Tour interativo sobreposto à UI** (highlight passo a passo) — acopla o tutorial ao
  DOM de cada tela: qualquer refatoração de layout quebra o tour silenciosamente, e não
  há como testá-lo estaticamente. Reavaliar depois que as telas estabilizarem.
- **Progresso persistido por usuário** — introduz estado que pode divergir da realidade
  ("concluído" com o provedor já excluído). Derivar é mais barato e não mente (D3).
- **Tutorial só no README** — não alcança quem usa a instância publicada e não tem como
  refletir o estado da instalação.
- **Esconder passos sem permissão** — RQ-TUT-04; ver D5.

## Plano de verificação

1. Banco vazio: `/tutorial` renderiza os nove passos, todos pendentes, primeiro passo em
   destaque (RQ-TUT-01, RQ-TUT-05).
2. Cadastrar um provedor e recarregar: passo 1 concluído, passo 3 vira o pendente atual;
   excluir o provedor reverte (RQ-TUT-03).
3. `viewer` autenticado: passo 1 informativo, com o papel exigido explícito e sem link de
   ação; `admin` vê o link (RQ-TUT-04).
4. Renomear um endpoint no `api-registry` sem atualizar o conteúdo: `npm test` falha
   (RQ-TUT-02).
5. Percorrer os nove passos numa instalação limpa até uma run `succeeded` e um token
   emitido, sem consultar o README (RQ-TUT-01).
