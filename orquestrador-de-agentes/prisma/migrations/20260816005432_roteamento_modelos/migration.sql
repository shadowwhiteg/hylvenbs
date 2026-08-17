-- CreateTable
CREATE TABLE "ModelPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ModelCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyId" TEXT,
    "agentId" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'default',
    "rank" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "maxTokens" INTEGER,
    "temperature" REAL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelCandidate_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ModelPolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModelCandidate_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModelCandidate_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelHealth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastErrorType" TEXT,
    "lastErrorMessage" TEXT,
    "lastErrorAt" DATETIME,
    "lastOkAt" DATETIME,
    "cooldownUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
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
    "modelPolicyId" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'default',
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
    CONSTRAINT "Agent_modelPolicyId_fkey" FOREIGN KEY ("modelPolicyId") REFERENCES "ModelPolicy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("createdAt", "createdById", "deletedAt", "description", "enabled", "flowId", "id", "maxSteps", "maxTokens", "model", "name", "providerId", "role", "stopSequences", "systemPrompt", "temperature", "topK", "topP", "updatedAt", "updatedById") SELECT "createdAt", "createdById", "deletedAt", "description", "enabled", "flowId", "id", "maxSteps", "maxTokens", "model", "name", "providerId", "role", "stopSequences", "systemPrompt", "temperature", "topK", "topP", "updatedAt", "updatedById" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE INDEX "Agent_flowId_idx" ON "Agent"("flowId");
CREATE INDEX "Agent_deletedAt_idx" ON "Agent"("deletedAt");
CREATE INDEX "Agent_modelPolicyId_idx" ON "Agent"("modelPolicyId");
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "flowId" TEXT,
    "flowVersionId" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'draft',
    "draftSnapshot" TEXT,
    "configDrift" BOOLEAN NOT NULL DEFAULT false,
    "driftDetail" TEXT,
    "taskType" TEXT,
    "modelFailover" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Run" ("agentId", "attempt", "cancelRequestedAt", "configDrift", "costUsd", "draftSnapshot", "driftDetail", "endedAt", "error", "errorType", "flowId", "flowVersionId", "heartbeatAt", "id", "idempotencyKey", "input", "inputTokens", "lockedAt", "lockedBy", "maxAttempts", "nextAttemptAt", "output", "outputTokens", "priority", "queuedAt", "sourceKind", "startedAt", "status", "timeoutMs", "triggeredById") SELECT "agentId", "attempt", "cancelRequestedAt", "configDrift", "costUsd", "draftSnapshot", "driftDetail", "endedAt", "error", "errorType", "flowId", "flowVersionId", "heartbeatAt", "id", "idempotencyKey", "input", "inputTokens", "lockedAt", "lockedBy", "maxAttempts", "nextAttemptAt", "output", "outputTokens", "priority", "queuedAt", "sourceKind", "startedAt", "status", "timeoutMs", "triggeredById" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_idempotencyKey_key" ON "Run"("idempotencyKey");
CREATE INDEX "Run_agentId_startedAt_idx" ON "Run"("agentId", "startedAt");
CREATE INDEX "Run_status_priority_queuedAt_idx" ON "Run"("status", "priority", "queuedAt");
CREATE INDEX "Run_flowId_startedAt_idx" ON "Run"("flowId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ModelPolicy_slug_key" ON "ModelPolicy"("slug");

-- CreateIndex
CREATE INDEX "ModelPolicy_deletedAt_idx" ON "ModelPolicy"("deletedAt");

-- CreateIndex
CREATE INDEX "ModelCandidate_policyId_taskType_rank_idx" ON "ModelCandidate"("policyId", "taskType", "rank");

-- CreateIndex
CREATE INDEX "ModelCandidate_agentId_taskType_rank_idx" ON "ModelCandidate"("agentId", "taskType", "rank");

-- CreateIndex
CREATE INDEX "ModelHealth_cooldownUntil_idx" ON "ModelHealth"("cooldownUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ModelHealth_providerId_model_key" ON "ModelHealth"("providerId", "model");
