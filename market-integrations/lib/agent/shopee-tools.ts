import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { markUserEdited, parseUserEdited } from "@/lib/sync/merge";
import { getAuthStatus } from "@/lib/shopee/auth";
import { resolveListingDefaults } from "@/lib/shopee/payload";
import { categorizeWithAi } from "@/lib/shopee/category";
import { runShopeeListingSync } from "@/lib/shopee/listing-sync";
import { applyShopeeBulkPrice, applyShopeeBulkStatus } from "@/lib/shopee/promotions-sync";
import { applyShopeeBulkDiscount, createSingleItemDiscount, endDiscount } from "@/lib/shopee/promotions";
import { applyShopeeListingReview } from "@/lib/shopee/listing-review";
import { syncShopeeListingStockFromCatalog } from "@/lib/shopee/stock-sync";
import { matchAvulsoShopeeListingsToCatalog } from "@/lib/shopee-listings/catalog-match";
import { createKitFromShopeeListings } from "@/lib/shopee-kits/from-shopee-listings";
import { enrichShopeeKitWithAi } from "@/lib/shopee-kits/enrich";

export type ShopeeAgentToolName =
  | "apply_shopee_listing_defaults"
  | "categorize_shopee_products"
  | "queue_shopee_publish"
  | "list_shopee_listings"
  | "sync_shopee_listings"
  | "sync_shopee_stock_from_catalog"
  | "set_shopee_price"
  | "create_kit_from_shopee_listings"
  | "create_kit_from_shopee_listing_ids"
  | "suggest_shopee_kits"
  | "review_shopee_listings_from_catalog"
  | "match_avulso_shopee_listings_to_catalog"
  | "manage_shopee_promotion"
  | "apply_shopee_bulk_discount";

export type ShopeeAgentToolDef = {
  name: ShopeeAgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const SHOPEE_AGENT_TOOLS: ShopeeAgentToolDef[] = [
  {
    name: "apply_shopee_listing_defaults",
    description:
      "Aplica nos rascunhos Shopee dos produtos os padrões das configurações (peso, dias pra despachar), sem sobrescrever campos editados manualmente.",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
        all: { type: "boolean", description: "Aplica em todos os produtos com rascunho Shopee" },
      },
    },
  },
  {
    name: "categorize_shopee_products",
    description:
      "Gera o categoryId da Shopee dos produtos via IA (a Shopee não tem preditor oficial de categoria como o ML).",
    inputSchema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" } },
        apply: { type: "boolean", description: "Se false, apenas sugere sem salvar (padrão true)" },
      },
      required: ["productIds"],
    },
  },
  {
    name: "queue_shopee_publish",
    description: "Enfileira publicação na Shopee para os productIds informados.",
    inputSchema: {
      type: "object",
      properties: { productIds: { type: "array", items: { type: "string" } } },
      required: ["productIds"],
    },
  },
  {
    name: "list_shopee_listings",
    description: "Lista os anúncios já publicados na Shopee (importados via API), com preço, estoque e status.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Filtro por título ou item id" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "sync_shopee_listings",
    description: "Atualiza preço/estoque dos anúncios publicados na Shopee conforme a política de sync.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sync_shopee_stock_from_catalog",
    description:
      "Atualiza o estoque dos anúncios na Shopee conforme o estoque atual do Meu Drop. Zerou no Meu Drop, desativa (unlist) o anúncio automaticamente. Sem shopeeItemIds, sincroniza todos os vinculados.",
    inputSchema: {
      type: "object",
      properties: { shopeeItemIds: { type: "array", items: { type: "string" } } },
    },
  },
  {
    name: "set_shopee_price",
    description:
      "Atualiza o preço de um ou mais anúncios já publicados na Shopee, direto por update_price. Pode usar preço fixo ou margem % (recalculada a partir do custo do produto local).",
    inputSchema: {
      type: "object",
      properties: {
        shopeeItemIds: { type: "array", items: { type: "string" } },
        price: { type: "number", description: "Preço fixo em BRL" },
        marginPercent: { type: "number" },
      },
      required: ["shopeeItemIds"],
    },
  },
  {
    name: "create_kit_from_shopee_listings",
    description:
      "Cria um kit a partir de produtos que JÁ estão publicados na Shopee (precisam ter shopeeItemId). Recusa se algum produto informado ainda não estiver publicado.",
    inputSchema: {
      type: "object",
      properties: { productIds: { type: "array", items: { type: "string" } } },
      required: ["productIds"],
    },
  },
  {
    name: "create_kit_from_shopee_listing_ids",
    description:
      "Cria um kit a partir de 2+ anúncios já publicados na Shopee (shopeeItemIds). Preço = soma dos preços menos o desconto de combo. Sempre categoriza e preenche as características obrigatórias com IA automaticamente após criar.",
    inputSchema: {
      type: "object",
      properties: {
        shopeeItemIds: { type: "array", items: { type: "string" } },
        title: { type: "string", description: "Máximo 120 caracteres. Gerado automaticamente se omitido." },
        description: { type: "string" },
        bundleDiscountPercent: { type: "number", description: "Padrão 10" },
        aiRationale: { type: "string" },
      },
      required: ["shopeeItemIds"],
    },
  },
  {
    name: "suggest_shopee_kits",
    description:
      "Analisa os anúncios já publicados na Shopee e sugere kits (combos) coerentes, com título, descrição, justificativa, itens e desconto sugerido. Só sugere — não cria nada.",
    inputSchema: {
      type: "object",
      properties: {
        shopeeItemIds: { type: "array", items: { type: "string" } },
        maxSuggestions: { type: "number" },
      },
    },
  },
  {
    name: "review_shopee_listings_from_catalog",
    description:
      "Revisa e corrige título e características de anúncios já publicados na Shopee usando o catálogo do Meu Drop como fonte da verdade. Só funciona em anúncios vinculados a um produto do Meu Drop.",
    inputSchema: {
      type: "object",
      properties: { shopeeItemIds: { type: "array", items: { type: "string" } } },
      required: ["shopeeItemIds"],
    },
  },
  {
    name: "match_avulso_shopee_listings_to_catalog",
    description:
      "Tenta vincular anúncios 'avulsos' da Shopee (sem produto/kit local) a produtos do catálogo Meu Drop ainda sem shopeeItemId, por SKU ou similaridade de título. Só grava o vínculo local; nunca cria, edita ou apaga nada na Shopee.",
    inputSchema: {
      type: "object",
      properties: { shopeeItemIds: { type: "array", items: { type: "string" } } },
    },
  },
  {
    name: "manage_shopee_promotion",
    description:
      "Aplica ou cancela um desconto (Discount) num anúncio da Shopee. Aplicar cria um Discount de item único com o dealPrice informado; cancelar encerra o Discount pelo discountId.",
    inputSchema: {
      type: "object",
      properties: {
        shopeeItemId: { type: "string" },
        action: { type: "string", enum: ["apply", "cancel"] },
        dealPrice: { type: "number", description: "Obrigatório ao aplicar" },
        discountId: { type: "number", description: "Obrigatório ao cancelar" },
      },
      required: ["shopeeItemId", "action"],
    },
  },
  {
    name: "apply_shopee_bulk_discount",
    description:
      "Aplica desconto % em massa numa lista de shopeeItemIds, todos com a mesma porcentagem, cada um recebendo seu próprio Discount de item único.",
    inputSchema: {
      type: "object",
      properties: {
        shopeeItemIds: { type: "array", items: { type: "string" } },
        percent: { type: "number", description: "Percentual de desconto, entre 0 e 100" },
      },
      required: ["shopeeItemIds", "percent"],
    },
  },
];

export type ShopeeToolResult = { ok: boolean; data?: unknown; error?: string };

export async function executeShopeeAgentTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<ShopeeToolResult> {
  try {
    switch (name as ShopeeAgentToolName) {
      case "apply_shopee_listing_defaults": {
        const productIds = Array.isArray(args.productIds) ? (args.productIds as string[]) : [];
        if (!args.all && !productIds.length) {
          return { ok: false, error: "Informe productIds ou all=true" };
        }
        const settings = await getAppSettings();
        const products = await prisma.product.findMany({
          where: args.all ? {} : { id: { in: productIds } },
          include: { shopeeDraft: true },
        });
        let updated = 0;
        const errors: string[] = [];
        for (const product of products) {
          if (!product.shopeeDraft) {
            errors.push(`${product.id}: sem rascunho Shopee`);
            continue;
          }
          const defaults = resolveListingDefaults(
            {
              weightKg: product.shopeeDraft.weightKg,
              daysToShip: product.shopeeDraft.daysToShip,
              userEdited: parseUserEdited(product.shopeeDraft.userEditedJson),
            },
            settings
          );
          try {
            await prisma.shopeeListingDraft.update({ where: { id: product.shopeeDraft.id }, data: defaults });
            updated += 1;
          } catch (err) {
            errors.push(`${product.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return { ok: true, data: { updated, errors, defaults: settings } };
      }
      case "categorize_shopee_products": {
        const productIds = Array.isArray(args.productIds) ? (args.productIds as string[]) : [];
        if (!productIds.length) return { ok: false, error: "productIds obrigatório" };
        const apply = args.apply === undefined ? true : Boolean(args.apply);
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          include: { shopeeDraft: true },
        });
        const results: Array<{ productId: string; categoryId: string; categoryName: string; applied: boolean; warnings: string[] }> = [];
        const errors: string[] = [];
        for (const product of products) {
          if (!product.shopeeDraft) {
            errors.push(`${product.id}: sem rascunho Shopee`);
            continue;
          }
          const title = (product.shopeeDraft.title || product.title).trim();
          if (!title) {
            errors.push(`${product.id}: sem título`);
            continue;
          }
          const result = await categorizeWithAi({
            title,
            description: product.shopeeDraft.description || product.description,
            categoryPath: product.categoryPath,
          });
          const applied = apply && Boolean(result.categoryId);
          if (applied) {
            await prisma.shopeeListingDraft.update({
              where: { id: product.shopeeDraft.id },
              data: {
                categoryId: result.categoryId,
                userEditedJson: markUserEdited(product.shopeeDraft.userEditedJson, ["categoryId"]),
              },
            });
          }
          results.push({
            productId: product.id,
            categoryId: result.categoryId,
            categoryName: result.categoryName,
            applied,
            warnings: result.warnings,
          });
        }
        return { ok: true, data: { results, errors } };
      }
      case "queue_shopee_publish": {
        const productIds = Array.isArray(args.productIds) ? (args.productIds as string[]) : [];
        if (!productIds.length) return { ok: false, error: "productIds obrigatório" };
        const { enqueueShopeePublish } = await import("@/lib/shopee/publish/worker");
        const job = await enqueueShopeePublish({ productIds });
        return { ok: true, data: job };
      }
      case "list_shopee_listings": {
        const limit = Math.min(Number(args.limit) || 50, 200);
        const q = args.q ? String(args.q) : undefined;
        const listings = await prisma.shopeeListing.findMany({
          where: q ? { OR: [{ title: { contains: q } }, { id: { contains: q } }] } : undefined,
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        return { ok: true, data: listings };
      }
      case "sync_shopee_listings": {
        const run = await runShopeeListingSync();
        return { ok: true, data: run };
      }
      case "sync_shopee_stock_from_catalog": {
        const shopeeItemIds = Array.isArray(args.shopeeItemIds) ? (args.shopeeItemIds as string[]) : [];
        const result = await syncShopeeListingStockFromCatalog(shopeeItemIds.length ? shopeeItemIds : undefined);
        return { ok: true, data: result };
      }
      case "set_shopee_price": {
        const shopeeItemIds = Array.isArray(args.shopeeItemIds) ? (args.shopeeItemIds as string[]) : [];
        if (!shopeeItemIds.length) return { ok: false, error: "shopeeItemIds obrigatório" };
        const price = args.price !== undefined ? Number(args.price) : undefined;
        const marginPercent = args.marginPercent !== undefined ? Number(args.marginPercent) : undefined;
        if (price == null && marginPercent == null) {
          return { ok: false, error: "Informe price ou marginPercent" };
        }
        const result = await applyShopeeBulkPrice({ ids: shopeeItemIds, price, marginPercent });
        return { ok: true, data: result };
      }
      case "create_kit_from_shopee_listings": {
        const productIds = Array.isArray(args.productIds) ? (args.productIds as string[]) : [];
        if (!productIds.length) return { ok: false, error: "productIds obrigatório" };
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, title: true, shopeeItemId: true },
        });
        const notPublished = products.filter((p) => !p.shopeeItemId).map((p) => p.title);
        if (notPublished.length) {
          return {
            ok: false,
            error: `Produto(s) ainda não publicado(s) na Shopee, não é possível montar kit: ${notPublished.join(", ")}`,
          };
        }
        const kit = await createKitFromShopeeListings({
          listingIds: products.map((p) => p.shopeeItemId!),
        });
        return { ok: true, data: kit };
      }
      case "create_kit_from_shopee_listing_ids": {
        const shopeeItemIds = Array.isArray(args.shopeeItemIds) ? (args.shopeeItemIds as string[]) : [];
        if (shopeeItemIds.length < 2) return { ok: false, error: "Informe ao menos 2 shopeeItemIds" };
        const kit = await createKitFromShopeeListings({
          listingIds: shopeeItemIds,
          title: args.title ? String(args.title) : undefined,
          description: args.description ? String(args.description) : undefined,
          bundleDiscountPercent:
            args.bundleDiscountPercent !== undefined ? Number(args.bundleDiscountPercent) : undefined,
          aiRationale: args.aiRationale ? String(args.aiRationale) : undefined,
        });
        const enrichment = await enrichShopeeKitWithAi(kit.id).catch((err) => ({
          error: err instanceof Error ? err.message : String(err),
        }));
        return {
          ok: true,
          data: {
            kitId: kit.id,
            title: kit.title,
            price: kit.shopeeDraft?.price ?? 0,
            costPrice: kit.costPrice,
            items: kit.items.length,
            enrichment,
          },
        };
      }
      case "suggest_shopee_kits": {
        const ids = Array.isArray(args.shopeeItemIds) ? (args.shopeeItemIds as string[]) : [];
        const listings = await prisma.shopeeListing.findMany({
          where: ids.length ? { id: { in: ids } } : { status: "NORMAL" },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, price: true, categoryId: true },
        });
        if (!listings.length) {
          return { ok: false, error: "Nenhum anúncio importado. Rode a importação primeiro." };
        }
        const sourceProducts = await prisma.product.findMany({
          where: { shopeeItemId: { in: listings.map((l) => l.id) } },
          select: { shopeeItemId: true, description: true },
        });
        const descriptionByListingId = new Map(sourceProducts.map((p) => [p.shopeeItemId!, p.description]));
        const candidates = listings.map((l) => ({ ...l, sourceDescription: descriptionByListingId.get(l.id) ?? null }));
        const { suggestKits } = await import("@/lib/agent/kit-suggestions");
        const result = await suggestKits(candidates, { maxSuggestions: Number(args.maxSuggestions) || 5 });
        return { ok: true, data: result };
      }
      case "review_shopee_listings_from_catalog": {
        const shopeeItemIds = Array.isArray(args.shopeeItemIds) ? (args.shopeeItemIds as string[]) : [];
        if (!shopeeItemIds.length) return { ok: false, error: "shopeeItemIds obrigatório" };
        let updated = 0;
        let skipped = 0;
        const errors: string[] = [];
        for (const id of shopeeItemIds) {
          try {
            const result = await applyShopeeListingReview(id);
            if (!result.matched || !result.applied) skipped += 1;
            else updated += 1;
          } catch (err) {
            errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return { ok: true, data: { updated, skipped, errors } };
      }
      case "match_avulso_shopee_listings_to_catalog": {
        const shopeeItemIds = Array.isArray(args.shopeeItemIds) ? (args.shopeeItemIds as string[]) : [];
        const result = await matchAvulsoShopeeListingsToCatalog(shopeeItemIds.length ? shopeeItemIds : undefined);
        return { ok: true, data: result };
      }
      case "manage_shopee_promotion": {
        const shopeeItemId = String(args.shopeeItemId ?? "");
        const action = String(args.action ?? "");
        if (!shopeeItemId || !action) return { ok: false, error: "shopeeItemId e action obrigatórios" };
        if (action === "apply") {
          const dealPrice = args.dealPrice !== undefined ? Number(args.dealPrice) : undefined;
          if (!(dealPrice! > 0)) return { ok: false, error: "dealPrice obrigatório para aplicar" };
          const result = await createSingleItemDiscount(shopeeItemId, dealPrice!);
          return { ok: result.ok, data: result, error: result.ok ? undefined : result.error };
        }
        if (action === "cancel") {
          const discountId = args.discountId !== undefined ? Number(args.discountId) : undefined;
          if (!discountId) return { ok: false, error: "discountId obrigatório para cancelar" };
          const result = await endDiscount(discountId);
          return { ok: result.ok, data: result.data };
        }
        return { ok: false, error: `action inválida: ${action}` };
      }
      case "apply_shopee_bulk_discount": {
        const shopeeItemIds = Array.isArray(args.shopeeItemIds) ? (args.shopeeItemIds as string[]) : [];
        const percent = Number(args.percent);
        if (!shopeeItemIds.length) return { ok: false, error: "shopeeItemIds obrigatório" };
        if (!(percent > 0 && percent < 100)) return { ok: false, error: "percent inválido (entre 0 e 100)" };
        const result = await applyShopeeBulkDiscount({ ids: shopeeItemIds, percent });
        return { ok: true, data: result };
      }
      default:
        return { ok: false, error: `Tool desconhecida: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getShopeeAuthStatus() {
  return getAuthStatus();
}
