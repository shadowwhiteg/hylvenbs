import { prisma } from "@/lib/db";
import { runCatalogSync } from "@/lib/sync/run";
import { runMlListingSync } from "@/lib/ml/listing-sync";
import { getAppSettings, updateAppSettings } from "@/lib/settings";
import { AI_PROVIDER_IDS, isAiProviderId } from "@/lib/agent/providers";
import { simulateCosts } from "@/lib/pricing/simulator";
import { markUserEdited, parseUserEdited } from "@/lib/sync/merge";
import { isAutoSyncMode, type AutoSyncMode } from "@/lib/sync/auto-sync-policy";
import { getAuthStatus } from "@/lib/ml/auth";
import { resolveListingDefaults } from "@/lib/ml/payload";
import { extractProductIdentifiers, findCatalogMatch } from "@/lib/ml/catalog";
import {
  ensureBrandAttribute,
  fillAttributesWithAi,
  mergeAttributes,
  parseAttributeList,
  toScrapedAttributes,
} from "@/lib/agent/attributes";
import { categorizeProduct } from "@/lib/ml/categorize-product";
import { createKitFromProducts } from "@/lib/kits/create";
import {
  applyBulkDiscount,
  applyBulkPrice,
  applyPromotion,
  cancelPromotion,
  listItemPromotions,
} from "@/lib/ml/promotions-sync";
import { applyBulkReview } from "@/lib/ml/listing-review";
import { syncListingStockFromCatalog } from "@/lib/ml/stock-sync";
import { matchAvulsoListingsToCatalog } from "@/lib/ml-listings/catalog-match";
import {
  SHOPEE_AGENT_TOOLS,
  executeShopeeAgentTool,
  type ShopeeAgentToolName,
} from "@/lib/agent/shopee-tools";

export type AgentToolName =
  | "sync_catalog"
  | "sync_ml_listings"
  | "list_products"
  | "apply_margin"
  | "get_settings"
  | "update_settings"
  | "get_status"
  | "queue_publish"
  | "fill_attributes_ai"
  | "match_ml_catalog"
  | "apply_listing_defaults"
  | "categorize_products"
  | "list_ml_listings"
  | "create_kit_from_ml_listings"
  | "set_ml_price"
  | "manage_ml_promotion"
  | "apply_bulk_discount"
  | "suggest_ml_kits"
  | "create_kit_from_ml_listing_ids"
  | "review_ml_listings_from_catalog"
  | "sync_ml_stock_from_catalog"
  | "match_avulso_ml_listings_to_catalog"
  | ShopeeAgentToolName;

export type AgentToolDef = {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const AGENT_TOOLS: AgentToolDef[] = [
  ...SHOPEE_AGENT_TOOLS,
  {
    name: "sync_catalog",
    description: "Sincroniza o catálogo do Meu Drop (scrape + merge). Por padrão também dispara sync ML.",
    inputSchema: {
      type: "object",
      properties: {
        skipMlSync: { type: "boolean", description: "Se true, não faz PUT no ML após o sync" },
      },
    },
  },
  {
    name: "sync_ml_listings",
    description: "Atualiza preço/estoque dos anúncios publicados no Mercado Livre conforme a política.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_products",
    description: "Lista produtos do catálogo com filtros opcionais.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        q: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "apply_margin",
    description: "Aplica margem % em um ou mais produtos e recalcula o preço do draft.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
        marginPercent: { type: "number" },
        pushToMl: { type: "boolean" },
      },
      required: ["productIds", "marginPercent"],
    },
  },
  {
    name: "get_settings",
    description: "Retorna configurações do app (margem, autoSyncMode, Ollama).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_settings",
    description:
      "Atualiza configurações (autoSyncMode, margem, provedor de IA — Ollama/OpenAI/OpenRouter/Google AI Studio/OpenAI-compatible/Cursor/Claude Code —, pause).",
    inputSchema: {
      type: "object",
      properties: {
        marginPercent: { type: "number" },
        autoSyncMode: {
          type: "string",
          enum: ["always", "stock_only", "respect_user_edits", "manual"],
        },
        autoPauseWhenUnavailable: { type: "boolean" },
        ollamaBaseUrl: { type: "string" },
        ollamaModel: { type: "string" },
        aiProvider: {
          type: "string",
          enum: [...AI_PROVIDER_IDS],
        },
        aiApiKey: { type: "string" },
        aiBaseUrl: { type: "string" },
        aiModel: { type: "string" },
        aiCliCommand: { type: "string" },
        aiCliArgs: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "get_status",
    description: "Status geral: OAuth ML, último catalog sync e último ML sync.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "queue_publish",
    description: "Enfileira publicação no ML para os productIds informados.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
      },
      required: ["productIds"],
    },
  },
  {
    name: "fill_attributes_ai",
    description:
      "Preenche/normaliza as características (atributos) dos produtos usando IA local (Ollama).",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
        apply: {
          type: "boolean",
          description: "Se false, apenas sugere sem salvar no rascunho (padrão true)",
        },
      },
      required: ["productIds"],
    },
  },
  {
    name: "match_ml_catalog",
    description:
      "Procura o produto no catálogo do Mercado Livre (por EAN/GTIN, marca, modelo e título) e vincula o catalog_product_id ao rascunho quando o match é confiável.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
        autoApply: {
          type: "boolean",
          description: "Se false, só grava as sugestões sem vincular (padrão true)",
        },
      },
      required: ["productIds"],
    },
  },
  {
    name: "apply_listing_defaults",
    description:
      "Aplica nos rascunhos os padrões de anúncio das configurações (tipo Premium, frete grátis, ME2, retirada não oferecida e garantia padrão), sem sobrescrever campos editados manualmente.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
        all: { type: "boolean", description: "Aplica em todos os produtos com rascunho" },
      },
    },
  },
  {
    name: "categorize_products",
    description:
      "Gera o categoryId MLB dos produtos: primeiro usa o preditor oficial da API ML e, se falhar, usa IA com o dump de categorias.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
        apply: {
          type: "boolean",
          description: "Se false, apenas sugere sem salvar no rascunho (padrão true)",
        },
        allowAiFallback: {
          type: "boolean",
          description: "Se false, não usa IA quando o preditor ML falhar (padrão true)",
        },
      },
      required: ["productIds"],
    },
  },
  {
    name: "list_ml_listings",
    description:
      "Lista os anúncios já publicados no Mercado Livre (importados via API), com preço, estoque e status atuais.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Filtro por título ou item id" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_kit_from_ml_listings",
    description:
      "Cria um kit a partir de produtos que JÁ estão publicados no Mercado Livre (precisam ter mlItemId). Recusa se algum produto informado ainda não estiver publicado.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
      },
      required: ["productIds"],
    },
  },
  {
    name: "set_ml_price",
    description:
      "Atualiza o preço de um ou mais anúncios já publicados no ML (mlItemId), direto por PUT. Pode usar preço fixo ou margem % (recalculada a partir do custo do produto local, quando houver).",
    inputSchema: {
      type: "object",
      properties: {
        mlItemIds: { type: "array", items: { type: "string" } },
        price: { type: "number", description: "Preço fixo em BRL" },
        marginPercent: { type: "number", description: "Alternativa ao preço fixo" },
      },
      required: ["mlItemIds"],
    },
  },
  {
    name: "manage_ml_promotion",
    description:
      "Lista, aplica ou cancela promoções oficiais do Mercado Livre num anúncio. Tipo DEAL (oferta pronta do ML) precisa de promotionId e usa o preço fixo do ML. Tipo PRICE_DISCOUNT é o desconto que o próprio vendedor escolhe (não tem promotionId) — informe dealPrice dentro do min_discounted_price/max_discounted_price retornado por action=list.",
    inputSchema: {
      type: "object",
      properties: {
        mlItemId: { type: "string" },
        action: { type: "string", enum: ["list", "apply", "cancel"] },
        promotionId: {
          type: "string",
          description: "Obrigatório para DEAL; omitir para PRICE_DISCOUNT",
        },
        promotionType: { type: "string", enum: ["DEAL", "PRICE_DISCOUNT"] },
        dealPrice: {
          type: "number",
          description: "Preço com desconto — obrigatório ao aplicar PRICE_DISCOUNT",
        },
      },
      required: ["mlItemId", "action"],
    },
  },
  {
    name: "apply_bulk_discount",
    description:
      "Aplica desconto PRICE_DISCOUNT (o vendedor escolhe a %) em massa, numa lista de mlItemIds, todos com a mesma porcentagem. Cada anúncio usa seu próprio original_price e faixa min/max — itens sem PRICE_DISCOUNT disponível ou fora da faixa permitida entram nos erros e são pulados, sem travar os demais.",
    inputSchema: {
      type: "object",
      properties: {
        mlItemIds: { type: "array", items: { type: "string" } },
        percent: { type: "number", description: "Percentual de desconto, entre 0 e 100" },
      },
      required: ["mlItemIds", "percent"],
    },
  },
  {
    name: "suggest_ml_kits",
    description:
      "Analisa os anúncios já publicados no ML e sugere kits (combos) coerentes, com título elaborado, descrição vendedora (escrita com base nas descrições originais do fornecedor no catálogo Meu Drop), justificativa, itens e desconto sugerido. Só sugere — não cria nada. Ao efetivar com create_kit_from_ml_listing_ids, repasse o 'title' e a 'description' exatamente como vieram aqui — não os reescreva nem os omita.",
    inputSchema: {
      type: "object",
      properties: {
        mlItemIds: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: restringe a análise a estes anúncios",
        },
        maxSuggestions: { type: "number" },
      },
    },
  },
  {
    name: "create_kit_from_ml_listing_ids",
    description:
      "Cria um kit a partir de 2+ anúncios já publicados no ML (mlItemIds). Preço = soma dos preços dos anúncios menos o desconto de combo. Sempre preenche as características obrigatórias (ex.: BRAND) com IA automaticamente após criar — não é preciso pedir isso separadamente. Sempre passe 'title' e 'description' elaborados (de preferência os que vieram de suggest_ml_kits) — se omitidos, o kit nasce com um título e uma descrição genéricos, apenas concatenando os nomes dos produtos.",
    inputSchema: {
      type: "object",
      properties: {
        mlItemIds: { type: "array", items: { type: "string" } },
        title: {
          type: "string",
          description:
            "Máximo 60 caracteres. Evite apenas concatenar os nomes dos produtos — destaque o benefício do combo. Gerado automaticamente (genérico) se omitido.",
        },
        description: {
          type: "string",
          description:
            "Texto vendedor do anúncio: 2-4 frases sobre o combo + lista dos itens. Baseie-se nas descrições originais do fornecedor (catálogo Meu Drop) quando disponíveis. Gerado automaticamente (genérico) se omitido.",
        },
        bundleDiscountPercent: { type: "number", description: "Padrão 10" },
        aiRationale: { type: "string", description: "Por que esses itens formam um bom kit" },
      },
      required: ["mlItemIds"],
    },
  },
  {
    name: "review_ml_listings_from_catalog",
    description:
      "Revisa e corrige título, características, SKU e EAN de anúncios já publicados no ML usando o catálogo do Meu Drop como fonte da verdade — o dado do Meu Drop vence conflito, a IA só preenche o que falta. Só funciona em anúncios vinculados a um produto do Meu Drop (mlItemId casado); avulsos são pulados. Categoria não é alterada: o Mercado Livre não permite trocar category_id de um anúncio já publicado via API.",
    inputSchema: {
      type: "object",
      properties: {
        mlItemIds: { type: "array", items: { type: "string" } },
      },
      required: ["mlItemIds"],
    },
  },
  {
    name: "sync_ml_stock_from_catalog",
    description:
      "Atualiza o estoque dos anúncios no ML conforme o estoque atual do Meu Drop. Zerou no Meu Drop, pausa o anúncio automaticamente (nunca reativa sozinho quando o estoque volta). Sem mlItemIds, sincroniza todos os anúncios vinculados a produtos do Meu Drop.",
    inputSchema: {
      type: "object",
      properties: {
        mlItemIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "match_avulso_ml_listings_to_catalog",
    description:
      "Tenta vincular anúncios 'avulsos' do ML (sem produto/kit local) a produtos do catálogo Meu Drop ainda sem mlItemId, por SKU, EAN/GTIN ou similaridade de título. Só grava o vínculo local (Product.mlItemId); nunca cria, edita ou apaga nada no ML. Sem mlItemIds, avalia todos os anúncios avulsos.",
    inputSchema: {
      type: "object",
      properties: {
        mlItemIds: { type: "array", items: { type: "string" } },
      },
    },
  },
];

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export async function applyMarginToProducts(input: {
  productIds: string[];
  marginPercent: number;
  pushToMl?: boolean;
  setOverride?: boolean;
}): Promise<ToolResult> {
  const { productIds, marginPercent, pushToMl, setOverride = true } = input;
  if (!productIds.length) return { ok: false, error: "productIds obrigatório" };
  if (!(marginPercent >= 0 && marginPercent < 100)) {
    return { ok: false, error: "marginPercent inválido" };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { draft: true },
  });

  let updated = 0;
  const errors: string[] = [];

  for (const product of products) {
    if (!product.draft) {
      errors.push(`${product.id}: sem draft`);
      continue;
    }
    if (!(product.costPrice > 0)) {
      errors.push(`${product.id}: custo inválido`);
      continue;
    }
    try {
      const suggested = simulateCosts({
        costPrice: product.costPrice,
        listingTypeId: product.draft.listingTypeId || "gold_special",
        marginPercent,
      }).suggestedPrice;
      const userEditedJson = markUserEdited(product.draft.userEditedJson, ["price"]);
      await prisma.listingDraft.update({
        where: { id: product.draft.id },
        data: {
          price: suggested,
          marginPercentOverride: setOverride
            ? marginPercent
            : product.draft.marginPercentOverride,
          userEditedJson,
        },
      });
      updated += 1;
    } catch (err) {
      errors.push(`${product.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let mlSync = null;
  if (pushToMl) mlSync = await runMlListingSync();

  return { ok: true, data: { updated, errors, mlSync } };
}

export async function fillAttributesForProducts(input: {
  productIds: string[];
  apply?: boolean;
}): Promise<ToolResult> {
  const { productIds, apply = true } = input;
  if (!productIds.length) return { ok: false, error: "productIds obrigatório" };

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { draft: true },
  });

  const results: Array<{
    productId: string;
    attributeCount: number;
    applied: boolean;
    warnings: string[];
  }> = [];
  const errors: string[] = [];
  let model = "";

  for (const product of products) {
    if (!product.draft) {
      errors.push(`${product.id}: sem draft`);
      continue;
    }
    const existing = parseAttributeList(product.draft.attributes);
    const scraped = parseAttributeList(product.attributesJson);
    const generated = await fillAttributesWithAi({
      title: product.draft.title || product.title,
      description: product.draft.description || product.description,
      scrapedAttributes: toScrapedAttributes(scraped.length ? scraped : existing),
      categoryPath: product.categoryPath,
    });
    model = generated.model;

    const attributes = ensureBrandAttribute(mergeAttributes(existing, generated.attributes));
    const applied = apply;
    if (applied) {
      await prisma.listingDraft.update({
        where: { id: product.draft.id },
        data: {
          attributes: JSON.stringify(attributes),
          userEditedJson: markUserEdited(product.draft.userEditedJson, ["attributes"]),
        },
      });
    }

    results.push({
      productId: product.id,
      attributeCount: attributes.length,
      applied,
      warnings: generated.warnings,
    });
  }

  return { ok: true, data: { model, results, errors } };
}

export async function matchCatalogForProducts(input: {
  productIds: string[];
  autoApply?: boolean;
}): Promise<ToolResult> {
  const { productIds, autoApply = true } = input;
  if (!productIds.length) return { ok: false, error: "productIds obrigatório" };

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { draft: true },
  });

  const results: Array<{
    productId: string;
    bestMatch: string | null;
    score: number | null;
    confident: boolean;
    applied: boolean;
    warnings: string[];
  }> = [];
  const errors: string[] = [];

  for (const product of products) {
    if (!product.draft) {
      errors.push(`${product.id}: sem draft`);
      continue;
    }
    const identifiers = extractProductIdentifiers({
      attributesJson: product.attributesJson,
      description: product.description,
    });
    const match = await findCatalogMatch({
      title: product.draft.title || product.title,
      gtin: identifiers.gtin,
      brand: identifiers.brand,
      model: identifiers.model,
    });

    const edited = parseUserEdited(product.draft.userEditedJson);
    const applied =
      autoApply &&
      match.confident &&
      Boolean(match.bestMatch) &&
      !product.draft.catalogProductId &&
      !edited.catalogProductId;

    await prisma.listingDraft.update({
      where: { id: product.draft.id },
      data: {
        catalogSuggestionJson: JSON.stringify({
          suggestions: match.suggestions,
          bestMatch: match.bestMatch,
          confident: match.confident,
          checkedAt: new Date().toISOString(),
        }),
        ...(applied
          ? { catalogProductId: match.bestMatch?.catalogProductId ?? null }
          : {}),
      },
    });

    results.push({
      productId: product.id,
      bestMatch: match.bestMatch?.catalogProductId ?? null,
      score: match.bestMatch?.score ?? null,
      confident: match.confident,
      applied,
      warnings: match.warnings,
    });
  }

  return { ok: true, data: { results, errors } };
}

export async function applyListingDefaultsToProducts(input: {
  productIds?: string[];
  all?: boolean;
}): Promise<ToolResult> {
  const productIds = input.productIds ?? [];
  if (!input.all && !productIds.length) {
    return { ok: false, error: "Informe productIds ou all=true" };
  }

  const settings = await getAppSettings();
  const products = await prisma.product.findMany({
    where: input.all ? {} : { id: { in: productIds } },
    include: { draft: true },
  });

  let updated = 0;
  const errors: string[] = [];

  for (const product of products) {
    if (!product.draft) {
      errors.push(`${product.id}: sem draft`);
      continue;
    }
    const draft = product.draft;
    const defaults = resolveListingDefaults(
      {
        listingTypeId: draft.listingTypeId,
        shippingMode: draft.shippingMode,
        freeShipping: draft.freeShipping,
        localPickUp: draft.localPickUp,
        warrantyType: draft.warrantyType,
        warrantyTime: draft.warrantyTime,
        productWarranty: product.warranty,
        userEdited: parseUserEdited(draft.userEditedJson),
      },
      settings
    );

    try {
      await prisma.listingDraft.update({ where: { id: draft.id }, data: defaults });
      updated += 1;
    } catch (err) {
      errors.push(`${product.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ok: true, data: { updated, errors, defaults: settings } };
}

export async function categorizeProducts(input: {
  productIds: string[];
  apply?: boolean;
  allowAiFallback?: boolean;
}): Promise<ToolResult> {
  const { productIds, apply = true, allowAiFallback = true } = input;
  if (!productIds.length) return { ok: false, error: "productIds obrigatório" };

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { draft: true },
  });

  const results: Array<{
    productId: string;
    categoryId: string;
    categoryName: string;
    source: string;
    applied: boolean;
    warnings: string[];
  }> = [];
  const errors: string[] = [];

  for (const product of products) {
    if (!product.draft) {
      errors.push(`${product.id}: sem draft`);
      continue;
    }
    const title = (product.draft.title || product.title).trim();
    if (!title) {
      errors.push(`${product.id}: sem título`);
      continue;
    }

    try {
      const result = await categorizeProduct({
        title,
        description: product.draft.description || product.description,
        categoryPath: product.categoryPath,
        allowAiFallback,
      });

      const applied = apply && Boolean(result.categoryId);
      if (applied) {
        await prisma.listingDraft.update({
          where: { id: product.draft.id },
          data: {
            categoryId: result.categoryId,
            userEditedJson: markUserEdited(product.draft.userEditedJson, ["categoryId"]),
          },
        });
      }

      results.push({
        productId: product.id,
        categoryId: result.categoryId,
        categoryName: result.categoryName,
        source: result.source,
        applied,
        warnings: result.warnings,
      });
    } catch (err) {
      errors.push(`${product.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ok: true, data: { results, errors } };
}

const SHOPEE_TOOL_NAMES = new Set(SHOPEE_AGENT_TOOLS.map((t) => t.name));

export async function executeAgentTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  if (SHOPEE_TOOL_NAMES.has(name as ShopeeAgentToolName)) {
    return executeShopeeAgentTool(name, args);
  }
  try {
    switch (name as AgentToolName) {
      case "sync_catalog": {
        const run = await runCatalogSync({
          skipMlSync: Boolean(args.skipMlSync),
        });
        return { ok: true, data: run };
      }
      case "sync_ml_listings": {
        const run = await runMlListingSync();
        return { ok: true, data: run };
      }
      case "list_products": {
        const limit = Math.min(Number(args.limit) || 50, 200);
        const products = await prisma.product.findMany({
          where: {
            ...(args.status ? { status: String(args.status) } : {}),
            ...(args.q
              ? {
                  OR: [
                    { title: { contains: String(args.q) } },
                    { externalId: { contains: String(args.q) } },
                  ],
                }
              : {}),
          },
          include: { draft: true },
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        return {
          ok: true,
          data: products.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            costPrice: p.costPrice,
            stock: p.stock,
            draftPrice: p.draft?.price,
            mlItemId: p.mlItemId,
          })),
        };
      }
      case "apply_margin": {
        return applyMarginToProducts({
          productIds: Array.isArray(args.productIds)
            ? (args.productIds as string[])
            : [],
          marginPercent: Number(args.marginPercent),
          pushToMl: Boolean(args.pushToMl),
        });
      }
      case "get_settings": {
        const settings = await getAppSettings();
        return { ok: true, data: settings };
      }
      case "update_settings": {
        const patch: Parameters<typeof updateAppSettings>[0] = {};
        if (args.marginPercent !== undefined) {
          patch.marginPercent = Number(args.marginPercent);
        }
        if (args.autoSyncMode !== undefined) {
          const mode = String(args.autoSyncMode);
          if (!isAutoSyncMode(mode)) {
            return { ok: false, error: "autoSyncMode inválido" };
          }
          patch.autoSyncMode = mode as AutoSyncMode;
        }
        if (args.autoPauseWhenUnavailable !== undefined) {
          patch.autoPauseWhenUnavailable = Boolean(args.autoPauseWhenUnavailable);
        }
        if (args.ollamaBaseUrl !== undefined) {
          patch.ollamaBaseUrl = String(args.ollamaBaseUrl);
        }
        if (args.ollamaModel !== undefined) {
          patch.ollamaModel = String(args.ollamaModel);
        }
        if (args.aiProvider !== undefined) {
          const provider = String(args.aiProvider);
          if (!isAiProviderId(provider)) {
            return { ok: false, error: `aiProvider inválido (use: ${AI_PROVIDER_IDS.join(", ")})` };
          }
          patch.aiProvider = provider;
        }
        if (args.aiApiKey !== undefined) patch.aiApiKey = String(args.aiApiKey);
        if (args.aiBaseUrl !== undefined) patch.aiBaseUrl = String(args.aiBaseUrl);
        if (args.aiModel !== undefined) patch.aiModel = String(args.aiModel);
        if (args.aiCliCommand !== undefined) patch.aiCliCommand = String(args.aiCliCommand);
        if (args.aiCliArgs !== undefined) {
          patch.aiCliArgs = Array.isArray(args.aiCliArgs) ? args.aiCliArgs.map(String) : [];
        }
        const settings = await updateAppSettings(patch);
        return { ok: true, data: settings };
      }
      case "get_status": {
        const { getShopeeAuthStatus } = await import("@/lib/agent/shopee-tools");
        const [ml, shopee, lastSync, lastMlSync, lastShopeeSync, settings] = await Promise.all([
          getAuthStatus(),
          getShopeeAuthStatus(),
          prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
          prisma.mlSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
          prisma.shopeeSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
          getAppSettings(),
        ]);
        return {
          ok: true,
          data: { ml, shopee, lastSync, lastMlSync, lastShopeeSync, autoSyncMode: settings.autoSyncMode },
        };
      }
      case "queue_publish": {
        const productIds = Array.isArray(args.productIds)
          ? (args.productIds as string[])
          : [];
        if (!productIds.length) return { ok: false, error: "productIds obrigatório" };
        const { enqueuePublish } = await import("@/lib/publish/worker");
        const job = await enqueuePublish({ productIds });
        return { ok: true, data: job };
      }
      case "fill_attributes_ai": {
        return fillAttributesForProducts({
          productIds: Array.isArray(args.productIds)
            ? (args.productIds as string[])
            : [],
          apply: args.apply === undefined ? true : Boolean(args.apply),
        });
      }
      case "match_ml_catalog": {
        return matchCatalogForProducts({
          productIds: Array.isArray(args.productIds)
            ? (args.productIds as string[])
            : [],
          autoApply: args.autoApply === undefined ? true : Boolean(args.autoApply),
        });
      }
      case "apply_listing_defaults": {
        return applyListingDefaultsToProducts({
          productIds: Array.isArray(args.productIds)
            ? (args.productIds as string[])
            : [],
          all: Boolean(args.all),
        });
      }
      case "categorize_products": {
        return categorizeProducts({
          productIds: Array.isArray(args.productIds)
            ? (args.productIds as string[])
            : [],
          apply: args.apply === undefined ? true : Boolean(args.apply),
          allowAiFallback:
            args.allowAiFallback === undefined ? true : Boolean(args.allowAiFallback),
        });
      }
      case "list_ml_listings": {
        const limit = Math.min(Number(args.limit) || 50, 200);
        const q = args.q ? String(args.q) : undefined;
        const listings = await prisma.mlListing.findMany({
          where: q ? { OR: [{ title: { contains: q } }, { id: { contains: q } }] } : undefined,
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        return { ok: true, data: listings };
      }
      case "create_kit_from_ml_listings": {
        const productIds = Array.isArray(args.productIds) ? (args.productIds as string[]) : [];
        if (!productIds.length) return { ok: false, error: "productIds obrigatório" };
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, title: true, mlItemId: true },
        });
        const notPublished = products.filter((p) => !p.mlItemId).map((p) => p.title);
        if (notPublished.length) {
          return {
            ok: false,
            error: `Produto(s) ainda não publicado(s) no ML, não é possível montar kit: ${notPublished.join(", ")}`,
          };
        }
        const kit = await createKitFromProducts(productIds);
        return { ok: true, data: kit };
      }
      case "set_ml_price": {
        const mlItemIds = Array.isArray(args.mlItemIds) ? (args.mlItemIds as string[]) : [];
        if (!mlItemIds.length) return { ok: false, error: "mlItemIds obrigatório" };
        const price = args.price !== undefined ? Number(args.price) : undefined;
        const marginPercent =
          args.marginPercent !== undefined ? Number(args.marginPercent) : undefined;
        if (price == null && marginPercent == null) {
          return { ok: false, error: "Informe price ou marginPercent" };
        }
        const result = await applyBulkPrice({ ids: mlItemIds, price, marginPercent });
        return { ok: true, data: result };
      }
      case "manage_ml_promotion": {
        const mlItemId = String(args.mlItemId ?? "");
        const action = String(args.action ?? "");
        if (!mlItemId || !action) return { ok: false, error: "mlItemId e action obrigatórios" };
        if (action === "list") {
          const result = await listItemPromotions(mlItemId);
          return { ok: result.ok, data: result.promotions, error: result.ok ? undefined : result.error };
        }
        const promotionId = args.promotionId ? String(args.promotionId) : undefined;
        const promotionType = String(args.promotionType ?? "");
        const dealPrice = args.dealPrice !== undefined ? Number(args.dealPrice) : undefined;
        if (!promotionType) {
          return { ok: false, error: "promotionType obrigatório" };
        }
        if (promotionType !== "PRICE_DISCOUNT" && !promotionId) {
          return { ok: false, error: "promotionId obrigatório para este tipo (use action=list para pegar o id)" };
        }
        if (action === "apply") {
          if (promotionType === "PRICE_DISCOUNT" && !(dealPrice! > 0)) {
            return {
              ok: false,
              error: "dealPrice obrigatório para PRICE_DISCOUNT (dentro do min/max_discounted_price de action=list)",
            };
          }
          const result = await applyPromotion(mlItemId, { promotionId, promotionType, dealPrice });
          return { ok: result.ok, data: result.data };
        }
        if (action === "cancel") {
          const result = await cancelPromotion(mlItemId, promotionId, promotionType);
          return { ok: result.ok, data: result.data };
        }
        return { ok: false, error: `action inválida: ${action}` };
      }
      case "apply_bulk_discount": {
        const mlItemIds = Array.isArray(args.mlItemIds) ? (args.mlItemIds as string[]) : [];
        const percent = Number(args.percent);
        if (!mlItemIds.length) return { ok: false, error: "mlItemIds obrigatório" };
        if (!(percent > 0 && percent < 100)) {
          return { ok: false, error: "percent inválido (entre 0 e 100)" };
        }
        const result = await applyBulkDiscount({ ids: mlItemIds, percent });
        return { ok: true, data: result };
      }
      case "suggest_ml_kits": {
        const ids = Array.isArray(args.mlItemIds) ? (args.mlItemIds as string[]) : [];
        const listings = await prisma.mlListing.findMany({
          where: ids.length ? { id: { in: ids } } : { status: "active" },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, price: true, categoryId: true },
        });
        if (!listings.length) {
          return { ok: false, error: "Nenhum anúncio importado. Rode a importação primeiro." };
        }
        // Descrição original do fornecedor (catálogo Meu Drop) — matéria-prima pra IA escrever um anúncio melhor.
        const sourceProducts = await prisma.product.findMany({
          where: { mlItemId: { in: listings.map((l) => l.id) } },
          select: { mlItemId: true, description: true },
        });
        const descriptionByListingId = new Map(
          sourceProducts.map((p) => [p.mlItemId!, p.description])
        );
        const candidates = listings.map((l) => ({
          ...l,
          sourceDescription: descriptionByListingId.get(l.id) ?? null,
        }));
        const { suggestKits } = await import("@/lib/agent/kit-suggestions");
        const result = await suggestKits(candidates, {
          maxSuggestions: Number(args.maxSuggestions) || 5,
        });
        return { ok: true, data: result };
      }
      case "create_kit_from_ml_listing_ids": {
        const mlItemIds = Array.isArray(args.mlItemIds) ? (args.mlItemIds as string[]) : [];
        if (mlItemIds.length < 2) {
          return { ok: false, error: "Informe ao menos 2 mlItemIds" };
        }
        const { createKitFromMlListings } = await import("@/lib/kits/from-ml-listings");
        const kit = await createKitFromMlListings({
          listingIds: mlItemIds,
          title: args.title ? String(args.title) : undefined,
          description: args.description ? String(args.description) : undefined,
          bundleDiscountPercent:
            args.bundleDiscountPercent !== undefined
              ? Number(args.bundleDiscountPercent)
              : undefined,
          aiRationale: args.aiRationale ? String(args.aiRationale) : undefined,
        });

        // Marca (BRAND) é sempre obrigatória pro ML — sem isso a publicação do kit falha.
        // Preenchemos com IA sempre, não só quando o agente lembra de pedir.
        const { enrichKitWithAi } = await import("@/lib/kits/enrich");
        const enrichment = await enrichKitWithAi(kit.id).catch((err) => ({
          error: err instanceof Error ? err.message : String(err),
        }));
        return {
          ok: true,
          data: {
            kitId: kit.id,
            title: kit.title,
            price: kit.draft?.price ?? 0,
            costPrice: kit.costPrice,
            items: kit.items.length,
            enrichment,
          },
        };
      }
      case "review_ml_listings_from_catalog": {
        const mlItemIds = Array.isArray(args.mlItemIds) ? (args.mlItemIds as string[]) : [];
        if (!mlItemIds.length) return { ok: false, error: "mlItemIds obrigatório" };
        const result = await applyBulkReview(mlItemIds);
        return { ok: true, data: result };
      }
      case "sync_ml_stock_from_catalog": {
        const mlItemIds = Array.isArray(args.mlItemIds) ? (args.mlItemIds as string[]) : [];
        const result = await syncListingStockFromCatalog(mlItemIds.length ? mlItemIds : undefined);
        return { ok: true, data: result };
      }
      case "match_avulso_ml_listings_to_catalog": {
        const mlItemIds = Array.isArray(args.mlItemIds) ? (args.mlItemIds as string[]) : [];
        const result = await matchAvulsoListingsToCatalog(mlItemIds.length ? mlItemIds : undefined);
        return { ok: true, data: result };
      }
      default:
        return { ok: false, error: `Tool desconhecida: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
