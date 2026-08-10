import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { shopeeFetch } from "@/lib/shopee/client";

type UploadImageResponse = {
  response?: { image_info?: { image_id?: string; image_url_list?: Array<{ image_url: string }> } };
  error?: string;
  message?: string;
};

function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

/**
 * Sobe uma imagem (já hospedada, vinda do scrape do Meu Drop) pro media_space da Shopee
 * e devolve o image_id. Requer que a Shopee consiga baixar a URL a partir do payload do
 * add_item — como a API não aceita URL externa direto, baixamos os bytes aqui e reenviamos.
 */
export async function uploadImageBytes(imageUrl: string): Promise<string> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`Falha ao baixar imagem ${imageUrl}: HTTP ${imgRes.status}`);
  }
  const blob = await imgRes.blob();

  const form = new FormData();
  form.append("image", blob, `${hashUrl(imageUrl)}.jpg`);

  const res = await shopeeFetch<UploadImageResponse>("/api/v2/media_space/upload_image", {
    method: "POST",
    body: form,
  });
  const imageId = res.data.response?.image_info?.image_id;
  if (!res.ok || !imageId) {
    throw new Error(
      `Falha ao enviar imagem pra Shopee: ${res.data.error || res.status} ${res.data.message || ""}`.trim()
    );
  }
  return imageId;
}

/**
 * Resolve os image_id de uma lista de URLs, reaproveitando o cache em ShopeeListingDraft.imageIdsJson
 * (chave = sourceUrl) pra não reenviar a mesma imagem a cada publish/edição.
 */
export async function resolveImageIds(
  draftId: string,
  pictureUrls: string[]
): Promise<{ imageIds: string[]; warnings: string[] }> {
  const draft = await prisma.shopeeListingDraft.findUnique({
    where: { id: draftId },
    select: { imageIdsJson: true },
  });

  let cache: Record<string, string> = {};
  try {
    const parsed = JSON.parse(draft?.imageIdsJson || "{}");
    if (parsed && typeof parsed === "object") cache = parsed as Record<string, string>;
  } catch {
    cache = {};
  }

  const imageIds: string[] = [];
  const warnings: string[] = [];
  let cacheChanged = false;

  for (const url of pictureUrls) {
    if (cache[url]) {
      imageIds.push(cache[url]);
      continue;
    }
    try {
      const imageId = await uploadImageBytes(url);
      cache[url] = imageId;
      cacheChanged = true;
      imageIds.push(imageId);
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (cacheChanged) {
    await prisma.shopeeListingDraft.update({
      where: { id: draftId },
      data: { imageIdsJson: JSON.stringify(cache) },
    });
  }

  return { imageIds, warnings };
}
