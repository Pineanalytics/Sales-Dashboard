// Database side of Upfield's outlet list (customer master): replace it whole, and report on it against the DataEdge sales feed.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { UpfieldOutletMasterRow } from "./upfieldOutletMaster";

const CHUNK = 1000;

/** Replaces the whole outlet list in one transaction (an upload is the official master: outlets missing from it are gone). */
export async function replaceUpfieldOutletMaster(rows: UpfieldOutletMasterRow[], meta: { sourceFile: string | null; uploadedBy: string | null }): Promise<number> {
  const uploadedAt = new Date();
  await prisma.$transaction(
    async (tx) => {
      await tx.upfieldOutletMaster.deleteMany({});
      for (let index = 0; index < rows.length; index += CHUNK) {
        await tx.upfieldOutletMaster.createMany({
          data: rows.slice(index, index + CHUNK).map((row) => ({ ...row, sourceFile: meta.sourceFile, uploadedBy: meta.uploadedBy, uploadedAt })),
        });
      }
    },
    { timeout: 120_000, maxWait: 30_000 }
  );
  return rows.length;
}

export interface UpfieldOutletMasterStatus {
  total: number;
  uploadedAt: string | null;
  sourceFile: string | null;
  uploadedBy: string | null;
  byChannel: { name: string; outlets: number; bought: number }[];
  byType: { name: string; outlets: number; bought: number }[];
  byFsr: { name: string; outlets: number; bought: number }[];
  /** Outlets in the list that have bought (a sale) in the last 90 days, and that have never appeared in the sales feed. */
  bought90: number;
  neverInSalesFeed: number;
  /** Customers in the sales feed that are not in the list (the DataEdge connectivity-test row is ignored). */
  buyersNotInList: number;
  buyersNotInListExamples: { code: string; name: string }[];
}

const number = (value: unknown) => Number(value ?? 0);

export async function getUpfieldOutletMasterStatus(): Promise<UpfieldOutletMasterStatus> {
  const [head, breakdown, totals, notInList] = await Promise.all([
    prisma.upfieldOutletMaster.findFirst({ orderBy: { uploadedAt: "desc" }, select: { uploadedAt: true, sourceFile: true, uploadedBy: true } }),
    prisma.$queryRaw<{ dim: string; name: string; outlets: bigint; bought: bigint }[]>(Prisma.sql`
      WITH bought AS (
        SELECT DISTINCT "custCode" FROM "UpfieldTransaction" WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0 AND "txnDate" >= now() - interval '90 days'
      ), m AS (
        SELECT m.*, (b."custCode" IS NOT NULL) AS bought FROM "UpfieldOutletMaster" m LEFT JOIN bought b ON b."custCode" = m."outletCode"
      )
      SELECT 'channel' AS dim, COALESCE(channel, 'Unspecified') AS name, COUNT(*) AS outlets, COUNT(*) FILTER (WHERE bought) AS bought FROM m GROUP BY 2
      UNION ALL SELECT 'type', COALESCE("outletType", 'Unspecified'), COUNT(*), COUNT(*) FILTER (WHERE bought) FROM m GROUP BY 2
      UNION ALL SELECT 'fsr', COALESCE("fsrName", 'Unassigned'), COUNT(*), COUNT(*) FILTER (WHERE bought) FROM m GROUP BY 2
    `),
    prisma.$queryRaw<{ total: bigint; bought90: bigint; never: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "UpfieldTransaction" t WHERE t."custCode" = m."outletCode" AND t.type = 'sale' AND COALESCE(t."saleIncl", 0) > 0 AND t."txnDate" >= now() - interval '90 days')) AS bought90,
             COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "UpfieldTransaction" t WHERE t."custCode" = m."outletCode")) AS never
      FROM "UpfieldOutletMaster" m
    `),
    prisma.$queryRaw<{ code: string; name: string }[]>(Prisma.sql`
      SELECT t."custCode" AS code, MAX(t."custName") AS name
      FROM "UpfieldTransaction" t
      WHERE NULLIF(BTRIM(t."custCode"), '') IS NOT NULL AND t."custCode" <> '000' AND UPPER(COALESCE(t."custName", '')) NOT LIKE '%CONNECTIVITY TEST%'
        AND NOT EXISTS (SELECT 1 FROM "UpfieldOutletMaster" m WHERE m."outletCode" = t."custCode")
      GROUP BY t."custCode" ORDER BY MAX(t."txnDate") DESC
    `),
  ]);
  const pick = (dim: string) =>
    breakdown
      .filter((row) => row.dim === dim)
      .map((row) => ({ name: row.name, outlets: number(row.outlets), bought: number(row.bought) }))
      .sort((a, b) => b.outlets - a.outlets);
  return {
    total: number(totals[0]?.total),
    uploadedAt: head?.uploadedAt.toISOString() ?? null,
    sourceFile: head?.sourceFile ?? null,
    uploadedBy: head?.uploadedBy ?? null,
    byChannel: pick("channel"),
    byType: pick("type"),
    byFsr: pick("fsr"),
    bought90: number(totals[0]?.bought90),
    neverInSalesFeed: number(totals[0]?.never),
    buyersNotInList: notInList.length,
    buyersNotInListExamples: notInList.slice(0, 8),
  };
}
