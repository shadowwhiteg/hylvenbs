# Feature: Listing Editor

## Objective

Editar todos os campos do anúncio antes da publicação no Mercado Livre.

## Editable fields

| Field | Storage |
|-------|---------|
| Tipo de anúncio (`listingTypeId`) | ListingDraft |
| Forma de entrega (`shippingMode`, `shippingJson`) | ListingDraft |
| Preço (`price`) | ListingDraft |
| Fotos (`pictures` JSON) | ListingDraft |
| Título (`title`) | ListingDraft |
| Características (`attributes` JSON) | ListingDraft |
| Variações + fotos (`variations` JSON) | ListingDraft |
| Informação regulatória (`regulatory` JSON) | ListingDraft |
| Formato de venda (`buyingMode`) | ListingDraft |
| Garantia tempo/tipo (`warrantyTime`, `warrantyType`) | ListingDraft |
| Descrição (`description`) | ListingDraft |
| Condição (`condition`) | ListingDraft |
| Categoria (`categoryId`) | ListingDraft |

Cada campo editável tem flag `userEdited<field>` (ou mapa `userEditedJson`) para o sync.

## Requirements

1. `GET/PATCH /api/products/[id]` carrega/atualiza Product + ListingDraft.
2. PATCH marca flags `userEdited` nos campos alterados.
3. Defaults ao criar draft a partir do Product: title, description, pictures, price sugerido, condition `new`, buyingMode `buy_it_now`.
4. Validação mínima: title ≤ 60 chars, price > 0, ≥1 foto para publicar.

## Acceptance criteria

- [ ] Todos os campos da tabela são editáveis na UI
- [ ] Salvar persiste e recarrega valores
- [ ] Sync posterior não sobrescreve campos editados

## Errors

- ID inexistente → 404
- Payload inválido → 400 com campos
