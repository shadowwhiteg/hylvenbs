# Plano — Evolução ML Drop Publisher (2026-07-31)

## Fase 1 — Schema e políticas
- [x] Estender Prisma (Product, ListingDraft, AppSettings, MlSyncRun)
- [x] Helpers `getAppSettings` / defaults
- [x] Matriz de política + testes unitários
- [x] `prisma db push` / generate

## Fase 2 — Scrape enriquecido
- [x] Extrair stock, video, attributes no detail loop
- [x] Atualizar `ScrapedProduct` + merge
- [x] Fixture HTML + testes de parser

## Fase 3 — Sync ML
- [x] `updateItem` / pause no client ML
- [x] `runMlListingSync` com rate-limit e backoff 429
- [x] Registrar `MlSyncRun`; hook em `runCatalogSync` + API
- [x] Testes com fetch mock

## Fase 4 — Markup e Settings UI
- [x] `marginPercentOverride` no editor
- [x] Bulk margem no catálogo
- [x] Settings: autoSyncMode, pause, Ollama

## Fase 5 — Agente + MCP
- [x] `lib/agent/tools`, ollama, runner
- [x] Chat UI + API
- [x] MCP stdio + script `npm run mcp`
- [x] Testes de tools

## Fase 6 — Polish + verificação
- [x] Nav Agente; painel MlSyncRun; empty states
- [x] README (Ollama, MCP, modos)
- [x] `npm test`
