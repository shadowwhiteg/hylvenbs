/**
 * Fonte única de verdade da API de orquestração.
 * A UI documenta a partir daqui e /api/postman/collection gera a Postman
 * Collection v2.1 a partir da mesma lista — endpoint novo entra nos dois lugares
 * ao ser adicionado aqui.
 */
export type Permission =
  | "public"
  | "authenticated"
  | "user.manage"
  | "audit.read"
  | "settings.manage"
  | "provider.write"
  | "secret.write"
  | "provider.read"
  | "mcp.write"
  | "mcp.probe"
  | "mcp.read"
  | "agent.write"
  | "agent.read"
  | "flow.read"
  | "flow.write"
  | "flow.publish"
  | "flow.rollback"
  | "policy.read"
  | "policy.write"
  | "run.create"
  | "run.cancel"
  | "run.read"
  | "token.self";

export type ApiEndpoint = {
  group: string;
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  /** Caminho com :params, ex. /api/agents/:id */
  path: string;
  description: string;
  /** Permissão exigida — negado por omissão se ausente (RQ-AUTH-07). */
  permission: Permission;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
};

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    group: "Provedores",
    name: "Listar provedores",
    method: "GET",
    path: "/api/providers",
    description: "Retorna todos os provedores de LLM cadastrados (apiKey mascarada).",
    permission: "provider.read",
  },
  {
    group: "Provedores",
    name: "Criar provedor",
    method: "POST",
    path: "/api/providers",
    description: "Cadastra um provedor. kind: anthropic | openai | openai-compatible.",
    permission: "secret.write",
    body: {
      name: "Anthropic produção",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "{{anthropic_api_key}}",
      models: ["claude-opus-4-8", "claude-sonnet-5"],
      enabled: true,
    },
  },
  {
    group: "Provedores",
    name: "Atualizar provedor",
    method: "PATCH",
    path: "/api/providers/:id",
    description: "Atualiza campos do provedor. Envie apenas o que muda.",
    permission: "secret.write",
    body: { name: "Anthropic staging", enabled: false },
  },
  {
    group: "Provedores",
    name: "Excluir provedor",
    method: "DELETE",
    path: "/api/providers/:id",
    description: "Remove o provedor. Agentes ligados a ele ficam sem provedor.",
    permission: "secret.write",
  },
  {
    group: "Provedores",
    name: "Descobrir modelos",
    method: "GET",
    path: "/api/providers/:id/models",
    description: "Consulta o endpoint /models do provedor e atualiza o cache local.",
    permission: "provider.read",
  },
  {
    group: "Servidores MCP",
    name: "Listar servidores MCP",
    method: "GET",
    path: "/api/mcp",
    description: "Retorna os servidores MCP com status da última verificação.",
    permission: "mcp.read",
  },
  {
    group: "Servidores MCP",
    name: "Criar servidor MCP",
    method: "POST",
    path: "/api/mcp",
    description: "Cadastra um servidor MCP. transport: stdio (command/args/env) ou http (url/headers).",
    permission: "mcp.write",
    body: {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: {},
      enabled: true,
    },
  },
  {
    group: "Servidores MCP",
    name: "Atualizar servidor MCP",
    method: "PATCH",
    path: "/api/mcp/:id",
    description: "Atualiza a configuração do servidor MCP (não altera segredos).",
    permission: "mcp.write",
    body: { enabled: false },
  },
  {
    group: "Servidores MCP",
    name: "Excluir servidor MCP",
    method: "DELETE",
    path: "/api/mcp/:id",
    description: "Remove o servidor e o desvincula dos agentes.",
    permission: "mcp.write",
  },
  {
    group: "Servidores MCP",
    name: "Definir segredos do servidor MCP",
    method: "PUT",
    path: "/api/mcp/:id/secrets",
    description:
      "Preenche os valores de env/headers para as chaves já declaradas. Só admin — RQ-SEC-07.",
    permission: "secret.write",
    body: { env: { GITHUB_TOKEN: "{{github_token}}" }, headers: {} },
  },
  {
    group: "Servidores MCP",
    name: "Testar conexão e listar tools",
    method: "POST",
    path: "/api/mcp/:id/probe",
    description: "Faz handshake MCP, lista as tools e grava o resultado em cache.",
    permission: "mcp.probe",
  },
  {
    group: "Agentes",
    name: "Listar agentes",
    method: "GET",
    path: "/api/agents",
    description: "Retorna agentes com provedor, subagentes e servidores MCP vinculados.",
    permission: "agent.read",
  },
  {
    group: "Agentes",
    name: "Criar agente",
    method: "POST",
    path: "/api/agents",
    description:
      "Cria um agente. role: orchestrator (raiz do fluxo, delega), agent (delega e executa) ou subagent (só executa). " +
      "childIds com um orchestrator devolve 422 invalid_child_role.",
    permission: "agent.write",
    body: {
      name: "Orquestrador de pesquisa",
      description: "Coordena subagentes de busca e redação.",
      role: "orchestrator",
      systemPrompt: "Você coordena subagentes especialistas para resolver a tarefa do usuário.",
      providerId: "{{provider_id}}",
      model: "claude-opus-4-8",
      temperature: 0.7,
      maxTokens: 2048,
      topP: 1,
      topK: 0,
      stopSequences: [],
      maxSteps: 12,
      childIds: [],
      mcpServerIds: [],
      enabled: true,
    },
  },
  {
    group: "Agentes",
    name: "Detalhar agente",
    method: "GET",
    path: "/api/agents/:id",
    description: "Retorna um agente com todos os vínculos.",
    permission: "agent.read",
  },
  {
    group: "Agentes",
    name: "Atualizar agente",
    method: "PATCH",
    path: "/api/agents/:id",
    description: "Atualiza parâmetros do modelo, prompt e vínculos (childIds, mcpServerIds).",
    permission: "agent.write",
    body: { temperature: 0.2, maxTokens: 4096, mcpServerIds: ["{{mcp_server_id}}"] },
  },
  {
    group: "Agentes",
    name: "Excluir agente",
    method: "DELETE",
    path: "/api/agents/:id",
    description: "Exclusão lógica — versões de fluxo publicadas que o referenciam continuam íntegras (RQ-VER-11).",
    permission: "agent.write",
  },
  {
    group: "Fluxos",
    name: "Listar fluxos",
    method: "GET",
    path: "/api/flows",
    description: "Retorna os fluxos cadastrados com o status da versão publicada.",
    permission: "flow.read",
  },
  {
    group: "Fluxos",
    name: "Criar fluxo",
    method: "POST",
    path: "/api/flows",
    description: "Agrupa um agente orquestrador e seu grafo de subagentes como fluxo versionável (RQ-VER-01).",
    permission: "flow.write",
    body: { rootAgentId: "{{agent_id}}", name: "Pesquisa e redação", description: "" },
  },
  {
    group: "Fluxos",
    name: "Detalhar fluxo",
    method: "GET",
    path: "/api/flows/:id",
    description: "Topologia resolvida a partir da raiz, mais isDirty (rascunho difere da versão publicada — RQ-VER-03).",
    permission: "flow.read",
  },
  {
    group: "Fluxos",
    name: "Atualizar fluxo",
    method: "PATCH",
    path: "/api/flows/:id",
    description: "Atualiza nome/descrição do fluxo (metadado — não publica).",
    permission: "flow.write",
    body: { name: "Pesquisa e redação v2", description: "" },
  },
  {
    group: "Fluxos",
    name: "Publicar versão",
    method: "POST",
    path: "/api/flows/:id/publish",
    description: "Congela o rascunho como versão imutável. 409 code:\"no_changes\" se o hash não mudou (RQ-VER-04).",
    permission: "flow.publish",
    body: { message: "Ajuste de temperature do coordenador" },
  },
  {
    group: "Fluxos",
    name: "Listar versões",
    method: "GET",
    path: "/api/flows/:id/versions",
    description: "Linha do tempo de versões publicadas, mais recente primeiro.",
    permission: "flow.read",
  },
  {
    group: "Fluxos",
    name: "Detalhar versão",
    method: "GET",
    path: "/api/flows/:id/versions/:n",
    description: "Snapshot completo da versão n — grafo, prompts e parâmetros usados por aquela execução.",
    permission: "flow.read",
  },
  {
    group: "Fluxos",
    name: "Rollback",
    method: "POST",
    path: "/api/flows/:id/versions/:n/rollback",
    description: "Reaplica o snapshot n sobre o rascunho e publica uma versão nova — histórico nunca é reescrito (RQ-VER-08).",
    permission: "flow.rollback",
  },
  {
    group: "Fluxos",
    name: "Etiquetar versão",
    method: "POST",
    path: "/api/flows/:id/versions/:n/tag",
    description: "Move uma etiqueta única do fluxo (ex.: \"producao\") para a versão n (RQ-VER-12).",
    permission: "flow.publish",
    body: { tag: "producao" },
  },
  {
    group: "Fluxos",
    name: "Diff entre versões",
    method: "GET",
    path: "/api/flows/:id/diff",
    description: "Diferenças estruturais por entidade e campo. from/to aceitam número de versão, etiqueta ou \"draft\".",
    permission: "flow.read",
    query: { from: "1", to: "2" },
  },
  {
    group: "Fluxos",
    name: "Grafo do fluxo",
    method: "GET",
    path: "/api/flows/:id/graph",
    description:
      "Nós e arestas para a visualização gráfica (RQ-VIS-01). version aceita \"draft\" (padrão), \"current\", " +
      "número de versão ou etiqueta.",
    permission: "flow.read",
    query: { version: "draft" },
  },
  {
    group: "Roteamento de modelos",
    name: "Listar políticas",
    method: "GET",
    path: "/api/model-policies",
    description: "Políticas reutilizáveis de roteamento, com a cadeia de candidatos por tipo de tarefa (RQ-ROT-02).",
    permission: "policy.read",
  },
  {
    group: "Roteamento de modelos",
    name: "Criar política",
    method: "POST",
    path: "/api/model-policies",
    description:
      "Cria uma cadeia ordenada de modelos. A ordem do array candidates é a preferência; rank explícito " +
      "sobrescreve a posição. taskType agrupa cadeias distintas para a mesma política (RQ-ROT-04/05).",
    permission: "policy.write",
    body: {
      name: "Raciocínio pesado",
      description: "Opus primeiro, Sonnet como reserva.",
      candidates: [
        { taskType: "reasoning", providerId: "{{provider_id}}", model: "claude-opus-4-8" },
        { taskType: "reasoning", providerId: "{{provider_id}}", model: "claude-sonnet-5" },
      ],
    },
  },
  {
    group: "Roteamento de modelos",
    name: "Detalhar política",
    method: "GET",
    path: "/api/model-policies/:id",
    description: "Política com a cadeia completa e quantos agentes a usam.",
    permission: "policy.read",
  },
  {
    group: "Roteamento de modelos",
    name: "Atualizar política",
    method: "PATCH",
    path: "/api/model-policies/:id",
    description: "Atualiza metadados e/ou substitui a lista inteira de candidatos pela enviada.",
    permission: "policy.write",
    body: { name: "Raciocínio pesado v2", candidates: [] },
  },
  {
    group: "Roteamento de modelos",
    name: "Excluir política",
    method: "DELETE",
    path: "/api/model-policies/:id",
    description:
      "Exclusão lógica — versões publicadas congelaram a cadeia (RQ-ROT-10) e seguem íntegras; agentes vivos perdem a referência.",
    permission: "policy.write",
  },
  {
    group: "Roteamento de modelos",
    name: "Saúde observada dos modelos",
    method: "GET",
    path: "/api/model-health",
    description:
      "Falhas consecutivas, último erro e carência por par (provedor, modelo) — explica por que um candidato de prioridade alta está sendo pulado (RQ-ROT-08).",
    permission: "policy.read",
  },
  {
    group: "Execuções",
    name: "Listar execuções",
    method: "GET",
    path: "/api/runs",
    description: "Histórico de execuções, mais recentes primeiro. Filtre por status: queued|running|succeeded|failed|cancelled|timed_out.",
    permission: "run.read",
    query: { agentId: "", flowId: "", status: "", limit: "50" },
  },
  {
    group: "Execuções",
    name: "Executar agente",
    method: "POST",
    path: "/api/runs",
    description:
      "Enfileira a execução e responde 202 com { id, status: 'queued' } — não espera terminar (RQ-ASY-01). " +
      "Use ?wait=<segundos> (máx. 120) para aguardar o término síncronamente sem sair do modelo assíncrono por " +
      "baixo. O header Idempotency-Key evita duplicar a run em retry de rede (devolve a run original, 200). " +
      "Sem flowVersion, executa o rascunho ao vivo e grava o snapshot efêmero usado (RQ-VER-06). Com " +
      "flowVersion (número ou \"current\"), agentId precisa ser a raiz de um fluxo publicado — a execução fica " +
      "fixada na topologia e nos parâmetros daquele snapshot, mesmo que o rascunho mude depois (RQ-VER-05). " +
      "taskType opcional escolhe a cadeia de modelos daquele tipo de tarefa; se o primeiro candidato estiver " +
      "indisponível, o próximo é acionado automaticamente (RQ-ROT-04/06).",
    permission: "run.create",
    body: {
      agentId: "{{agent_id}}",
      input: "Pesquise as novidades de MCP e escreva um resumo.",
      flowVersion: "current",
      taskType: "reasoning",
    },
    query: { wait: "" },
  },
  {
    group: "Execuções",
    name: "Detalhar execução",
    method: "GET",
    path: "/api/runs/:id",
    description: "Retorna a execução com a árvore de spans (modelo, tools, delegações, conexão MCP).",
    permission: "run.read",
  },
  {
    group: "Execuções",
    name: "Acompanhar execução ao vivo (SSE)",
    method: "GET",
    path: "/api/runs/:id/events",
    description:
      "text/event-stream com eventos span/log/status/done. Envie o header Last-Event-ID para retomar de onde " +
      "parou após uma desconexão (RQ-ASY-04) — o próprio EventSource do navegador já faz isso sozinho.",
    permission: "run.read",
  },
  {
    group: "Execuções",
    name: "Cancelar execução",
    method: "POST",
    path: "/api/runs/:id/cancel",
    description:
      "queued cancela na hora; running pede cancelamento cooperativo (até 2s). 409 se a run já terminou.",
    permission: "run.cancel",
  },
  {
    group: "Execuções",
    name: "Log estruturado da execução",
    method: "GET",
    path: "/api/runs/:id/logs",
    description: "Log correlacionado com os spans, filtrável por nível.",
    permission: "run.read",
    query: { level: "error", afterSeq: "0", limit: "200" },
  },
  {
    group: "Execuções",
    name: "Grafo da execução",
    method: "GET",
    path: "/api/runs/:id/graph",
    description:
      "Topologia do snapshot que rodou (nunca a configuração atual — RQ-VIS-08) com agregados por nó e aresta " +
      "reconstruídos a partir dos spans: estado, chamadas, tokens, duração e erros (RQ-VIS-03/04/07).",
    permission: "run.read",
  },
  {
    group: "Observabilidade",
    name: "Métricas",
    method: "GET",
    path: "/api/metrics",
    description: "Agrega execuções por status, taxa de erro, latência p50/p95, tokens e custo.",
    permission: "run.read",
    query: { agentId: "", window: "24h" },
  },
  {
    group: "Observabilidade",
    name: "Saúde do sistema",
    method: "GET",
    path: "/api/health",
    description: "Profundidade da fila, execuções em andamento, espera mais antiga, conectividade do banco e versão.",
    permission: "public",
  },
  {
    group: "Postman",
    name: "Baixar collection",
    method: "GET",
    path: "/api/postman/collection",
    description: "Gera a Postman Collection v2.1 com todos os endpoints desta API.",
    permission: "authenticated",
  },
  {
    group: "Autenticação",
    name: "Login",
    method: "POST",
    path: "/api/auth/login",
    description: "Autentica por e-mail/senha e devolve um cookie de sessão httpOnly.",
    permission: "public",
    body: { email: "admin@exemplo.com", password: "{{admin_password}}" },
  },
  {
    group: "Autenticação",
    name: "Logout",
    method: "POST",
    path: "/api/auth/logout",
    description: "Revoga a sessão corrente.",
    permission: "authenticated",
  },
  {
    group: "Autenticação",
    name: "Sessão atual",
    method: "GET",
    path: "/api/auth/me",
    description: "Usuário autenticado, papel e permissões efetivas.",
    permission: "authenticated",
  },
  {
    group: "Autenticação",
    name: "Trocar senha",
    method: "POST",
    path: "/api/auth/change-password",
    description: "Exige a senha atual; limpa mustChangePassword.",
    permission: "authenticated",
    body: { currentPassword: "{{current_password}}", newPassword: "{{new_password}}" },
  },
  {
    group: "Autenticação",
    name: "Setup ainda necessário?",
    method: "GET",
    path: "/api/setup",
    description: "Diz se o bootstrap ainda é preciso. Depois do primeiro usuário, 404.",
    permission: "public",
  },
  {
    group: "Autenticação",
    name: "Bootstrap do primeiro admin",
    method: "POST",
    path: "/api/setup",
    description: "Só funciona enquanto não há nenhum usuário cadastrado. Depois responde 404.",
    permission: "public",
    body: { email: "admin@exemplo.com", name: "Admin", password: "{{admin_password}}" },
  },
  {
    group: "Usuários",
    name: "Listar usuários",
    method: "GET",
    path: "/api/users",
    description: "Lista todos os usuários cadastrados.",
    permission: "user.manage",
  },
  {
    group: "Usuários",
    name: "Criar usuário",
    method: "POST",
    path: "/api/users",
    description: "Cadastra um usuário e devolve a senha temporária uma única vez.",
    permission: "user.manage",
    body: { email: "pessoa@exemplo.com", name: "Pessoa", role: "editor" },
  },
  {
    group: "Usuários",
    name: "Atualizar usuário",
    method: "PATCH",
    path: "/api/users/:id",
    description: "Atualiza papel, nome ou status do usuário.",
    permission: "user.manage",
    body: { role: "viewer" },
  },
  {
    group: "Usuários",
    name: "Desativar usuário",
    method: "DELETE",
    path: "/api/users/:id",
    description: "Desativação lógica: revoga sessões e tokens, preserva autoria histórica.",
    permission: "user.manage",
  },
  {
    group: "Usuários",
    name: "Redefinir senha",
    method: "POST",
    path: "/api/users/:id/reset-password",
    description: "Gera uma nova senha temporária e força troca no próximo login.",
    permission: "user.manage",
  },
  {
    group: "Tokens de API",
    name: "Listar tokens",
    method: "GET",
    path: "/api/tokens",
    description: "Lista os próprios tokens (admin vê todos).",
    permission: "token.self",
  },
  {
    group: "Tokens de API",
    name: "Criar token",
    method: "POST",
    path: "/api/tokens",
    description: "Emite um token de API com o papel do usuário. Devolvido uma única vez.",
    permission: "token.self",
    body: { name: "CI" },
  },
  {
    group: "Tokens de API",
    name: "Revogar token",
    method: "DELETE",
    path: "/api/tokens/:id",
    description: "Revoga o token imediatamente.",
    permission: "token.self",
  },
  {
    group: "Auditoria",
    name: "Listar eventos de auditoria",
    method: "GET",
    path: "/api/audit",
    description: "Eventos sensíveis (login, cadastro, segredo alterado…), sem dados de segredo.",
    permission: "audit.read",
    query: { actorId: "", action: "", limit: "50" },
  },
  {
    group: "Tutorial",
    name: "Progresso do tutorial",
    method: "GET",
    path: "/api/tutorial/progress",
    description: "Checks de progresso derivados do estado real do banco (design 009).",
    permission: "authenticated",
  },
  {
    group: "OpenAI-compatível",
    name: "Chat completions",
    method: "POST",
    path: "/api/v1/chat/completions",
    description:
      "Dialeto chat/completions da OpenAI sobre o motor de runs (design 010). model: \"<slug do fluxo|id do agente>[@<versão|current>]\". " +
      "Uma requisição = uma run, sem memória entre chamadas. tools/functions/n>1 devolvem 400; temperature e afins são ignorados.",
    permission: "run.create",
    body: {
      model: "atendimento-fiat@current",
      messages: [{ role: "user", content: "Qual a garantia do Pulse?" }],
      stream: false,
    },
  },
  {
    group: "OpenAI-compatível",
    name: "Listar modelos",
    method: "GET",
    path: "/api/v1/models",
    description: "Catálogo de orquestradores no formato GET /v1/models — todo id devolvido funciona como model.",
    permission: "agent.read",
  },
];

type PostmanItem = {
  name: string;
  request: {
    method: string;
    header: { key: string; value: string }[];
    url: { raw: string; host: string[]; path: string[]; query?: { key: string; value: string }[] };
    body?: { mode: "raw"; raw: string; options: { raw: { language: "json" } } };
    description: string;
  };
};

/** Converte o registro em uma Postman Collection v2.1.0. */
export function buildPostmanCollection() {
  const groups = new Map<string, PostmanItem[]>();

  for (const endpoint of API_ENDPOINTS) {
    // :id vira {{..._id}} para o usuário preencher nas variáveis da collection.
    const segments = endpoint.path
      .replace(/^\//, "")
      .split("/")
      .map((seg) => (seg.startsWith(":") ? `{{${seg.slice(1)}}}` : seg));

    const query = endpoint.query
      ? Object.entries(endpoint.query).map(([key, value]) => ({ key, value }))
      : undefined;
    const queryString = query?.length
      ? `?${query.map((q) => `${q.key}=${q.value}`).join("&")}`
      : "";

    const item: PostmanItem = {
      name: endpoint.name,
      request: {
        method: endpoint.method,
        header: endpoint.body ? [{ key: "Content-Type", value: "application/json" }] : [],
        url: {
          raw: `{{baseUrl}}/${segments.join("/")}${queryString}`,
          host: ["{{baseUrl}}"],
          path: segments,
          ...(query ? { query } : {}),
        },
        ...(endpoint.body
          ? {
              body: {
                mode: "raw" as const,
                raw: JSON.stringify(endpoint.body, null, 2),
                options: { raw: { language: "json" as const } },
              },
            }
          : {}),
        description: endpoint.description,
      },
    };

    const bucket = groups.get(endpoint.group) ?? [];
    bucket.push(item);
    groups.set(endpoint.group, bucket);
  }

  return {
    info: {
      _postman_id: "a9d1f0c2-4b7e-4a1d-9c3f-orquestrador0001",
      name: "Orquestrador de Agentes — API",
      description:
        "API de gerenciamento de provedores, servidores MCP, agentes/subagentes e execuções.\n\n" +
        "Configure a variável `baseUrl` (padrão http://localhost:3000), gere um token em " +
        "/conta/tokens e preencha `apiToken`. As rotas exigem `Authorization: Bearer {{apiToken}}`.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: {
      type: "bearer" as const,
      bearer: [{ key: "token", value: "{{apiToken}}", type: "string" as const }],
    },
    item: [...groups.entries()].map(([name, item]) => ({ name, item })),
    variable: [
      { key: "baseUrl", value: "http://localhost:3000", type: "string" },
      { key: "apiToken", value: "", type: "string" },
      { key: "id", value: "", type: "string" },
      { key: "provider_id", value: "", type: "string" },
      { key: "agent_id", value: "", type: "string" },
      { key: "mcp_server_id", value: "", type: "string" },
      { key: "n", value: "1", type: "string" },
      { key: "anthropic_api_key", value: "", type: "string" },
      { key: "github_token", value: "", type: "string" },
      { key: "admin_password", value: "", type: "string" },
      { key: "current_password", value: "", type: "string" },
      { key: "new_password", value: "", type: "string" },
    ],
  };
}
