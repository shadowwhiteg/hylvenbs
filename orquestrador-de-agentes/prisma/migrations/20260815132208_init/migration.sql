-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEnc" TEXT,
    "models" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'stdio',
    "command" TEXT,
    "args" TEXT NOT NULL DEFAULT '[]',
    "envEnc" TEXT,
    "envKeys" TEXT NOT NULL DEFAULT '[]',
    "url" TEXT,
    "headersEnc" TEXT,
    "headerKeys" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "toolsCache" TEXT NOT NULL DEFAULT '[]',
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastCheckedAt" DATETIME,
    "configHash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'subagent',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT,
    "model" TEXT NOT NULL DEFAULT '',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "topP" REAL NOT NULL DEFAULT 1,
    "topK" INTEGER NOT NULL DEFAULT 0,
    "stopSequences" TEXT NOT NULL DEFAULT '[]',
    "maxSteps" INTEGER NOT NULL DEFAULT 12,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Agent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    CONSTRAINT "AgentLink_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentLink_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMcpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    CONSTRAINT "AgentMcpServer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMcpServer_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "Run_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "agentId" TEXT,
    "index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "input" TEXT NOT NULL DEFAULT 'null',
    "output" TEXT NOT NULL DEFAULT 'null',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RunStep_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ModelPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerKind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPerMTok" REAL NOT NULL,
    "outputPerMTok" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentLink_parentId_childId_key" ON "AgentLink"("parentId", "childId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMcpServer_agentId_mcpServerId_key" ON "AgentMcpServer"("agentId", "mcpServerId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPrice_providerKind_model_key" ON "ModelPrice"("providerKind", "model");
