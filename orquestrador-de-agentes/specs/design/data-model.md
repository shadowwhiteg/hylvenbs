# Design · Modelo de dados consolidado

Fonte única do schema alvo. Os designs 001–006 referenciam este documento e **não**
redefinem modelos — se um design precisa de campo novo, ele é adicionado aqui.

Convenções do SQLite neste projeto: não há `enum` nem tipo JSON nativos, então
enumerações são `String` com os valores documentados no comentário `///`, e campos
estruturados são `String` contendo JSON (lidos com `parseJson` de
[src/lib/db.ts](../../src/lib/db.ts)).

Legenda: **[N]** modelo novo · **[M]** modelo alterado · **[R]** modelo removido.

---

## 1. Identidade e acesso — [N]

```prisma
model User {
  id           String  @id @default(cuid())
  email        String  @unique
  name         String
  /// Formato: scrypt$N=<n>,r=<r>,p=<p>$<sal-b64>$<hash-b64>. Ver RQ-AUTH-13.
  passwordHash String
  /// "admin" | "editor" | "viewer"
  role         String  @default("viewer")
  /// "active" | "disabled"
  status       String  @default("active")
  mustChangePassword Boolean @default(true)

  failedLoginCount Int       @default(0)
  lockedUntil      DateTime?
  lastLoginAt      DateTime?

  createdById String?
  createdBy   User?   @relation("UserCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdUsers User[] @relation("UserCreator")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sessions   Session[]
  apiTokens  ApiToken[]
  auditLogs  AuditLog[]
  runs       Run[]
  flows      Flow[]
  flowVersions FlowVersion[]

  @@index([status])
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// SHA-256 do token de sessão. O token em si só existe no cookie do cliente.
  tokenHash String   @unique
  expiresAt DateTime
  lastSeenAt DateTime @default(now())
  userAgent String?
  ip        String?
  revokedAt DateTime?
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model ApiToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  /// Primeiros 8 caracteres, exibidos na UI para identificar o token.
  prefix    String
  /// SHA-256 do token completo. Ver RQ-AUTH-09.
  tokenHash String   @unique
  expiresAt DateTime?
  lastUsedAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())

  @@index([userId])
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  actor      User?    @relation(fields: [actorId], references: [id], onDelete: SetNull)
  /// Ex.: "auth.login", "user.created", "flow.published", "secret.updated"
  action     String
  /// "user" | "provider" | "mcpServer" | "agent" | "flow" | "flowVersion" | "run" | "apiToken"
  targetType String
  targetId   String?
  /// JSON com contexto — nunca contém segredo (RQ-SEC-09).
  metadata   String   @default("{}")
  ip         String?
  createdAt  DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([targetType, targetId])
}
```

## 2. Provedores e servidores MCP — [M]

Mudanças: segredos passam a ser ciphertext (design 005), exclusão vira lógica para não
quebrar versões publicadas (RQ-VER-11) e ganham autoria.

```prisma
model Provider {
  id        String   @id @default(cuid())
  name      String
  kind      String
  baseUrl   String?
  /// ANTES: apiKey (texto plano). AGORA: envelope "v1:<iv>:<tag>:<ct>" (RQ-SEC-01).
  apiKeyEnc String?
  models    String   @default("[]")
  enabled   Boolean  @default(true)

  createdById String?
  updatedById String?
  deletedAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  agents Agent[]

  @@index([deletedAt])
}

model McpServer {
  id        String   @id @default(cuid())
  name      String
  transport String   @default("stdio")
  command   String?
  args      String   @default("[]")
  /// ANTES: env (JSON em claro). AGORA: envelope cifrado do JSON (RQ-SEC-01).
  envEnc    String?
  /// Nomes das variáveis, em claro — usados no snapshot de versão (RQ-VER-09) e na UI.
  envKeys   String   @default("[]")
  url       String?
  /// ANTES: headers (JSON em claro). AGORA: envelope cifrado do JSON.
  headersEnc String?
  headerKeys String  @default("[]")

  enabled    Boolean @default(true)
  toolsCache String  @default("[]")
  lastStatus String?
  lastError  String?
  lastCheckedAt DateTime?

  /// SHA-256 de {transport, command, args, url, envKeys, headerKeys} — detecta drift (RQ-VER-10).
  configHash String @default("")

  createdById String?
  updatedById String?
  deletedAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  bindings AgentMcpServer[]

  @@index([deletedAt])
}
```

## 3. Agentes — [M]

Estrutura preservada; ganha autoria, exclusão lógica e vínculo com fluxo.

```prisma
model Agent {
  // ... todos os campos atuais permanecem (name, description, role, systemPrompt,
  // providerId, model, temperature, maxTokens, topP, topK, stopSequences, maxSteps, enabled)

  /// Fluxo ao qual este agente pertence. Nulo = agente avulso, ainda não agrupado.
  flowId String?
  flow   Flow?   @relation(fields: [flowId], references: [id], onDelete: SetNull)

  createdById String?
  updatedById String?
  /// Exclusão lógica: versões publicadas continuam íntegras (RQ-VER-11).
  deletedAt   DateTime?

  spans Span[]

  @@index([flowId])
  @@index([deletedAt])
}
```

`AgentLink` e `AgentMcpServer` permanecem como estão.

`role` (`String`) ganha um terceiro valor válido em aplicação, sem migração de schema
(design 008, RQ-HIER-08): `"orchestrator" | "agent" | "subagent"`. `src/lib/agents/roles.ts`
é a fonte única do vocabulário e dos predicados `canDelegate`/`canBeRoot`/`canBeChild` —
nenhum outro módulo compara `role` com um literal (regra de arquitetura em
`tests/architecture.test.ts`).

## 4. Fluxos e versões — [N]

```prisma
model Flow {
  id          String @id @default(cuid())
  name        String
  slug        String @unique
  description String @default("")

  /// Orquestrador raiz. O grafo é resolvido a partir dele por AgentLink.
  rootAgentId String
  /// "draft" | "published" | "archived"
  status      String @default("draft")

  /// Última versão publicada. Nulo enquanto o fluxo nunca foi publicado.
  currentVersionId String?      @unique
  currentVersion   FlowVersion? @relation("CurrentVersion", fields: [currentVersionId], references: [id], onDelete: SetNull)

  createdById String?
  createdBy   User?    @relation(fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  agents   Agent[]
  versions FlowVersion[] @relation("FlowVersions")
  runs     Run[]
}

/// Imutável após criado. Nenhum caminho da aplicação faz update ou delete aqui (RQ-VER-02).
model FlowVersion {
  id      String @id @default(cuid())
  flowId  String
  flow    Flow   @relation("FlowVersions", fields: [flowId], references: [id], onDelete: Cascade)
  version Int

  /// Snapshot completo do grafo. Formato em 002-versionamento-fluxos.md. Sem segredos.
  snapshot    String
  /// SHA-256 do snapshot canonicalizado — base da idempotência (RQ-VER-04).
  contentHash String
  message     String @default("")
  /// Etiqueta única dentro do fluxo (ex.: "producao"). Ver RQ-VER-12.
  tag         String?

  createdById String?
  createdBy   User?    @relation(fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())

  runs        Run[]
  currentOf   Flow?    @relation("CurrentVersion")

  @@unique([flowId, version])
  @@unique([flowId, tag])
  @@index([flowId, createdAt])
}
```

## 5. Execuções — [M]

Mudanças: fila (design 004), vínculo com versão (design 002), autoria e custo.

```prisma
model Run {
  id      String @id @default(cuid())
  agentId String
  agent   Agent  @relation(fields: [agentId], references: [id], onDelete: Cascade)

  flowId         String?
  flow           Flow?        @relation(fields: [flowId], references: [id], onDelete: SetNull)
  flowVersionId  String?
  flowVersion    FlowVersion? @relation(fields: [flowVersionId], references: [id], onDelete: SetNull)
  /// "version" (fixada) | "draft" (efêmera). Ver RQ-VER-06.
  sourceKind     String       @default("draft")
  /// Snapshot usado quando sourceKind = "draft".
  draftSnapshot  String?
  /// Configuração externa divergiu do snapshot no momento da execução (RQ-VER-10).
  configDrift    Boolean      @default(false)
  driftDetail    String?
  /// Canal de origem da execução (RQ-OAI-11, design 010): "ui" | "api" | "openai".
  /// Aditivo — runs anteriores à Fase 10 ficam "ui" pelo valor padrão da coluna.
  source         String       @default("ui")

  triggeredById String?
  triggeredBy   User?   @relation(fields: [triggeredById], references: [id], onDelete: SetNull)

  input  String
  output String?
  /// "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out"
  status String @default("queued")
  error     String?
  /// Taxonomia do design 003.
  errorType String?

  inputTokens  Int   @default(0)
  outputTokens Int   @default(0)
  costUsd      Float?

  // --- fila (design 004)
  attempt           Int       @default(0)
  maxAttempts       Int       @default(1)
  priority          Int       @default(0)
  idempotencyKey    String?   @unique
  lockedBy          String?
  lockedAt          DateTime?
  heartbeatAt       DateTime?
  cancelRequestedAt DateTime?
  timeoutMs         Int       @default(600000)
  nextAttemptAt     DateTime?

  queuedAt  DateTime  @default(now())
  startedAt DateTime?
  endedAt   DateTime?

  spans Span[]
  logs  LogEntry[]

  @@index([status, priority, queuedAt])
  @@index([flowId, startedAt])
  @@index([agentId, startedAt])
}
```

> `startedAt` deixa de ser `@default(now())` e passa a ser preenchido quando o worker
> assume a execução. A migração copia o valor atual (RQ-NFR-01).

## 6. Telemetria — [N] / `RunStep` [R]

```prisma
model Span {
  id     String @id @default(cuid())
  runId  String
  run    Run    @relation(fields: [runId], references: [id], onDelete: Cascade)

  /// Identificadores de tracing (hex). traceId = um por run.
  traceId      String
  spanId       String  @unique
  parentSpanId String?

  /// "agent" | "model" | "tool" | "delegate" | "mcp.connect" | "queue.wait"
  kind String
  name String

  agentId String?
  agent   Agent?  @relation(fields: [agentId], references: [id], onDelete: SetNull)

  /// "running" | "ok" | "error" | "cancelled"
  status       String @default("running")
  errorType    String?
  errorMessage String?

  /// Atributos gen_ai.* e específicos do domínio, JSON. Segredos mascarados (RQ-SEC-08).
  attributes String @default("{}")

  inputTokens  Int    @default(0)
  outputTokens Int    @default(0)
  costUsd      Float?

  /// Ordem de emissão dentro da run; substitui RunStep.index e resolve empates de timestamp.
  seq        Int
  depth      Int      @default(0)
  attempt    Int      @default(1)
  startedAt  DateTime @default(now())
  endedAt    DateTime?
  durationMs Int?

  logs LogEntry[]

  @@index([runId, seq])
  @@index([traceId])
  @@index([parentSpanId])
  @@index([status, errorType])
}

model LogEntry {
  id     String  @id @default(cuid())
  runId  String
  run    Run     @relation(fields: [runId], references: [id], onDelete: Cascade)
  spanId String?
  span   Span?   @relation(fields: [spanId], references: [spanId], onDelete: SetNull)

  /// "debug" | "info" | "warn" | "error"
  level     String
  message   String
  errorType String?
  /// Contexto estruturado (args da tool, status HTTP, corpo truncado). Mascarado.
  payload   String @default("{}")

  /// Monotônico por run — cursor do SSE e do Last-Event-ID (RQ-ASY-04).
  seq       Int
  createdAt DateTime @default(now())

  @@index([runId, seq])
  @@index([runId, level])
}
```

`RunStep` é removido. A migração converte cada linha em um `Span`
(`index → seq`, `depth → depth`, `type → kind`, `durationMs`), preservando o histórico.

## 7. Configuração — [N]

```prisma
/// Chave-valor para ajustes editáveis pela UI (retenção, concorrência, preços).
model Setting {
  key       String   @id
  value     String
  updatedById String?
  updatedAt DateTime @updatedAt
}

/// Preço por milhão de tokens, por modelo — base do custo estimado (RQ-OBS-06).
model ModelPrice {
  id           String @id @default(cuid())
  providerKind String
  model        String
  inputPerMTok  Float
  outputPerMTok Float
  currency     String @default("USD")
  updatedAt    DateTime @updatedAt

  @@unique([providerKind, model])
}
```

---

## Notas de implementação

- **WAL obrigatório.** Executar `PRAGMA journal_mode=WAL` e `PRAGMA busy_timeout=5000`
  na inicialização do Prisma Client — sem isso, gravação de spans concorrente com a
  fila gera `SQLITE_BUSY` (RQ-NFR-03).
- **Escrita de telemetria em lote.** Spans e logs passam por um buffer com `flush` por
  tempo (250 ms) ou tamanho (50 registros); ver design 003.
- **`prisma migrate` substitui `db push`.** Os scripts `dev`/`build` passam a rodar
  `prisma migrate deploy` (T2).
- **Ordem das migrações:** (1) tabelas de identidade, (2) colunas cifradas + migração de
  dados dos segredos, (3) `Span`/`LogEntry` + conversão de `RunStep`, (4) colunas de fila
  em `Run`, (5) `Flow`/`FlowVersion`, (6) `Setting`/`ModelPrice`. Cada passo é uma
  migração própria, aplicável isoladamente.
