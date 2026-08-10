export type GtinPolicy = {
  gtinConditionallyRequired: boolean;
  allowsEmptyGtinReason: boolean;
};

type CategoryAttribute = {
  id: string;
  tags?: Record<string, boolean>;
};

const cache = new Map<string, { policy: GtinPolicy; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export function parseGtinPolicy(attributes: CategoryAttribute[]): GtinPolicy {
  const gtin = attributes.find((a) => a.id === "GTIN");
  const emptyReason = attributes.find((a) => a.id === "EMPTY_GTIN_REASON");
  return {
    gtinConditionallyRequired: Boolean(gtin?.tags?.conditional_required),
    allowsEmptyGtinReason: Boolean(emptyReason),
  };
}

export async function getCategoryGtinPolicy(
  categoryId: string,
  fetchImpl: typeof fetch = fetch
): Promise<GtinPolicy> {
  const key = categoryId.trim();
  if (!key) {
    return { gtinConditionallyRequired: false, allowsEmptyGtinReason: false };
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.policy;
  }

  try {
    const res = await fetchImpl(
      `https://api.mercadolibre.com/categories/${encodeURIComponent(key)}/attributes`
    );
    if (!res.ok) {
      return { gtinConditionallyRequired: false, allowsEmptyGtinReason: false };
    }
    const data = (await res.json()) as CategoryAttribute[];
    const policy = parseGtinPolicy(Array.isArray(data) ? data : []);
    cache.set(key, { policy, expiresAt: Date.now() + CACHE_TTL_MS });
    return policy;
  } catch {
    return { gtinConditionallyRequired: false, allowsEmptyGtinReason: false };
  }
}

/** Limpa cache (útil em testes). */
export function clearCategoryGtinPolicyCache(): void {
  cache.clear();
}
