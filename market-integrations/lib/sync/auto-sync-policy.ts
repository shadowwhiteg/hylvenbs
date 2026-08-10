export const AUTO_SYNC_MODES = [
  "always",
  "stock_only",
  "respect_user_edits",
  "manual",
] as const;

export type AutoSyncMode = (typeof AUTO_SYNC_MODES)[number];

export function isAutoSyncMode(value: string): value is AutoSyncMode {
  return (AUTO_SYNC_MODES as readonly string[]).includes(value);
}

export type ListingSyncDecision = {
  /** Whether any ML PUT should happen for this listing. */
  shouldPush: boolean;
  updatePrice: boolean;
  updateQuantity: boolean;
  /** Force qty 0 and optionally pause when product is unavailable. */
  treatAsUnavailable: boolean;
  pauseListing: boolean;
};

export type DecideListingSyncInput = {
  mode: AutoSyncMode;
  autoPauseWhenUnavailable: boolean;
  hasMlItemId: boolean;
  productStatus: string;
  priceUserEdited: boolean;
  stock: number | null | undefined;
};

/**
 * Pure policy matrix for ML listing sync after catalog scrape.
 */
export function decideListingSync(input: DecideListingSyncInput): ListingSyncDecision {
  const unavailable =
    input.productStatus === "unavailable" ||
    (input.stock !== null && input.stock !== undefined && input.stock <= 0);

  if (!input.hasMlItemId || input.mode === "manual") {
    return {
      shouldPush: false,
      updatePrice: false,
      updateQuantity: false,
      treatAsUnavailable: unavailable,
      pauseListing: false,
    };
  }

  const pauseListing = unavailable && input.autoPauseWhenUnavailable;

  if (input.mode === "always") {
    return {
      shouldPush: true,
      updatePrice: !unavailable,
      updateQuantity: true,
      treatAsUnavailable: unavailable,
      pauseListing,
    };
  }

  if (input.mode === "stock_only") {
    return {
      shouldPush: true,
      updatePrice: false,
      updateQuantity: true,
      treatAsUnavailable: unavailable,
      pauseListing,
    };
  }

  // respect_user_edits
  return {
    shouldPush: true,
    updatePrice: !unavailable && !input.priceUserEdited,
    updateQuantity: true,
    treatAsUnavailable: unavailable,
    pauseListing,
  };
}

export type PriceRecalcDecision = {
  recalculate: boolean;
};

/** Whether draft price should be recalculated from cost + margin before push. */
export function shouldRecalculatePrice(input: {
  mode: AutoSyncMode;
  priceUserEdited: boolean;
  treatAsUnavailable: boolean;
}): PriceRecalcDecision {
  if (input.treatAsUnavailable) return { recalculate: false };
  if (input.mode === "always") return { recalculate: true };
  if (input.mode === "respect_user_edits" && !input.priceUserEdited) {
    return { recalculate: true };
  }
  return { recalculate: false };
}
