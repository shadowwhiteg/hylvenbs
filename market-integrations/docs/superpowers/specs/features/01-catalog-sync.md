# Feature: Catalog Sync

## Objective

Sincronizar produtos do Meu Drop Brasil (login de aluno) para o SQLite a cada 60 minutos e sob demanda.

## Requirements

1. Autenticar com `DROP_EMAIL` / `DROP_PASSWORD` em `DROP_SITE_URL`.
2. Extrair lista de produtos e detalhe (título, preço/custo, fotos, descrição, URL).
3. Upsert por `externalId` ou `sourceUrl`.
4. Cron a cada `CRON_SYNC_MINUTES` (default 60) + endpoint manual `POST /api/sync`.
5. Campos com flag `userEdited*` no `ListingDraft` **não** são sobrescritos.
6. Produtos ausentes na fonte → status `unavailable`.
7. Registrar cada execução em `SyncRun` (startedAt, finishedAt, status, counts, error).

## Internal API

- `POST /api/sync` → `{ runId, status }`
- `GET /api/sync` → último `SyncRun` + `nextRunAt`
- `GET /api/products` → lista paginada/filtrável

## Acceptance criteria

- [ ] Sync manual cria `SyncRun` com status `success` ou `error`
- [ ] Produto novo aparece no catálogo após sync
- [ ] Re-sync não apaga título editado pelo usuário
- [ ] Produto removido do site fica `unavailable`
- [ ] Cron dispara no intervalo configurado quando o server está up

## Errors

- Login falhou → `SyncRun.error`, catálogo anterior intacto
- Parse parcial → itens válidos salvos; erro registrado no run
