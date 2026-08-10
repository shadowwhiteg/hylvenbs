# ML Drop Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard Next.js que sincroniza produtos do Meu Drop Brasil e publica anúncios/kits no Mercado Livre.

**Architecture:** Monólito Next.js App Router + Prisma/SQLite; cron in-process; fila de publicação em DB.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma, SQLite, Playwright (scrape), Vitest.

## Global Constraints

- Hubla fora do escopo
- Secrets apenas em `.env`
- Specs em `docs/superpowers/specs/` são fonte da verdade
- Respostas de API em JSON; UI em português

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `prisma/schema.prisma`, `.env.example`, `app/layout.tsx`, `app/page.tsx`, `lib/db.ts`

- [ ] Init Next.js + deps (prisma, playwright, vitest, zod)
- [ ] Schema Prisma completo (Product, ListingDraft, Kit, KitItem, PublishJob, PublishJobItem, MlToken, SyncRun, AppSettings)
- [ ] `prisma migrate` / `db push`
- [ ] `.env.example` com todas as vars do design

### Task 2: Pricing + sync merge (TDD)

**Files:**
- Create: `lib/pricing/simulator.ts`, `lib/sync/merge.ts`, `tests/pricing.test.ts`, `tests/merge.test.ts`

- [ ] Testes do simulador (sugestão + override + erro margem)
- [ ] Testes de merge userEdited
- [ ] Implementação mínima

### Task 3: ML auth + client

**Files:**
- Create: `lib/ml/auth.ts`, `lib/ml/client.ts`, `lib/ml/payload.ts`, `app/api/auth/ml/route.ts`, `app/api/auth/ml/callback/route.ts`, `app/api/auth/ml/status/route.ts`

- [ ] Authorize URL + token exchange + refresh
- [ ] Payload builder para `/items`
- [ ] Status endpoint

### Task 4: Catalog sync

**Files:**
- Create: `lib/scrape/meudrop.ts`, `lib/sync/run.ts`, `lib/cron.ts`, `app/api/sync/route.ts`, `app/api/products/route.ts`

- [ ] Login + parse (Playwright)
- [ ] Upsert + SyncRun
- [ ] Cron 60 min no instrumentation/boot
- [ ] GET products

### Task 5: Listing editor + simulator API

**Files:**
- Create: `app/api/products/[id]/route.ts`, `app/api/simulator/route.ts`, `app/(dashboard)/products/[id]/page.tsx`

- [ ] GET/PATCH product+draft
- [ ] Simulator endpoint
- [ ] Editor UI com todos os campos

### Task 6: Bulk publish

**Files:**
- Create: `lib/publish/worker.ts`, `app/api/publish/route.ts`, `app/(dashboard)/publish/page.tsx`

- [ ] Create job + process items
- [ ] Rate-limit + retry 429
- [ ] UI seleção + página jobs

### Task 7: Kits

**Files:**
- Create: `app/api/kits/route.ts`, `app/api/kits/[id]/route.ts`, `app/(dashboard)/kits/page.tsx`, `app/(dashboard)/kits/[id]/page.tsx`

- [ ] CRUD kits (≥2 products)
- [ ] Publish via kitId
- [ ] UI

### Task 8: Dashboard shell + tests

**Files:**
- Create: `app/(dashboard)/layout.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/settings/page.tsx`, `tests/payload.test.ts`, `tests/publish-smoke.test.ts`

- [ ] Nav + catálogo com multi-select
- [ ] Settings OAuth + margem
- [ ] Testes payload + smoke worker mockado
- [ ] `npm test` passa
