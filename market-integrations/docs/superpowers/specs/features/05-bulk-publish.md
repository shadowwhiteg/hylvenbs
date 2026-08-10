# Feature: Bulk Publish

## Objective

Selecionar produtos/kits em massa e publicá-los na API do Mercado Livre com fila e feedback por item.

## Requirements

1. `POST /api/publish` body `{ productIds?: string[], kitIds?: string[] }` cria `PublishJob` + items.
2. Worker sequencial processa items (delay entre requests para rate-limit).
3. Por item: validar draft → `POST /items` → `POST /items/{id}/description` → salvar `mlItemId`, permalink, status `published`.
4. Erro por item não aborta o lote.
5. UI: checkboxes no catálogo + botão Publicar; página Publicações mostra jobs.

## Payload mapping (MVP)

```
title, category_id, price, currency_id=BRL, available_quantity,
buying_mode, condition, listing_type_id, pictures[{source}],
attributes, sale_terms (warranty), shipping, variations
```

Description enviada em chamada separada.

## Acceptance criteria

- [ ] Selecionar 2+ produtos cria um job com N items
- [ ] Sucesso grava `mlItemId` no Product/Kit
- [ ] Falha de um item deixa os outros processarem
- [ ] Sem OAuth → 401/400 claro

## Errors

- Draft incompleto → item `error` com mensagem
- 429 → retry com backoff (até 3x)
- Token inválido → job `error`
