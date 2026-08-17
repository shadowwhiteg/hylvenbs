import type { TutorialStep } from "./types.ts";

/**
 * Os nove passos do tutorial (design 009), na ordem de dependência do produto:
 * provedor → MCP (opcional) → subagentes → agente intermediário (opcional) →
 * orquestrador → publicar fluxo → roteamento → executar → token/API. Dado
 * tipado, não JSX — o teste de anti-deriva (RQ-TUT-02) confere cada `endpoints[]`
 * contra o `api-registry` e cada `screen.href` contra uma página existente.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "provider",
    title: "Cadastrar um provedor de LLM",
    goal: "Ter ao menos um provedor ativo, com a chave de API salva e os modelos disponíveis listados.",
    body: [
      "Todo agente precisa de um provedor de LLM — é ele que fala com Anthropic, OpenAI ou qualquer serviço compatível com a API da OpenAI.",
      "Cadastre o provedor, informe a chave de API (ela fica cifrada em repouso e nunca volta em claro por HTTP) e use \"Descobrir modelos\" para listar o que está disponível.",
    ],
    screen: { href: "/providers", label: "Provedores" },
    permission: "provider.write",
    endpoints: [
      { method: "POST", path: "/api/providers" },
      { method: "GET", path: "/api/providers/:id/models" },
    ],
    checks: ["has_provider"],
    pitfalls: ["Sem provedor, a tela de Agentes desabilita o botão de criar — é o beco sem saída mais comum."],
  },
  {
    id: "mcp",
    title: "Conectar um servidor MCP",
    goal: "Um servidor MCP testado e saudável, pronto para virar tools de um agente.",
    body: [
      "Servidores MCP (opcional) dão tools externas aos agentes — arquivos, busca, APIs de terceiros.",
      "Registre por stdio (comando + args) ou http (URL). \"Testar\" faz o handshake e lista as tools; sem isso, o agente que usar o servidor não recebe tool nenhuma dele.",
    ],
    screen: { href: "/mcp", label: "Servidores MCP" },
    permission: "mcp.write",
    endpoints: [
      { method: "POST", path: "/api/mcp" },
      { method: "POST", path: "/api/mcp/:id/probe" },
    ],
    checks: ["has_mcp_server"],
  },
  {
    id: "subagents",
    title: "Criar subagentes especialistas",
    goal: "Ao menos um subagente configurado — prompt, provedor/modelo e, se quiser, tools de MCP.",
    body: [
      "Subagentes são as folhas da hierarquia: recebem uma tarefa autocontida e respondem, sem delegar para ninguém.",
      "Escreva um prompt específico (\"especialista em X\") — é a descrição que o orquestrador ou agente pai vai ler para decidir quando delegar.",
    ],
    screen: { href: "/agents", label: "Agentes" },
    permission: "agent.write",
    endpoints: [{ method: "POST", path: "/api/agents" }],
    checks: ["has_subagent"],
  },
  {
    id: "intermediate-agent",
    title: "Criar o agente intermediário",
    goal: "Um agente (papel do meio) coordenando um grupo de subagentes, opcional para hierarquias maiores.",
    body: [
      "Quando o orquestrador teria dezenas de tools delegate_to_* de uma vez, um agente intermediário absorve um domínio inteiro — ele delega para os subagentes do seu grupo e também executa.",
      "Um agente nunca é raiz de fluxo: quem publica e versiona continua sendo só o orquestrador.",
    ],
    screen: { href: "/agents", label: "Agentes" },
    permission: "agent.write",
    endpoints: [
      { method: "POST", path: "/api/agents" },
      { method: "PATCH", path: "/api/agents/:id" },
    ],
    checks: ["has_intermediate_agent"],
    pitfalls: ["Ligar um orquestrador como filho de outro agente devolve 422 — a raiz do fluxo nunca pode ser filha de ninguém."],
  },
  {
    id: "orchestrator",
    title: "Criar o orquestrador e ligar os filhos",
    goal: "Um orquestrador com ao menos um filho vinculado (agente ou subagente) — a raiz de um fluxo versionável.",
    body: [
      "Todo orquestrador ganha um fluxo automaticamente na criação — é o que fica versionado e executável a partir daqui.",
      "Marque quais agentes/subagentes ele pode delegar; cada um vira uma tool delegate_to_<nome> que o modelo escolhe usar durante a execução.",
    ],
    screen: { href: "/agents", label: "Agentes" },
    permission: "agent.write",
    endpoints: [
      { method: "POST", path: "/api/agents" },
      { method: "PATCH", path: "/api/agents/:id" },
    ],
    checks: ["has_orchestrator"],
  },
  {
    id: "publish-flow",
    title: "Publicar a primeira versão do fluxo",
    goal: "Uma versão publicada (v1) — a topologia congelada que as execuções fixadas vão usar.",
    body: [
      "Enquanto não publicar, o fluxo roda sempre a partir do rascunho ao vivo — editar um agente muda a próxima execução na hora.",
      "Publicar congela prompts, parâmetros e a cadeia de roteamento num snapshot imutável; runs podem pedir essa versão específica mesmo que o rascunho mude depois.",
    ],
    screen: { href: "/flows", label: "Fluxos" },
    permission: "flow.publish",
    endpoints: [{ method: "POST", path: "/api/flows/:id/publish" }],
    checks: ["has_published_flow"],
  },
  {
    id: "routing",
    title: "Roteamento: cadeia de modelos e failover",
    goal: "Uma cadeia de modelos com mais de um candidato, para que uma indisponibilidade não pare a run.",
    body: [
      "Cada agente pode ter uma cadeia própria ou herdar de uma política reutilizável, ordenada por tipo de tarefa.",
      "Se o modelo preferido estiver fora do ar, o próximo da cadeia assume sozinho — o trace mostra o failover span a span.",
    ],
    screen: { href: "/model-policies", label: "Roteamento" },
    permission: "policy.write",
    endpoints: [{ method: "POST", path: "/api/model-policies" }],
    checks: ["has_routing_chain"],
  },
  {
    id: "run",
    title: "Executar e ler o trace",
    goal: "Uma execução concluída com sucesso, com o grafo e o log correlacionados.",
    body: [
      "Execute pelo Playground do agente ou por POST /api/runs — os dois caminhos enfileiram a mesma run.",
      "Acompanhe em Execuções: o grafo mostra estado por nó/aresta ao vivo, e clicar num nó filtra o log correspondente.",
    ],
    screen: { href: "/runs", label: "Execuções" },
    permission: "run.create",
    endpoints: [{ method: "POST", path: "/api/runs" }],
    checks: ["has_successful_run"],
  },
  {
    id: "token",
    title: "Emitir um token e chamar de fora",
    goal: "Um token de API ativo, pronto para autenticar chamadas de fora da interface.",
    body: [
      "Tudo que a interface faz também é possível por HTTP — o token vai no header Authorization: Bearer.",
      "Em Meus tokens você também encontra o tutorial de integração via API compatível com OpenAI, incluindo como escolher qual orquestrador a chamada deve executar.",
    ],
    screen: { href: "/conta/tokens", label: "Meus tokens" },
    permission: "token.self",
    endpoints: [{ method: "POST", path: "/api/tokens" }],
    checks: ["has_token"],
  },
];
