// Database reads for the SFA-outlet customer analysis (see lib/sfaPortfolio.ts).
import { prisma } from "@/lib/db";
import type { MonthRef, SfaDocumentRow, SfaOutletRow } from "@/lib/sfaPortfolio";

/** SfaCustomerActual for the given months (month x principal x billing account x SFA outlet x rep). */
export async function getSfaOutletRows(periods: MonthRef[]): Promise<SfaOutletRow[]> {
  const unique = Array.from(new Map(periods.map((period) => [`${period.year}|${period.monthIndex}`, period])).values());
  if (unique.length === 0) return [];
  return prisma.sfaCustomerActual.findMany({
    where: { OR: unique.map((period) => ({ year: period.year, monthIndex: period.monthIndex })) },
    select: { year: true, monthIndex: true, principal: true, cardCode: true, accountName: true, sfaCustomer: true, sfaContact: true, slpCode: true, repName: true, docCount: true, cases: true, revenue: true, grossProfit: true },
  });
}

/** SalesDocument rows (invoices and credit notes) dated within [start, end], both UTC dates. */
export async function getSfaDocumentRows(start: Date, end: Date): Promise<SfaDocumentRow[]> {
  return prisma.salesDocument.findMany({
    where: { docDate: { gte: start, lte: end } },
    select: { docDate: true, cardCode: true, accountName: true, sfaCustomer: true, sfaContact: true, repName: true, principal: true, cases: true, netSales: true, grossProfit: true },
  });
}
