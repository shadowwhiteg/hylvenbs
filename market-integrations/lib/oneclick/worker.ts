import { prisma } from "@/lib/db";
import { getOneClickSession } from "@/lib/oneclick/session";
import {
  searchProductBySku,
  publishMl,
  publishShopee,
  updateOneClickPrice,
  oneClickItemId,
} from "@/lib/oneclick/client";
import { skuNotFoundMessage } from "@/lib/oneclick/bulk";
import { sanitizeGtinForPublish } from "@/lib/oneclick/gtin";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Marketplace = "ml" | "shopee";

/**
 * O SQLite pode responder "Socket timeout" quando outro processo segura o
 * arquivo. Numa fila em massa isso acontecia DEPOIS de o anúncio já existir no
 * marketplace: o item virava "erro", o `mlItemId` não era gravado no produto e a
 * próxima seleção republicava o mesmo SKU. Uma falha transitória de escrita não
 * pode custar o vínculo — daí o retry curto.
 */
async function withDbRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

const mlPermalink = (itemId: string) => `https://produto.mercadolivre.com.br/${itemId}`;

export async function processOneClickJob(jobId: string, delayMs = 800) {
  const job = await prisma.oneClickJob.findUnique({ where: { id: jobId }, include: { items: true } });
  if (!job) throw new Error("OneClickJob not found");

  await prisma.oneClickJob.update({ where: { id: jobId }, data: { status: "running" } });

  let oneClick;
  try {
    oneClick = await getOneClickSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.oneClickJobItem.updateMany({
      where: { jobId },
      data: { status: "error", error: `Falha ao conectar ao Meu Drop: ${message}` },
    });
    return prisma.oneClickJob.update({
      where: { id: jobId },
      data: { status: "error", finishedAt: new Date() },
      include: { items: true },
    });
  }

  const { session, wmd } = oneClick;
  const marketplace = job.marketplace as Marketplace;
  const mode = job.mode === "sync" ? "sync" : "publish";
  if (marketplace === "ml" && wmd.mlConnected !== "1") {
    await prisma.oneClickJobItem.updateMany({
      where: { jobId },
      data: { status: "error", error: "Mercado Livre não está conectado no Sistema One Click" },
    });
    return prisma.oneClickJob.update({
      where: { id: jobId },
      data: { status: "error", finishedAt: new Date() },
      include: { items: true },
    });
  }
  if (marketplace === "shopee" && wmd.spConnected !== "1") {
    await prisma.oneClickJobItem.updateMany({
      where: { jobId },
      data: { status: "error", error: "Shopee não está conectada no Sistema One Click" },
    });
    return prisma.oneClickJob.update({
      where: { id: jobId },
      data: { status: "error", finishedAt: new Date() },
      include: { items: true },
    });
  }

  for (const item of job.items) {
    const latest = await prisma.oneClickJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (latest?.status === "cancelled") {
      await prisma.oneClickJobItem.updateMany({
        where: { jobId, status: { in: ["pending", "running"] } },
        data: { status: "cancelled", error: "Job cancelado" },
      });
      return prisma.oneClickJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { items: true },
      });
    }

    await prisma.oneClickJobItem.update({ where: { id: item.id }, data: { status: "running" } });

    // Guardado fora do try: se a gravação falhar DEPOIS de o marketplace criar o
    // anúncio, o id ainda é persistido no item — senão o anúncio existe lá e o
    // sistema não sabe, e tentaria publicar de novo (duplicando).
    let createdItemId: string | null = null;

    try {
      const found = await searchProductBySku(session, wmd, item.sku, item.title);
      if (!found) {
        let stock: number | null | undefined;
        if (item.productId) {
          const product = await prisma.product
            .findUnique({ where: { id: item.productId }, select: { stock: true } })
            .catch(() => null);
          stock = product?.stock;
        }
        throw new Error(skuNotFoundMessage(stock));
      }

      if (mode === "sync") {
        // Anúncio já existe: republicar não mexe no preço, então usamos o
        // endpoint "Atualizar preço" do próprio Meu Drop.
        const update = await updateOneClickPrice(session, wmd, marketplace, [
          { id: found.id, price: item.price },
        ]);
        const perItem = update.results?.[String(found.id)];
        if (!update.ok || perItem?.ok === false) {
          throw new Error(perItem?.error || update.message || "Falha ao atualizar o preço");
        }
        const existingId =
          marketplace === "ml"
            ? (await prisma.product
                .findUnique({ where: { id: item.productId ?? "" }, select: { mlItemId: true } })
                .catch(() => null))?.mlItemId
            : (await prisma.product
                .findUnique({ where: { id: item.productId ?? "" }, select: { shopeeItemId: true } })
                .catch(() => null))?.shopeeItemId;
        await prisma.oneClickJobItem.update({
          where: { id: item.id },
          data: {
            status: "success",
            resultItemId: existingId ?? null,
            resultUrl: marketplace === "ml" && existingId ? mlPermalink(existingId) : null,
            error: update.message ?? null,
          },
        });
        await sleep(delayMs);
        continue;
      }

      if (marketplace === "ml") {
        const results = await publishMl(session, wmd, [
          {
            id: found.id,
            price: item.price,
            gtin: sanitizeGtinForPublish(item.gtin),
            listing_type: job.listingType || "gold_special",
          },
        ]);
        const result = results[String(found.id)];
        if (!result) throw new Error("Sem resposta do Sistema One Click");

        if (result.ok && !result.linked) {
          const itemId = oneClickItemId(result.item_id);
          createdItemId = itemId;
          // Vínculo primeiro: se a escrita seguinte falhar, o catálogo já sabe
          // que este SKU tem anúncio e não entra de novo na fila.
          if (item.productId) {
            await withDbRetry(() =>
              prisma.product.update({
                where: { id: item.productId as string },
                data: {
                  status: "published",
                  ...(itemId ? { mlItemId: itemId } : {}),
                },
              })
            ).catch(() => undefined);
          }
          await withDbRetry(() =>
            prisma.oneClickJobItem.update({
              where: { id: item.id },
              data: {
                status: "success",
                resultItemId: itemId,
                resultUrl: itemId ? mlPermalink(itemId) : null,
              },
            })
          );
        } else if (result.linked) {
          await prisma.oneClickJobItem.update({
            where: { id: item.id },
            data: {
              status: "conflict",
              error: "SKU já possui anúncio no Mercado Livre; resolva manualmente em Meu Drop > Marketplaces",
            },
          });
        } else {
          throw new Error(result.error || "Falha ao publicar no Mercado Livre");
        }
      } else {
        const results = await publishShopee(session, wmd, [{ id: found.id, price: item.price }]);
        const result = results[String(found.id)];
        if (!result) throw new Error("Sem resposta do Sistema One Click");

        if (result.ok && !result.needs_link) {
          const itemId = oneClickItemId(result.item_id);
          createdItemId = itemId;
          if (item.productId) {
            await withDbRetry(() =>
              prisma.product.update({
                where: { id: item.productId as string },
                data: {
                  status: "published",
                  ...(itemId ? { shopeeItemId: itemId } : {}),
                },
              })
            ).catch(() => undefined);
          }
          await withDbRetry(() =>
            prisma.oneClickJobItem.update({
              where: { id: item.id },
              data: {
                status: "success",
                resultItemId: itemId,
              },
            })
          );
        } else if (result.needs_link) {
          await prisma.oneClickJobItem.update({
            where: { id: item.id },
            data: {
              status: "conflict",
              error: "SKU já possui anúncio na Shopee; resolva manualmente em Meu Drop > Marketplaces",
            },
          });
        } else {
          throw new Error(result.error || "Falha ao publicar na Shopee");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Última tentativa de salvar o vínculo: o anúncio existe no marketplace,
      // e sem o id gravado ele seria republicado no próximo lote.
      if (createdItemId && item.productId) {
        await withDbRetry(() =>
          prisma.product.update({
            where: { id: item.productId as string },
            data:
              marketplace === "ml"
                ? { status: "published", mlItemId: createdItemId }
                : { status: "published", shopeeItemId: createdItemId },
          })
        ).catch(() => undefined);
      }
      await withDbRetry(() =>
        prisma.oneClickJobItem.update({
          where: { id: item.id },
          data: {
            status: "error",
            error: createdItemId
              ? `Anúncio CRIADO (${createdItemId}) mas o registro local falhou: ${message}`
              : message,
            resultItemId: createdItemId,
          },
        })
      ).catch(() => undefined);
    }

    await sleep(delayMs);
  }

  const items = await prisma.oneClickJobItem.findMany({ where: { jobId } });
  const cancelled = await prisma.oneClickJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (cancelled?.status === "cancelled") {
    return prisma.oneClickJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { items: true },
    });
  }

  const allOk = items.every((i) => i.status === "success");
  const allFail = items.every((i) => i.status === "error" || i.status === "conflict");

  return prisma.oneClickJob.update({
    where: { id: jobId },
    data: {
      status: allOk ? "success" : allFail ? "error" : "partial",
      finishedAt: new Date(),
    },
    include: { items: true },
  });
}

/** Marks a running/pending job as cancelled; the worker stops before the next item. */
export async function cancelOneClickJob(jobId: string) {
  const job = await prisma.oneClickJob.findUnique({
    where: { id: jobId },
    include: { items: true },
  });
  if (!job) throw new Error("Job não encontrado");
  if (!["pending", "running"].includes(job.status)) {
    throw new Error(`Job já finalizado (${job.status})`);
  }

  await prisma.oneClickJobItem.updateMany({
    where: { jobId, status: { in: ["pending", "running"] } },
    data: { status: "cancelled", error: "Job cancelado" },
  });

  return prisma.oneClickJob.update({
    where: { id: jobId },
    data: { status: "cancelled", finishedAt: new Date() },
    include: { items: true },
  });
}

export async function enqueueOneClick(input: {
  marketplace: Marketplace;
  mode?: "publish" | "sync";
  listingType?: string;
  items: { productId?: string; sku: string; title?: string; price?: number | null; gtin?: string | null }[];
}) {
  if (!input.items.length) throw new Error("Selecione ao menos um produto");
  if (input.marketplace !== "ml" && input.marketplace !== "shopee") {
    throw new Error("Marketplace inválido");
  }

  const listingType =
    input.marketplace === "ml"
      ? input.listingType === "gold_pro"
        ? "gold_pro"
        : "gold_special"
      : "gold_special";

  const job = await prisma.oneClickJob.create({
    data: {
      marketplace: input.marketplace,
      mode: input.mode === "sync" ? "sync" : "publish",
      listingType,
      status: "pending",
      items: {
        create: input.items.map((item) => ({
          productId: item.productId || null,
          sku: item.sku,
          title: item.title || "",
          price: item.price ?? null,
          gtin: item.gtin || null,
          status: "pending",
        })),
      },
    },
    include: { items: true },
  });

  // fire-and-forget processing — same pattern as PublishJob/ShopeePublishJob.
  // Se o loop morrer (exceção, recompilação em dev, restart), o job ficava preso
  // em "running" com itens "pending" para sempre e a UI girava sem fim. Fechar o
  // job no catch deixa claro o que aconteceu e libera uma nova tentativa.
  void processOneClickJob(job.id).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.oneClickJobItem
      .updateMany({
        where: { jobId: job.id, status: { in: ["pending", "running"] } },
        data: { status: "error", error: `Processamento interrompido: ${message}` },
      })
      .catch(() => undefined);
    await prisma.oneClickJob
      .update({
        where: { id: job.id },
        data: { status: "error", finishedAt: new Date() },
      })
      .catch(() => undefined);
  });

  return job;
}
