/**
 * MCP stdio server for Cursor — same tools as the Web agent.
 * Run: npm run mcp
 *
 * Example Cursor mcp.json:
 * {
 *   "mcpServers": {
 *     "ml-drop-publisher": {
 *       "command": "npm",
 *       "args": ["run", "mcp"],
 *       "cwd": "/absolute/path/to/Publicação de Produtos"
 *     }
 *   }
 * }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AGENT_TOOLS, executeAgentTool } from "../lib/agent/tools";
import { AI_PROVIDER_IDS } from "../lib/agent/providers";

const server = new McpServer({
  name: "ml-drop-publisher",
  version: "0.2.0",
});

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

server.registerTool(
  "sync_catalog",
  {
    description: AGENT_TOOLS.find((t) => t.name === "sync_catalog")!.description,
    inputSchema: {
      skipMlSync: z.boolean().optional().describe("Se true, não faz PUT no ML após o sync"),
    },
  },
  async (args) => textResult(await executeAgentTool("sync_catalog", args))
);

server.registerTool(
  "sync_ml_listings",
  {
    description: AGENT_TOOLS.find((t) => t.name === "sync_ml_listings")!.description,
    inputSchema: {},
  },
  async () => textResult(await executeAgentTool("sync_ml_listings", {}))
);

server.registerTool(
  "list_products",
  {
    description: AGENT_TOOLS.find((t) => t.name === "list_products")!.description,
    inputSchema: {
      status: z.string().optional(),
      q: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (args) => textResult(await executeAgentTool("list_products", args))
);

server.registerTool(
  "apply_margin",
  {
    description: AGENT_TOOLS.find((t) => t.name === "apply_margin")!.description,
    inputSchema: {
      productIds: z.array(z.string()),
      marginPercent: z.number(),
      pushToMl: z.boolean().optional(),
    },
  },
  async (args) => textResult(await executeAgentTool("apply_margin", args))
);

server.registerTool(
  "get_settings",
  {
    description: AGENT_TOOLS.find((t) => t.name === "get_settings")!.description,
    inputSchema: {},
  },
  async () => textResult(await executeAgentTool("get_settings", {}))
);

server.registerTool(
  "update_settings",
  {
    description: AGENT_TOOLS.find((t) => t.name === "update_settings")!.description,
    inputSchema: {
      marginPercent: z.number().optional(),
      autoSyncMode: z
        .enum(["always", "stock_only", "respect_user_edits", "manual"])
        .optional(),
      autoPauseWhenUnavailable: z.boolean().optional(),
      ollamaBaseUrl: z.string().optional(),
      ollamaModel: z.string().optional(),
      aiProvider: z.enum(AI_PROVIDER_IDS).optional(),
      aiApiKey: z.string().optional(),
      aiBaseUrl: z.string().optional(),
      aiModel: z.string().optional(),
      aiCliCommand: z.string().optional(),
      aiCliArgs: z.array(z.string()).optional(),
    },
  },
  async (args) => textResult(await executeAgentTool("update_settings", args))
);

server.registerTool(
  "get_status",
  {
    description: AGENT_TOOLS.find((t) => t.name === "get_status")!.description,
    inputSchema: {},
  },
  async () => textResult(await executeAgentTool("get_status", {}))
);

server.registerTool(
  "queue_publish",
  {
    description: AGENT_TOOLS.find((t) => t.name === "queue_publish")!.description,
    inputSchema: {
      productIds: z.array(z.string()),
    },
  },
  async (args) => textResult(await executeAgentTool("queue_publish", args))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] ml-drop-publisher listening on stdio");
}

main().catch((err) => {
  console.error("[mcp] fatal", err);
  process.exit(1);
});
