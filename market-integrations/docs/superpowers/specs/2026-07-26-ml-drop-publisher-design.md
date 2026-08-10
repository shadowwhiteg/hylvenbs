# ML Drop Publisher — Design

**Date:** 2026-07-26  
**Status:** Approved  
**Stack:** Next.js (App Router) + Prisma + SQLite

## Goal

Automatizar o catálogo de produtos do Meu Drop Brasil (scrape autenticado a cada 60 minutos), permitir edição completa do anúncio na dashboard (incluindo kits e simulador de custos) e publicar em massa na API do Mercado Livre.

## Out of scope

- Integração Hubla (webhooks outbound only; sem API pública para criar produtos)
- Multi-usuário / roles
- Sync de vendas ML de volta para a dashboard

## Architecture

```
MeuDropBrasil --scrape/auth/60min--> CatalogSyncJob --> SQLite
Dashboard <--> SQLite
Dashboard --bulk publish--> PublishJob queue --> Mercado Livre API
ML OAuth --> MlToken (SQLite)
```

### Modules

| Module | Responsibility |
|--------|----------------|
| `lib/scrape` | Login + parse list/detail pages |
| `lib/sync` | Upsert products; respect `userEdited` flags |
| `lib/ml` | OAuth, HTTP client, payload builder, listing fees |
| `lib/pricing` | Cost simulator (margin + fees + override) |
| `lib/publish` | Sequential queue worker with rate-limit |
| Dashboard | Catalog, editor, kits, publish status, settings |

## Data model

- **Product** — source catalog item (`externalId`, `sourceUrl`, `costPrice`, `status`, `mlItemId`)
- **ListingDraft** — editable ML fields + `userEdited*` flags
- **Kit / KitItem** — composition of 2+ products + own draft
- **PublishJob / PublishJobItem** — batch queue and per-item results
- **MlToken** — OAuth access/refresh
- **SyncRun** — scrape run history
- **AppSettings** — default margin %

### Product status

`synced` → `draft_ready` → `queued` → `published` | `error`  
Missing from source site → `unavailable` (drafts kept).

## Screens

1. **Catálogo** — grid, multi-select, filters, sync now, publish / create kit / edit
2. **Editor** — listing type, shipping, price+simulator, photos, title, attributes, variations, regulatory, buying mode, warranty, description, condition
3. **Kits** — compose N products → edit composite listing → publish one item
4. **Publicações** — job queue and errors
5. **Config** — ML OAuth connect + default margin

## Error handling

- Scrape login/HTML failure → `SyncRun` error; previous catalog kept
- Publish API error → mark item failed; continue batch
- Sync vs user edits → never overwrite fields marked `userEdited`

## Environment

`DATABASE_URL`, `ML_APP_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `DROP_SITE_URL`, `DROP_EMAIL`, `DROP_PASSWORD`, `DEFAULT_MARGIN_PERCENT`, `CRON_SYNC_MINUTES=60`

## Feature specs

See `docs/superpowers/specs/features/01`–`06`.
