import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const CSV_COLUMNS: { header: string; get: (p: Record<string, unknown>) => unknown }[] = [
  { header: "externalId", get: (p) => p.externalId },
  { header: "sourceUrl", get: (p) => p.sourceUrl },
  { header: "sku", get: (p) => p.sku },
  { header: "title", get: (p) => p.title },
  { header: "description", get: (p) => p.description },
  { header: "costPrice", get: (p) => p.costPrice },
  { header: "stock", get: (p) => p.stock },
  { header: "sourceStock", get: (p) => p.sourceStock },
  { header: "categoryPath", get: (p) => p.categoryPath },
  { header: "warranty", get: (p) => p.warranty },
  { header: "warningsJson", get: (p) => p.warningsJson },
  { header: "attributesJson", get: (p) => p.attributesJson },
  { header: "extraInfoJson", get: (p) => p.extraInfoJson },
  { header: "pictures", get: (p) => p.pictures },
  { header: "videoUrl", get: (p) => p.videoUrl },
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const products = await prisma.product.findMany({ orderBy: { createdAt: "asc" } });

  const lines = [CSV_COLUMNS.map((c) => csvEscape(c.header)).join(",")];
  for (const product of products) {
    lines.push(
      CSV_COLUMNS.map((c) => csvEscape(c.get(product as unknown as Record<string, unknown>))).join(",")
    );
  }
  const csv = "﻿" + lines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="catalogo-meudrop-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
