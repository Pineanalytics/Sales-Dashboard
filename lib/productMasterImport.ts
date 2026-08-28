import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedProductRow } from "@/lib/parseProducts";

const CHUNK_SIZE = 400;

export interface ProductImportResult {
  total: number;
  inserted: number;
  updated: number;
  principals: string[];
}

async function upsertChunk(rows: ParsedProductRow[]) {
  const values = rows.map((row) => Prisma.sql`(
    ${randomUUID()}, ${row.itemNo}, ${row.itemDescription}, ${row.series}, ${row.size},
    ${row.packSize}, ${row.principal}, ${row.costPrice}, ${row.classification}, ${row.ssuConversion}, now(), now()
  )`);
  await prisma.$executeRaw`
    INSERT INTO "Product" (id, "itemNo", "itemDescription", series, size, "packSize", principal, "costPrice", classification, "ssuConversion", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("itemNo") DO UPDATE SET
      "itemDescription" = EXCLUDED."itemDescription",
      series = EXCLUDED.series,
      size = EXCLUDED.size,
      "packSize" = EXCLUDED."packSize",
      principal = EXCLUDED.principal,
      "costPrice" = EXCLUDED."costPrice",
      classification = EXCLUDED.classification,
      "ssuConversion" = EXCLUDED."ssuConversion",
      "updatedAt" = now()
  `;
}

export async function importProductMaster(rows: ParsedProductRow[]): Promise<ProductImportResult> {
  const existing = await prisma.product.findMany({
    where: { itemNo: { in: rows.map((row) => row.itemNo) } },
    select: { itemNo: true },
  });
  const existingItems = new Set(existing.map((row) => row.itemNo));

  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    await upsertChunk(rows.slice(index, index + CHUNK_SIZE));
  }

  const inserted = rows.filter((row) => !existingItems.has(row.itemNo)).length;
  return {
    total: rows.length,
    inserted,
    updated: rows.length - inserted,
    principals: [...new Set(rows.map((row) => row.principal))].sort(),
  };
}
