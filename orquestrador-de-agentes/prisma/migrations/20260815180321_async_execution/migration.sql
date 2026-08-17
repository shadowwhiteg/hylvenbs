-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
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
    CONSTRAINT "Run_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("agentId", "costUsd", "endedAt", "error", "errorType", "id", "input", "inputTokens", "output", "outputTokens", "startedAt", "status", "triggeredById") SELECT "agentId", "costUsd", "endedAt", "error", "errorType", "id", "input", "inputTokens", "output", "outputTokens", "startedAt", "status", "triggeredById" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE UNIQUE INDEX "Run_idempotencyKey_key" ON "Run"("idempotencyKey");
CREATE INDEX "Run_agentId_startedAt_idx" ON "Run"("agentId", "startedAt");
CREATE INDEX "Run_status_priority_queuedAt_idx" ON "Run"("status", "priority", "queuedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
