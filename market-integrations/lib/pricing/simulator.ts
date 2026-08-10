export type SimulatorInput = {
  costPrice: number;
  listingTypeId: string;
  shippingCost?: number;
  marginPercent?: number;
  manualPrice?: number;
};

export type SimulatorBreakdown = {
  cost: number;
  fee: number;
  shipping: number;
  margin: number;
  finalPrice: number;
};

export type SimulatorOutput = {
  suggestedPrice: number;
  estimatedFee: number;
  estimatedProfit: number;
  breakdown: SimulatorBreakdown;
  feeRate: number;
};

const FEE_TABLE: Record<string, number> = {
  gold_special: 0.11,
  gold_pro: 0.16,
  gold: 0.13,
  free: 0.13,
};

export function feeRateForListingType(listingTypeId: string): number {
  return FEE_TABLE[listingTypeId] ?? 0.12;
}

export function simulateCosts(input: SimulatorInput): SimulatorOutput {
  const costPrice = Number(input.costPrice);
  const shipping = Number(input.shippingCost ?? 0);
  const marginPercent = Number(input.marginPercent ?? 30);
  const feeRate = feeRateForListingType(input.listingTypeId);

  if (!(costPrice > 0)) {
    throw new Error("costPrice must be greater than 0");
  }
  if (shipping < 0) {
    throw new Error("shippingCost must be >= 0");
  }
  if (marginPercent < 0) {
    throw new Error("marginPercent must be >= 0");
  }

  const marginRate = marginPercent / 100;
  if (feeRate + marginRate >= 1) {
    throw new Error("margin + feeRate must be less than 100%");
  }

  const base = costPrice + shipping;
  const suggestedPrice = round2(base / (1 - feeRate - marginRate));

  const finalPrice =
    input.manualPrice !== undefined && input.manualPrice !== null
      ? Number(input.manualPrice)
      : suggestedPrice;

  if (!(finalPrice > 0)) {
    throw new Error("price must be greater than 0");
  }

  const estimatedFee = round2(finalPrice * feeRate);
  const estimatedProfit = round2(finalPrice - costPrice - shipping - estimatedFee);

  return {
    suggestedPrice,
    estimatedFee,
    estimatedProfit,
    feeRate,
    breakdown: {
      cost: round2(costPrice),
      fee: estimatedFee,
      shipping: round2(shipping),
      margin: round2(estimatedProfit),
      finalPrice: round2(finalPrice),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
