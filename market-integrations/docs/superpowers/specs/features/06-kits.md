# Feature: Kits

## Objective

Unir dois ou mais produtos em um kit publicável como um único anúncio no Mercado Livre.

## Requirements

1. Seleção de ≥2 produtos → `POST /api/kits` cria Kit + KitItems + ListingDraft.
2. Defaults do kit:
   - title: `"Kit: " + títulos unidos` (truncado 60)
   - costPrice: soma dos custos
   - pictures: merge das fotos (até 10)
   - description: concatenações das descrições
3. Kit tem o mesmo editor de listing que Product.
4. Publicação via mesmo fluxo de `PublishJob` com `kitId`.
5. UI: criar kit a partir da seleção; listar/editar kits.

## Internal API

- `POST /api/kits` `{ productIds: string[] }` (≥2)
- `GET /api/kits` / `GET /api/kits/[id]`
- `PATCH /api/kits/[id]` (draft)
- `DELETE /api/kits/[id]`

## Acceptance criteria

- [ ] Menos de 2 produtos → 400
- [ ] Kit aparece na lista com custo somado
- [ ] Publicar kit cria 1 item no ML
- [ ] Editar título do kit não altera products-fonte

## Errors

- productId inválido → 400
- Kit já publicado: republicação cria novo item ou erro configurável (MVP: erro se `mlItemId` existir)
