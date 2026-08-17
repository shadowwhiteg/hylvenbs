/** Include padrão do agente — usado pelas rotas e pelas páginas server-side. */
export const AGENT_INCLUDE = {
  provider: true,
  children: { include: { child: true } },
  mcpServers: { include: { mcpServer: true } },
  candidates: { include: { provider: { select: { id: true, name: true, kind: true } } } },
  modelPolicy: { select: { id: true, name: true, slug: true } },
} as const;
