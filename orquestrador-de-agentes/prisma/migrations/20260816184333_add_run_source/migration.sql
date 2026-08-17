-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "source" TEXT NOT NULL DEFAULT 'ui',
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
INSERT INTO "new_Run" ("agentId", "attempt", "cancelRequestedAt", "configDrift", "costUsd", "draftSnapshot", "driftDetail", "endedAt", "error", "errorType", "flowId", "flowVersionId", "heartbeatAt", "id", "idempotencyKey", "input", "inputTokens", "lockedAt", "lockedBy", "maxAttempts", "modelFailover", "nextAttemptAt", "output", "outputTokens", "priority", "queuedAt", "sourceKind", "startedAt", "status", "taskType", "timeoutMs", "triggeredById") SELECT "agentId", "attempt", "cancelRequestedAt", "configDrift", "costUsd", "draftSnapshot", "driftDetail", "endedAt", "error", "errorType", "flowId", "flowVersionId", "heartbeatAt", "id", "idempotencyKey", "input", "inputTokens", "lockedAt", "lockedBy", "maxAttempts", "modelFailover", "nextAttemptAt", "output", "outputTokens", "priority", "queuedAt", "sourceKind", "startedAt", "status", "taskType", "timeoutMs", "triggeredById" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_idempotencyKey_key" ON "Run"("idempotencyKey");
CREATE INDEX "Run_agentId_startedAt_idx" ON "Run"("agentId", "startedAt");
CREATE INDEX "Run_status_priority_queuedAt_idx" ON "Run"("status", "priority", "queuedAt");
CREATE INDEX "Run_flowId_startedAt_idx" ON "Run"("flowId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
