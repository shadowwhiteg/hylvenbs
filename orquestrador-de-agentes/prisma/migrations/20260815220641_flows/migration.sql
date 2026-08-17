-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN "deletedAt" DATETIME;

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rootAgentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Flow_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "FlowVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FlowVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "tag" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowVersion_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
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
    "flowId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Agent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("createdAt", "createdById", "description", "enabled", "id", "maxSteps", "maxTokens", "model", "name", "providerId", "role", "stopSequences", "systemPrompt", "temperature", "topK", "topP", "updatedAt", "updatedById") SELECT "createdAt", "createdById", "description", "enabled", "id", "maxSteps", "maxTokens", "model", "name", "providerId", "role", "stopSequences", "systemPrompt", "temperature", "topK", "topP", "updatedAt", "updatedById" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE INDEX "Agent_flowId_idx" ON "Agent"("flowId");
CREATE INDEX "Agent_deletedAt_idx" ON "Agent"("deletedAt");
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "flowId" TEXT,
    "flowVersionId" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'draft',
    "draftSnapshot" TEXT,
    "configDrift" BOOLEAN NOT NULL DEFAULT false,
    "driftDetail" TEXT,
    "triggeredById" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "errorType" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "lockedBy" TEXT,
    "lockedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "nextAttemptAt" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
    "cancelRequestedAt" DATETIME,
    "idempotencyKey" TEXT,
    CONSTRAINT "Run_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "FlowVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("agentId", "attempt", "cancelRequestedAt", "costUsd", "endedAt", "error", "errorType", "heartbeatAt", "id", "idempotencyKey", "input", "inputTokens", "lockedAt", "lockedBy", "maxAttempts", "nextAttemptAt", "output", "outputTokens", "priority", "queuedAt", "startedAt", "status", "timeoutMs", "triggeredById") SELECT "agentId", "attempt", "cancelRequestedAt", "costUsd", "endedAt", "error", "errorType", "heartbeatAt", "id", "idempotencyKey", "input", "inputTokens", "lockedAt", "lockedBy", "maxAttempts", "nextAttemptAt", "output", "outputTokens", "priority", "queuedAt", "startedAt", "status", "timeoutMs", "triggeredById" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_idempotencyKey_key" ON "Run"("idempotencyKey");
CREATE INDEX "Run_agentId_startedAt_idx" ON "Run"("agentId", "startedAt");
CREATE INDEX "Run_status_priority_queuedAt_idx" ON "Run"("status", "priority", "queuedAt");
CREATE INDEX "Run_flowId_startedAt_idx" ON "Run"("flowId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Flow_slug_key" ON "Flow"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Flow_currentVersionId_key" ON "Flow"("currentVersionId");

-- CreateIndex
CREATE INDEX "FlowVersion_flowId_createdAt_idx" ON "FlowVersion"("flowId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowVersion_flowId_version_key" ON "FlowVersion"("flowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FlowVersion_flowId_tag_key" ON "FlowVersion"("flowId", "tag");

-- CreateIndex
CREATE INDEX "McpServer_deletedAt_idx" ON "McpServer"("deletedAt");

-- CreateIndex
CREATE INDEX "Provider_deletedAt_idx" ON "Provider"("deletedAt");
