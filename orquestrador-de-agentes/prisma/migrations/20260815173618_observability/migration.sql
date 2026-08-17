-- AlterTable
ALTER TABLE "Run" ADD COLUMN "costUsd" REAL;
ALTER TABLE "Run" ADD COLUMN "errorType" TEXT;

-- CreateTable
CREATE TABLE "Span" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorType" TEXT,
    "errorMessage" TEXT,
    "attributes" TEXT NOT NULL DEFAULT '{}',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL,
    "seq" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "durationMs" INTEGER,
    CONSTRAINT "Span_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Span_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Span_spanId_key" ON "Span"("spanId");

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "spanId" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "errorType" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LogEntry_spanId_fkey" FOREIGN KEY ("spanId") REFERENCES "Span" ("spanId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- MigrateData: RunStep -> Span (RQ-NFR-01). Sem hierarquia real de parentSpanId na
-- origem (só existia "depth"); preserva ordem, profundidade e duração.
INSERT INTO "Span" ("id", "runId", "traceId", "spanId", "parentSpanId", "kind", "name", "agentId", "status", "errorType", "seq", "depth", "startedAt", "endedAt", "durationMs")
SELECT
  lower(hex(randomblob(12))),
  "runId",
  "runId",
  lower(hex(randomblob(8))),
  NULL,
  CASE "type" WHEN 'error' THEN 'tool' ELSE "type" END,
  "name",
  "agentId",
  CASE "type" WHEN 'error' THEN 'error' ELSE 'ok' END,
  CASE "type" WHEN 'error' THEN 'internal_error' ELSE NULL END,
  "index",
  "depth",
  "createdAt",
  "createdAt",
  "durationMs"
FROM "RunStep";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RunStep";
PRAGMA foreign_keys=on;

-- CreateIndex
CREATE INDEX "Span_runId_seq_idx" ON "Span"("runId", "seq");

-- CreateIndex
CREATE INDEX "Span_traceId_idx" ON "Span"("traceId");

-- CreateIndex
CREATE INDEX "Span_parentSpanId_idx" ON "Span"("parentSpanId");

-- CreateIndex
CREATE INDEX "Span_status_errorType_idx" ON "Span"("status", "errorType");

-- CreateIndex
CREATE INDEX "LogEntry_runId_seq_idx" ON "LogEntry"("runId", "seq");

-- CreateIndex
CREATE INDEX "LogEntry_runId_level_idx" ON "LogEntry"("runId", "level");

-- CreateIndex
CREATE INDEX "Run_agentId_startedAt_idx" ON "Run"("agentId", "startedAt");
