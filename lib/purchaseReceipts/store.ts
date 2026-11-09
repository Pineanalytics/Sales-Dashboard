// Reads the stock-receipt lines the SAP sync stored (PurchaseReceiptLine) for the months of a period.
import { prisma } from "@/lib/db";
import { buildPurchaseSummary, matchesPrincipalFilter, monthsWithoutData, type MonthRef, type PurchaseSummary, type ReceiptLine } from "./summary";
import { buildTrend, type SecondaryMonthRow, type Trend } from "./trend";
import type { ReceiptDocType, StockClass } from "./types";

export interface PurchaseReport {
  summary: PurchaseSummary;
  /** Months of the period with no receipt lines stored: not loaded yet, or genuinely no receipts. */
  missingMonths: MonthRef[];
  /** When the newest line in scope was synced from SAP. */
  syncedAt: string | null;
  /** The lines themselves, for the receipt register sheet; null when the selection is too large to list. */
  lines: ReceiptLine[] | null;
  /** Primary (purchases) against secondary (actual sales) by month, for the trend sheet. */
  trend: Trend;
}

/** Past this many lines the Excel keeps the roll-ups and leaves out the line-by-line register. */
export const MAX_REGISTER_LINES = 150_000;

/** Every receipt line of the months (all principals), oldest first. */
export async function loadReceiptLines(months: MonthRef[]): Promise<{ lines: ReceiptLine[]; syncedAt: Date | null }> {
  if (months.length === 0) return { lines: [], syncedAt: null };
  const rows = await prisma.purchaseReceiptLine.findMany({
    where: { OR: months.map((m) => ({ year: m.year, monthIndex: m.monthIndex })) },
    orderBy: [{ docDate: "asc" }, { docEntry: "asc" }, { itemCode: "asc" }],
  });
  let syncedAt: Date | null = null;
  for (const r of rows) if (!syncedAt || r.updatedAt > syncedAt) syncedAt = r.updatedAt;
  return {
    syncedAt,
    lines: rows.map((r) => ({
      year: r.year,
      monthIndex: r.monthIndex,
      docDate: r.docDate.toISOString().slice(0, 10),
      docType: r.docType as ReceiptDocType,
      docEntry: r.docEntry,
      docNum: r.docNum,
      supplierCode: r.supplierCode,
      supplierName: r.supplierName,
      itemCode: r.itemCode,
      itemName: r.itemName,
      warehouseCode: r.warehouseCode,
      location: r.location,
      principal: r.principal,
      principalSource: r.principalSource as ReceiptLine["principalSource"],
      stockClass: r.stockClass as StockClass,
      qty: r.qty,
      cases: r.cases,
      value: r.value,
    })),
  };
}

/**
 * Actual sales (secondary) by principal and month, in cases and value, for the months. Read from the Customers & Brands actuals, whose revenue equals the monthly sales actuals
 * the Sales page shows (checked month by month) and which also carry cases on the same pack-size conversion as the receipts.
 */
export async function loadSecondaryMonthly(months: MonthRef[]): Promise<SecondaryMonthRow[]> {
  if (months.length === 0) return [];
  const groups = await prisma.brandCustomerActual.groupBy({
    by: ["year", "monthIndex", "principal"],
    where: { OR: months.map((m) => ({ year: String(m.year), monthIndex: m.monthIndex })) },
    _sum: { cases: true, revenue: true },
  });
  return groups.map((g) => ({ year: Number(g.year), monthIndex: g.monthIndex, principal: g.principal, cases: g._sum.cases ?? 0, value: g._sum.revenue ?? 0 }));
}

export async function buildPurchaseReport(months: MonthRef[], principalKey: string | null): Promise<PurchaseReport> {
  const [{ lines, syncedAt }, secondary] = await Promise.all([loadReceiptLines(months), loadSecondaryMonthly(months)]);
  // "Missing" is judged on every principal's lines, not the filtered ones: a principal with no receipts in a loaded month is not a missing month.
  const wanted = principalKey ? lines.filter((l) => matchesPrincipalFilter(l.principal, principalKey)) : lines;
  return {
    summary: buildPurchaseSummary(wanted, months, principalKey),
    missingMonths: monthsWithoutData(lines, months),
    syncedAt: syncedAt ? syncedAt.toISOString() : null,
    lines: wanted.length <= MAX_REGISTER_LINES ? wanted : null,
    trend: buildTrend(lines, secondary, months, principalKey),
  };
}
