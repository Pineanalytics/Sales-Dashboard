// Customer analysis at SFA-outlet level. SAP carries two customer names on every sales document: CardName, the
// billing account (often a shared "Cash Customer - <rep>" or a van/route account), and U_CustomerName, the outlet
// the SFA app actually sold to (see lib/sfaCustomer.ts). The SFA-outlet tables (SfaCustomerActual by month,
// SalesDocument by invoice) hold sales under the outlet; this turns them into the row shape the customer portfolio
// already summarises, so ranking, tiers and growth work unchanged with the outlet as the customer.
//
// Pure, no I/O: the database reads are in lib/sfaPortfolioData.ts.
import { normalizeCustomerName, normalizePrincipalKey } from "./normalize";
import type { MonthlyBrandCustomerRow } from "./types";

/** One SfaCustomerActual row: month x principal x billing account x SFA outlet x rep. */
export interface SfaOutletRow {
  year: string;
  monthIndex: number;
  principal: string;
  cardCode: string;
  accountName: string;
  sfaCustomer: string;
  sfaContact: string;
  slpCode: number;
  repName: string;
  docCount: number;
  cases: number;
  revenue: number;
  grossProfit: number;
}

/** One SalesDocument row (an invoice or credit note), used where a day-level cut is needed. */
export interface SfaDocumentRow {
  docDate: Date;
  cardCode: string;
  accountName: string;
  sfaCustomer: string;
  sfaContact: string;
  repName: string;
  principal: string;
  cases: number;
  netSales: number;
  grossProfit: number;
}

export interface MonthRef {
  year: string;
  monthIndex: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const round1 = (n: number) => Math.round(n * 10) / 10;
const marginOf = (grossProfit: number, revenue: number) => (revenue > 0 ? round1((grossProfit / revenue) * 100) : null);
export const monthKey = (year: string, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

/** Two outlet names are the same outlet when they match ignoring case, spacing and punctuation. */
export const sfaOutletKey = normalizeCustomerName;

function portfolioRow(base: { year: string; monthIndex: number; day?: number }, row: {
  principal: string;
  repName: string;
  sfaCustomer: string;
  accountName: string;
  sfaContact: string;
  docCount: number;
  cases: number;
  revenue: number;
  grossProfit: number;
}): MonthlyBrandCustomerRow {
  return {
    date: `${base.year}-${String(base.monthIndex + 1).padStart(2, "0")}-${String(base.day ?? 1).padStart(2, "0")}`,
    year: base.year,
    month: MONTH_NAMES[base.monthIndex],
    monthIndex: base.monthIndex,
    principal: row.principal,
    principalKey: normalizePrincipalKey(row.principal),
    salesEmployee: row.repName,
    customerName: row.sfaCustomer,
    accountName: row.accountName,
    sfaContact: row.sfaContact,
    docCount: row.docCount,
    cases: row.cases,
    revenue: row.revenue,
    grossProfit: row.grossProfit,
    grossMarginPct: marginOf(row.grossProfit, row.revenue),
  };
}

/** SfaCustomerActual rows as portfolio rows (the outlet is the customerName). */
export function sfaOutletRowsToPortfolioRows(rows: SfaOutletRow[]): MonthlyBrandCustomerRow[] {
  return rows.map((row) => portfolioRow({ year: row.year, monthIndex: row.monthIndex }, row));
}

/** SalesDocument rows as portfolio rows, one per document. */
export function sfaDocumentsToPortfolioRows(rows: SfaDocumentRow[]): MonthlyBrandCustomerRow[] {
  return rows.map((row) =>
    portfolioRow(
      { year: String(row.docDate.getUTCFullYear()), monthIndex: row.docDate.getUTCMonth(), day: row.docDate.getUTCDate() },
      { principal: row.principal, repName: row.repName, sfaCustomer: row.sfaCustomer, accountName: row.accountName, sfaContact: row.sfaContact, docCount: 1, cases: row.cases, revenue: row.netSales, grossProfit: row.grossProfit }
    )
  );
}

/** Requested months ("YYYY-MM") that no row covers. Pass the rows before any principal filtering, so a restricted
 *  viewer whose principals simply sold nothing in a month does not look like missing data. */
export function missingSfaPeriods(requested: MonthRef[], rows: { year: string; monthIndex: number }[]): string[] {
  const loaded = new Set(rows.map((row) => monthKey(row.year, row.monthIndex)));
  return [...new Set(requested.map((period) => monthKey(period.year, period.monthIndex)))].filter((key) => !loaded.has(key)).sort();
}
