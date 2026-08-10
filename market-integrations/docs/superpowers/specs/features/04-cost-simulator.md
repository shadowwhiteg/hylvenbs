# Feature: Cost Simulator

## Objective

Sugerir preço de venda com margem configurável e permitir override manual com breakdown ao vivo.

## Inputs

- `costPrice` (do Product ou soma do Kit)
- `listingTypeId`
- `shippingCost` (opcional)
- `marginPercent` (default de AppSettings / `DEFAULT_MARGIN_PERCENT`)
- `manualPrice` (opcional override)

## Outputs

- `suggestedPrice`
- `estimatedFee`
- `estimatedProfit`
- `breakdown`: cost, fee, shipping, margin, finalPrice

## Formula (MVP)

1. Obter taxa estimada via API ML listing prices/fees quando possível; senão fallback tabela (`gold_special` ~11%, `gold_pro` ~16%, default 12%).
2. `suggestedPrice = (costPrice + shippingCost) / (1 - feeRate - marginPercent/100)` arredondado 2 casas.
3. Com override: `estimatedFee = manualPrice * feeRate`; `estimatedProfit = manualPrice - cost - shipping - fee`.

## Internal API

- `POST /api/simulator` body `{ costPrice, listingTypeId, shippingCost?, marginPercent?, manualPrice? }` → outputs

## Acceptance criteria

- [ ] Sem manualPrice retorna suggestedPrice > costPrice
- [ ] Com manualPrice recalcula lucro/taxa
- [ ] Editor de preço usa o simulador ao vivo

## Errors

- costPrice ≤ 0 → 400
- margin + feeRate ≥ 1 → 400 (margem impossível)
