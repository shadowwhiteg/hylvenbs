import { prisma } from "@/lib/db";
import { scrapeMeuDrop } from "@/lib/scrape/meudrop";
import { mergeScrapedIntoDraft, parseUserEdited } from "@/lib/sync/merge";
import { simulateCosts } from "@/lib/pricing/simulator";
import { resolveListingDefaults } from "@/lib/ml/payload";
import { getAppSettings } from "@/lib/settings";
import { applyStockPercent } from "@/lib/sync/stock-percent";
import { runMlListingSync } from "@/lib/ml/listing-sync";
import { isValidMlTitle, resolveMlTitle } from "@/lib/agent/title";
import { categorizeProduct } from "@/lib/ml/categorize-product";

function suggestPrice(
  costPrice: number,
  listingTypeId: string,
  marginPercent: number
): number {
  try {
    return simulateCosts({
      costPrice: costPrice || 1,
      listingTypeId,
      marginPercent,
    }).suggestedPrice;
  } catch {
    return costPrice;
  }
}

async function resolveDraftTitle(input: {
  originalTitle: string;
  currentMlTitle?: string | null;
  titleEditedByUser: boolean;
  sourceTitleChanged: boolean;
  description?: string;
  categoryPath?: string | null;
}): Promise<{ title: string; warnings: string[] }> {
  if (isValidMlTitle(input.currentMlTitle) && !input.sourceTitleChanged && input.titleEditedByUser) {
    return { title: input.currentMlTitle!.trim(), warnings: [] };
  }

  const result = await resolveMlTitle({
    originalTitle: input.originalTitle,
    currentMlTitle: input.currentMlTitle,
    titleEditedByUser: input.titleEditedByUser,
    sourceTitleChanged: input.sourceTitleChanged,
    description: input.description,
    categoryPath: input.categoryPath,
  });

  return { title: result.title, warnings: result.warnings };
}

async function resolveDraftCategory(input: {
  title: string;
  description?: string;
  categoryPath?: string | null;
  currentCategoryId?: string | null;
  categoryEditedByUser: boolean;
}): Promise<{ categoryId: string; warnings: string[] }> {
  const current = (input.currentCategoryId || "").trim();
  if (input.categoryEditedByUser && current) {
    return { categoryId: current, warnings: [] };
  }
  if (current) {
    return { categoryId: current, warnings: [] };
  }

  const result = await categorizeProduct({
    title: input.title,
    description: input.description,
    categoryPath: input.categoryPath,
  });

  return { categoryId: result.categoryId, warnings: result.warnings };
}

export async function runCatalogSync(options?: {
  skipMlSync?: boolean;
  /** When set, reuses an already-created SyncRun (for fire-and-forget enqueue). */
  runId?: string;
}) {
  const run = options?.runId
    ? await prisma.syncRun.findUniqueOrThrow({ where: { id: options.runId } })
    : await prisma.syncRun.create({
        data: { status: "running" },
      });

  let createdCount = 0;
  let updatedCount = 0;
  let unavailableCount = 0;

  try {
    const { products, warnings, stats } = await scrapeMeuDrop();
    const seenIds = new Set<string>();

    const settings = await getAppSettings();
    warnings.unshift(
      `Scrape: ${stats.pages} página(s), ${stats.cards} produtos, ${stats.withPrice} com preço, login=${stats.loggedIn ? "ok" : "não"}`
    );

    for (const scraped of products) {
      seenIds.add(scraped.externalId);
      const existing = await prisma.product.findUnique({
        where: { externalId: scraped.externalId },
        include: { draft: true },
      });

      const attributesJson = JSON.stringify(scraped.attributes ?? []);
      const extraInfoJson = JSON.stringify(scraped.extraInfo ?? {});
      const sourceStock =
        scraped.stock !== undefined && scraped.stock !== null ? scraped.stock : null;
      const catalogStock = applyStockPercent(
        sourceStock,
        settings.catalogStockPercent
      );

      const listingDefaults = resolveListingDefaults(
        { productWarranty: scraped.warranty },
        settings
      );

      if (!existing) {
        const suggested = suggestPrice(
          scraped.costPrice,
          listingDefaults.listingTypeId,
          settings.marginPercent
        );

        const titleResult = await resolveDraftTitle({
          originalTitle: scraped.title,
          currentMlTitle: null,
          titleEditedByUser: false,
          sourceTitleChanged: true,
          description: scraped.description,
          categoryPath: scraped.categoryPath,
        });
        if (titleResult.warnings.length) warnings.push(...titleResult.warnings);

        const categoryResult = await resolveDraftCategory({
          title: titleResult.title || scraped.title,
          description: scraped.description,
          categoryPath: scraped.categoryPath,
          currentCategoryId: null,
          categoryEditedByUser: false,
        });
        if (categoryResult.warnings.length) warnings.push(...categoryResult.warnings);

        await prisma.product.create({
          data: {
            externalId: scraped.externalId,
            sourceUrl: scraped.sourceUrl,
            title: scraped.title,
            costPrice: scraped.costPrice,
            description: scraped.description,
            pictures: JSON.stringify(scraped.pictures),
            stock: catalogStock,
            sourceStock,
            videoUrl: scraped.videoUrl ?? null,
            attributesJson,
            extraInfoJson,
            sku: scraped.sku ?? null,
            categoryPath: scraped.categoryPath ?? null,
            warranty: scraped.warranty ?? null,
            warningsJson: JSON.stringify(scraped.warnings ?? []),
            status: "synced",
            lastSyncedAt: new Date(),
            draft: {
              create: {
                title: titleResult.title,
                description: scraped.description,
                price: suggested,
                pictures: JSON.stringify(scraped.pictures),
                attributes: attributesJson,
                videoUrl: scraped.videoUrl ?? null,
                availableQuantity: catalogStock !== null ? Math.max(0, catalogStock) : 1,
                condition: "new",
                buyingMode: "buy_it_now",
                categoryId: categoryResult.categoryId,
                ...listingDefaults,
              },
            },
          },
        });
        createdCount += 1;
      } else {
        const draft = existing.draft;
        const merged = draft
          ? mergeScrapedIntoDraft(scraped, existing, draft, {
              catalogStockPercent: settings.catalogStockPercent,
            })
          : {
              product: {
                title: scraped.title,
                costPrice: scraped.costPrice,
                description: scraped.description,
                pictures: JSON.stringify(scraped.pictures),
                stock: catalogStock,
                sourceStock,
                videoUrl: scraped.videoUrl ?? null,
                attributesJson,
                extraInfoJson,
                sku: scraped.sku ?? null,
                categoryPath: scraped.categoryPath ?? null,
                warranty: scraped.warranty ?? null,
                warningsJson: JSON.stringify(scraped.warnings ?? []),
              },
              draft: null,
            };

        await prisma.product.update({
          where: { id: existing.id },
          data: {
            title: merged.product.title,
            costPrice: merged.product.costPrice,
            description: merged.product.description,
            pictures: merged.product.pictures,
            stock: merged.product.stock ?? null,
            sourceStock: merged.product.sourceStock ?? sourceStock,
            videoUrl: merged.product.videoUrl ?? null,
            attributesJson: merged.product.attributesJson ?? attributesJson,
            extraInfoJson: merged.product.extraInfoJson ?? extraInfoJson,
            sku: merged.product.sku ?? null,
            categoryPath: merged.product.categoryPath ?? null,
            warranty: merged.product.warranty ?? null,
            warningsJson: merged.product.warningsJson ?? "[]",
            status: existing.status === "published" ? "published" : "synced",
            lastSyncedAt: new Date(),
          },
        });

        if (draft && merged.draft) {
          const edited = parseUserEdited(draft.userEditedJson);
          const defaults = resolveListingDefaults(
            { ...draft, productWarranty: scraped.warranty, userEdited: edited },
            settings
          );

          // A draft priced below cost means the previous scrape read the price
          // wrong; reprice it unless the seller set that price by hand.
          const price =
            !edited.price && merged.draft.price < merged.product.costPrice
              ? suggestPrice(
                  merged.product.costPrice,
                  defaults.listingTypeId,
                  draft.marginPercentOverride ?? settings.marginPercent
                )
              : merged.draft.price;

          const sourceTitleChanged = scraped.title !== existing.title;
          const needsTitle =
            !edited.title &&
            (!isValidMlTitle(merged.draft.title) || sourceTitleChanged);

          let draftTitle = merged.draft.title;
          if (needsTitle) {
            const titleResult = await resolveDraftTitle({
              originalTitle: scraped.title,
              currentMlTitle: draft.title,
              titleEditedByUser: Boolean(edited.title),
              sourceTitleChanged,
              description: scraped.description,
              categoryPath: scraped.categoryPath,
            });
            draftTitle = titleResult.title;
            if (titleResult.warnings.length) warnings.push(...titleResult.warnings);
          }

          let draftCategoryId = draft.categoryId;
          if (!edited.categoryId && !draft.categoryId?.trim()) {
            const categoryResult = await resolveDraftCategory({
              title: draftTitle || scraped.title,
              description: merged.draft.description,
              categoryPath: scraped.categoryPath,
              currentCategoryId: draft.categoryId,
              categoryEditedByUser: Boolean(edited.categoryId),
            });
            draftCategoryId = categoryResult.categoryId;
            if (categoryResult.warnings.length) warnings.push(...categoryResult.warnings);
          }

          await prisma.listingDraft.update({
            where: { id: draft.id },
            data: {
              title: draftTitle,
              description: merged.draft.description,
              pictures: merged.draft.pictures,
              price,
              attributes: merged.draft.attributes,
              videoUrl: merged.draft.videoUrl ?? null,
              availableQuantity: merged.draft.availableQuantity,
              categoryId: draftCategoryId,
              ...defaults,
            },
          });
        } else if (!draft) {
          const titleResult = await resolveDraftTitle({
            originalTitle: scraped.title,
            currentMlTitle: null,
            titleEditedByUser: false,
            sourceTitleChanged: true,
            description: scraped.description,
            categoryPath: scraped.categoryPath,
          });
          if (titleResult.warnings.length) warnings.push(...titleResult.warnings);

          const categoryResult = await resolveDraftCategory({
            title: titleResult.title || scraped.title,
            description: scraped.description,
            categoryPath: scraped.categoryPath,
            currentCategoryId: null,
            categoryEditedByUser: false,
          });
          if (categoryResult.warnings.length) warnings.push(...categoryResult.warnings);

          await prisma.listingDraft.create({
            data: {
              productId: existing.id,
              title: titleResult.title,
              description: scraped.description,
              pictures: JSON.stringify(scraped.pictures),
              attributes: attributesJson,
              videoUrl: scraped.videoUrl ?? null,
              availableQuantity: catalogStock !== null ? Math.max(0, catalogStock) : 1,
              price: scraped.costPrice,
              categoryId: categoryResult.categoryId,
              ...listingDefaults,
            },
          });
        }

        updatedCount += 1;
      }
    }

    if (products.length) {
      const stale = await prisma.product.findMany({
        where: { externalId: { notIn: Array.from(seenIds) }, status: { not: "unavailable" } },
      });
      if (stale.length) {
        await prisma.product.updateMany({
          where: { id: { in: stale.map((s) => s.id) } },
          data: { status: "unavailable" },
        });
        unavailableCount = stale.length;
      }
    }

    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        createdCount,
        updatedCount,
        unavailableCount,
        error: warnings.length ? warnings.join("; ") : null,
      },
    });

    let mlSync = null;
    if (!options?.skipMlSync) {
      try {
        mlSync = await runMlListingSync();
      } catch (err) {
        console.error("[catalog-sync] ml listing sync failed", err);
      }
    }

    return { ...finished, mlSync };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: "error",
        finishedAt: new Date(),
        createdCount,
        updatedCount,
        unavailableCount,
        error: message,
      },
    });
  }
}

/**
 * Starts catalog sync in the background and returns immediately.
 * Avoids Cloudflare tunnel HTTP 524 on long scrapes (~100s origin timeout).
 */
export async function enqueueCatalogSync(options?: { skipMlSync?: boolean }) {
  const running = await prisma.syncRun.findFirst({
    where: { status: "running" },
    orderBy: { startedAt: "desc" },
  });
  if (running && !running.finishedAt) {
    return { run: running, alreadyRunning: true as const };
  }

  const run = await prisma.syncRun.create({
    data: { status: "running" },
  });

  void runCatalogSync({ ...options, runId: run.id }).catch((err) => {
    console.error("[catalog-sync] background failed", err);
  });

  return { run, alreadyRunning: false as const };
}
