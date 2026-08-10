# ML Drop Publisher — Evolução (Design)

**Data:** 2026-07-31  
**Status:** Aprovado  
**Abordagem:** A — evoluir monolito Next.js existente

## Objetivo

Completar o pipeline Meu Drop → catálogo → anúncios ML com:

1. Scrape enriquecido (estoque, vídeo, atributos)
2. Sync contínuo de estoque/preço no Mercado Livre com política configurável
3. Markup individual e em massa
4. Agente Ollama (chat na Web UI) + MCP stdio para Cursor
5. Polish da UI e documentação

## Decisões travadas

| Decisão | Valor |
|---------|--------|
| Base | Evoluir app atual (não greenfield) |
| LLM | Somente Ollama (local) |
| Superfície do agente | Chat na Web UI **e** MCP stdio |
| `autoSyncMode` default | `always` |
| Modos disponíveis | `always` \| `stock_only` \| `respect_user_edits` \| `manual` |
| `autoPauseWhenUnavailable` | default `true` |

## Arquitetura

```
Cron CatalogSync → Playwright MeuDrop → merge + drafts
                                      → autoSyncMode policy
                                      → MlListingSync PUT price/qty
Web UI / Agent Chat / MCP ──→ lib/agent/tools ──→ scrape, sync, publish, ml, pricing
```

- Reutilizar `lib/scrape`, `lib/sync`, `lib/ml`, `lib/pricing`, components existentes
- Tools compartilhadas entre chat UI e MCP (`lib/agent/tools.ts`)
- Persistência: Prisma + SQLite

## Modelo de dados (deltas)

### Product
- `stock Int?`
- `videoUrl String?`
- `attributesJson String @default("[]")`
- `extraInfoJson String @default("{}")`

### ListingDraft
- `videoUrl String?`
- `marginPercentOverride Float?`

### AppSettings
- `autoSyncMode String @default("always")`
- `autoPauseWhenUnavailable Boolean @default(true)`
- `ollamaBaseUrl String @default("http://127.0.0.1:11434")`
- `ollamaModel String @default("llama3.2")`

### MlSyncRun (novo)
- Contadores: `updatedCount`, `skippedCount`, `errorCount`
- `status`, `startedAt`, `finishedAt`, `error`

## Política de auto-sync

| Modo | PUT qty | PUT price | Observação |
|------|---------|-----------|------------|
| `always` | sim | sim (recalculado) | Default |
| `stock_only` | sim | não | |
| `respect_user_edits` | sim | só se preço **não** foi editado pelo usuário | |
| `manual` | não | não | Sync ML só sob demanda explícita |

Indisponível (`status=unavailable` ou stock 0): `available_quantity=0`; se `autoPauseWhenUnavailable`, pausar anúncio no ML.

## Scrape enriquecido

No loop de detalhe do Meu Drop extrair:

- Estoque (`stock` / in-stock indicators)
- Vídeo (`video`, `iframe`, URLs YouTube/Vimeo)
- Tabela de atributos
- Descrição longa

Merge respeita `userEditedJson` (não sobrescreve campos marcados).

## Markup

- Override por draft: `marginPercentOverride`
- Catálogo: ação em massa “aplicar margem %” → recalcula via simulador → opcional push ML

## Agente

Tools: sync catálogo, listar produtos, aplicar margem, publicar, push ML, settings, status.

- UI: `/agent` com streaming via Ollama
- MCP: `npm run mcp` (stdio) para Cursor

## Fora de escopo

Hubla, multi-usuário, APIs LLM externas, sync de vendas ML → dashboard.
