// Database reads for the SAP invoice lines behind the Customer extract (see lib/salesLines.ts).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { LinkedLine } from "@/lib/customerLineExtract";
import { createOutletDirectory, outletId, type OutletDirectory } from "@/lib/customerOutlets";
import { normalizeReference } from "@/lib/invoiceReferences";
import type { SalesLineRecord } from "@/lib/salesLines";
import { monthKey, type MonthRef } from "@/lib/sfaPortfolio";

const BATCH = 10_000;

/** Which of the requested months are not held line by line, and when the oldest of the held ones was last read from SAP. */
export async function salesLineCoverage(periods: MonthRef[]): Promise<{ missing: string[]; dataAsOf: Date | null }> {
  const loaded = await prisma.salesLineMonth.findMany({
    where: { OR: periods.map((period) => ({ year: period.year, monthIndex: period.monthIndex })) },
    select: { year: true, monthIndex: true, syncedAt: true },
  });
  const held = new Set(loaded.map((row) => monthKey(row.year, row.monthIndex)));
  const missing = [...new Set(periods.map((period) => monthKey(period.year, period.monthIndex)))].filter((key) => !held.has(key)).sort();
  const oldest = loaded.reduce<Date | null>((min, row) => (min === null || row.syncedAt < min ? row.syncedAt : min), null);
  return { missing, dataAsOf: oldest };
}

function linesWhere(periods: MonthRef[], principals: string[]): Prisma.SalesLineWhereInput {
  return {
    principal: { in: principals },
    OR: periods.map((period) => ({
      docDate: { gte: new Date(Date.UTC(Number(period.year), period.monthIndex, 1)), lt: new Date(Date.UTC(Number(period.year), period.monthIndex + 1, 1)) },
    })),
  };
}

export function countSalesLines(periods: MonthRef[], principals: string[]): Promise<number> {
  return prisma.salesLine.count({ where: linesWhere(periods, principals) });
}

/** Every outlet the SFA systems hold, for the channel, segment and territory of the customers. */
export async function loadOutletDirectory(): Promise<OutletDirectory> {
  const rows = await prisma.outletUniverse.findMany({
    select: { source: true, outletKey: true, principal: true, outletName: true, channel: true, segment: true, region: true, territory: true, territoryClean: true, route: true, teamLeader: true },
  });
  return createOutletDirectory(rows);
}

/** Puts on each line the outlet its invoice reference points to. */
async function withOutlets<T extends { numAtCard: string | null }>(lines: T[]): Promise<(T & { outletId: string | null })[]> {
  const refs = [...new Set(lines.map((line) => normalizeReference(line.numAtCard)).filter(Boolean))];
  const links = refs.length > 0 ? await prisma.invoiceOutlet.findMany({ where: { ref: { in: refs } }, select: { ref: true, source: true, outletKey: true } }) : [];
  const byRef = new Map(links.map((link) => [link.ref, outletId(link.source, link.outletKey)]));
  return lines.map((line) => ({ ...line, outletId: byRef.get(normalizeReference(line.numAtCard)) ?? null }));
}

const RANKING_SELECT = {
  id: true, docType: true, docEntry: true, docDate: true, numAtCard: true, cardCode: true, customerName: true, sfaName: true, salesEmployee: true, principal: true,
  itemCode: true, quantity: true, inventoryQty: true, packSize: true, priceBeforeDiscount: true, unitCost: true, salesAmount: true,
} satisfies Prisma.SalesLineSelect;

const page = (cursor: string | undefined) => ({
  orderBy: [{ docDate: "desc" as const }, { id: "asc" as const }],
  take: BATCH,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

const ymd = (value: Date) => value.toISOString().slice(0, 10);

/** Whole lines, newest first, in batches. */
export async function* salesLineBatches(periods: MonthRef[], principals: string[]): AsyncGenerator<LinkedLine<SalesLineRecord>[]> {
  const where = linesWhere(periods, principals);
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.salesLine.findMany({ where, ...page(cursor) });
    if (rows.length === 0) return;
    yield withOutlets(rows.map((row) => ({ ...row, docType: row.docType as SalesLineRecord["docType"], docDate: ymd(row.docDate), creationDate: row.creationDate ? ymd(row.creationDate) : null })));
    if (rows.length < BATCH) return;
    cursor = rows[rows.length - 1].id;
  }
}

/** Only the fields the ranking needs, for a selection too long to put its raw data in the workbook. */
export async function* rankingLineBatches(periods: MonthRef[], principals: string[]): AsyncGenerator<LinkedLine[]> {
  const where = linesWhere(periods, principals);
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.salesLine.findMany({ where, select: RANKING_SELECT, ...page(cursor) });
    if (rows.length === 0) return;
    yield withOutlets(rows.map((row) => ({ ...row, docType: row.docType as SalesLineRecord["docType"], docDate: ymd(row.docDate) })));
    if (rows.length < BATCH) return;
    cursor = rows[rows.length - 1].id;
  }
}
