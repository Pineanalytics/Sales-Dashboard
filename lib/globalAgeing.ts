// "Global Ageing" - a per-customer, per-Principal aged-receivables report
// matching the business's own SAP B1 query (Future / Current month / 1-12
// months ago / Over 12 months ago, bucketed by JDT1.TaxDate against an as-of
// date). Distinct from the older days-past-due ageing in lib/receivables.ts
// and lib/receivablesAgeing.ts (Current/30/60/90/Over-90 off dueDate), which
// stay as they are - this is a new, separate view, not a replacement.
//
// "Property" in the source query is this business's Principal, resolved in
// SAP from OCRD's QryGroup1-64 flags joined to OCQG (see
// scripts/db-bridge/receivables/query.ts's PROPERTY_QUERY) - stored as
// CustomerCreditProfile.principal.
//
// PDQ Cheques are the post-dated cheques held: incoming-payment cheque lines in SAP
// whose due date is after the sync date and that are not yet in a deposit. The receivables
// sync stores them one row per cheque (ReceivablesPostDatedCheque). The invoices those
// cheques already settle have left the open ledger, so
//   Total Debts = Balance Due (open ledger) + PDQ Cheques.
//
// Filters (principal, and a period) narrow the report. A period filters the open items by
// their tax (document) date and the cheques by their due date; the month buckets stay
// relative to the sync date.
import { prisma } from "@/lib/db";

export interface GlobalAgeingBuckets {
  future: number;
  currentMonth: number;
  /** Index 0 = 1 month ago ... index 11 = 12 months ago. */
  monthsAgo: number[];
  over12: number;
}

export interface GlobalAgeingRow {
  totalDebts: number;
  pdqCheques: number;
  balanceDue: number;
  buckets: GlobalAgeingBuckets;
}

export interface GlobalAgeingCustomerRow extends GlobalAgeingRow {
  customerCode: string;
  customerName: string;
  principal: string;
}

export interface GlobalAgeingPrincipalRow extends GlobalAgeingRow {
  principal: string;
}

export interface GlobalAgeingChequeRow {
  customerCode: string;
  customerName: string;
  principal: string;
  paymentNo: number;
  chequeNumber: number | null;
  bankCode: string | null;
  /** yyyy-MM-dd */
  dueDate: string;
  amount: number;
}

/** Principal and period narrowing. No principals means all of them; a null bound is open-ended. */
export interface GlobalAgeingFilters {
  principals: string[];
  from: Date | null;
  to: Date | null;
}

export const NO_FILTERS: GlobalAgeingFilters = { principals: [], from: null, to: null };

export interface GlobalAgeingReport {
  asOf: string;
  /** 12 labels, index 0 = 1 month ago ... index 11 = 12 months ago (e.g. "Sep 2026"). */
  monthLabels: string[];
  currentMonthLabel: string;
  byPrincipal: GlobalAgeingPrincipalRow[];
  byCustomer: GlobalAgeingCustomerRow[];
  cheques: GlobalAgeingChequeRow[];
  grandTotal: GlobalAgeingRow;
  /** Every principal that has a balance or a cheque, whatever the filters, for the filter's options. */
  availablePrincipals: string[];
  filters: { principals: string[]; from: string | null; to: string | null };
}

/** What the screen needs: the pivot and totals, without the thousands of customer and cheque rows (those go in the Excel report). */
export interface GlobalAgeingSummary {
  asOf: string;
  monthLabels: string[];
  currentMonthLabel: string;
  byPrincipal: GlobalAgeingPrincipalRow[];
  grandTotal: GlobalAgeingRow;
  availablePrincipals: string[];
  filters: GlobalAgeingReport["filters"];
  customerCount: number;
  chequeCount: number;
}

export const UNCLASSIFIED_PRINCIPAL = "Unclassified";
const ZERO_TOLERANCE = 0.005;

function emptyBuckets(): GlobalAgeingBuckets {
  return { future: 0, currentMonth: 0, monthsAgo: new Array(12).fill(0), over12: 0 };
}

function addBuckets(target: GlobalAgeingBuckets, from: GlobalAgeingBuckets): void {
  target.future += from.future;
  target.currentMonth += from.currentMonth;
  for (let i = 0; i < 12; i++) target.monthsAgo[i] += from.monthsAgo[i];
  target.over12 += from.over12;
}

function bucketSum(buckets: GlobalAgeingBuckets): number {
  return buckets.future + buckets.currentMonth + buckets.monthsAgo.reduce((sum, v) => sum + v, 0) + buckets.over12;
}

/** Calendar-month difference, asOf minus taxDate - 0 = same month, positive = taxDate in the past,
 *  negative = taxDate in the future. Matches the source SQL's DATEDIFF(MONTH, TaxDate, asOf). */
export function monthsBetween(asOf: Date, taxDate: Date): number {
  return (asOf.getUTCFullYear() * 12 + asOf.getUTCMonth()) - (taxDate.getUTCFullYear() * 12 + taxDate.getUTCMonth());
}

/** Adds one open item's balance into the right bucket, in place. */
export function assignToBucket(buckets: GlobalAgeingBuckets, asOf: Date, taxDate: Date, amount: number): void {
  const diff = monthsBetween(asOf, taxDate);
  if (diff < 0) buckets.future += amount;
  else if (diff === 0) buckets.currentMonth += amount;
  else if (diff <= 12) buckets.monthsAgo[diff - 1] += amount;
  else buckets.over12 += amount;
}

export function monthLabels(asOf: Date): string[] {
  const labels: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1));
    labels.push(d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }));
  }
  return labels;
}

export function currentMonthLabel(asOf: Date): string {
  return asOf.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export interface GlobalAgeingOpenItemInput {
  customerCode: string;
  taxDate: Date | null;
  postingDate: Date;
  openBalance: number;
}
export interface GlobalAgeingCustomerInput {
  customerCode: string;
  customerName: string;
  principal: string | null;
}
export interface GlobalAgeingChequeInput {
  customerCode: string;
  paymentNo: number;
  chequeNumber: number | null;
  bankCode: string | null;
  dueDate: Date;
  amount: number;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Whether a date falls inside the period (inclusive of both days; a null bound is open). */
export function withinPeriod(date: Date, from: Date | null, to: Date | null): boolean {
  const t = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}

/** Pure builder - no DB access, so the bucketing math is directly testable.
 *  getGlobalAgeingReport() below is the thin DB-reading wrapper. */
export function buildGlobalAgeingReport(
  asOf: Date,
  openItems: GlobalAgeingOpenItemInput[],
  customers: GlobalAgeingCustomerInput[],
  cheques: GlobalAgeingChequeInput[],
  filters: GlobalAgeingFilters = NO_FILTERS
): GlobalAgeingReport {
  const customerByCode = new Map(customers.map((c) => [c.customerCode, c]));
  const principalOf = (code: string) => customerByCode.get(code)?.principal?.trim() || UNCLASSIFIED_PRINCIPAL;
  const wanted = new Set(filters.principals.map((p) => p.trim().toLowerCase()).filter(Boolean));
  const principalAllowed = (code: string) => wanted.size === 0 || wanted.has(principalOf(code).toLowerCase());

  // Every principal that has anything, before any filter, so the filter always offers the full list.
  const withActivity = new Set<string>([...openItems.map((i) => i.customerCode), ...cheques.map((c) => c.customerCode)]);
  const availablePrincipals = Array.from(new Set(Array.from(withActivity).map(principalOf))).sort((a, b) => a.localeCompare(b));

  const bucketsByCustomer = new Map<string, GlobalAgeingBuckets>();
  for (const item of openItems) {
    if (!principalAllowed(item.customerCode)) continue;
    // Falls back to postingDate for any row synced before taxDate was added.
    const date = item.taxDate ?? item.postingDate;
    if (!withinPeriod(date, filters.from, filters.to)) continue;
    let buckets = bucketsByCustomer.get(item.customerCode);
    if (!buckets) {
      buckets = emptyBuckets();
      bucketsByCustomer.set(item.customerCode, buckets);
    }
    assignToBucket(buckets, asOf, date, item.openBalance);
  }

  const chequeRows: GlobalAgeingChequeRow[] = [];
  const pdqByCode = new Map<string, number>();
  for (const cheque of cheques) {
    if (!principalAllowed(cheque.customerCode) || !withinPeriod(cheque.dueDate, filters.from, filters.to)) continue;
    pdqByCode.set(cheque.customerCode, (pdqByCode.get(cheque.customerCode) ?? 0) + cheque.amount);
    chequeRows.push({
      customerCode: cheque.customerCode,
      customerName: customerByCode.get(cheque.customerCode)?.customerName ?? cheque.customerCode,
      principal: principalOf(cheque.customerCode),
      paymentNo: cheque.paymentNo,
      chequeNumber: cheque.chequeNumber,
      bankCode: cheque.bankCode,
      dueDate: isoDay(cheque.dueDate),
      amount: cheque.amount,
    });
  }
  chequeRows.sort((a, b) => (a.principal === b.principal ? a.customerName.localeCompare(b.customerName) || a.dueDate.localeCompare(b.dueDate) : a.principal.localeCompare(b.principal)));

  const allCodes = new Set<string>([...bucketsByCustomer.keys(), ...pdqByCode.keys()]);
  const byCustomer: GlobalAgeingCustomerRow[] = [];
  for (const code of allCodes) {
    const buckets = bucketsByCustomer.get(code) ?? emptyBuckets();
    const balanceDue = bucketSum(buckets);
    const pdqCheques = pdqByCode.get(code) ?? 0;
    if (Math.abs(balanceDue) <= ZERO_TOLERANCE && Math.abs(pdqCheques) <= ZERO_TOLERANCE) continue;
    const customer = customerByCode.get(code);
    byCustomer.push({
      customerCode: code,
      customerName: customer?.customerName ?? code,
      principal: principalOf(code),
      totalDebts: balanceDue + pdqCheques,
      pdqCheques,
      balanceDue,
      buckets,
    });
  }
  byCustomer.sort((a, b) => (a.principal === b.principal ? a.customerName.localeCompare(b.customerName) : a.principal.localeCompare(b.principal)));

  const principalMap = new Map<string, GlobalAgeingPrincipalRow>();
  for (const row of byCustomer) {
    let principalRow = principalMap.get(row.principal);
    if (!principalRow) {
      principalRow = { principal: row.principal, totalDebts: 0, pdqCheques: 0, balanceDue: 0, buckets: emptyBuckets() };
      principalMap.set(row.principal, principalRow);
    }
    principalRow.totalDebts += row.totalDebts;
    principalRow.pdqCheques += row.pdqCheques;
    principalRow.balanceDue += row.balanceDue;
    addBuckets(principalRow.buckets, row.buckets);
  }
  const byPrincipal = Array.from(principalMap.values()).sort((a, b) => b.totalDebts - a.totalDebts);

  const grandTotal: GlobalAgeingRow = { totalDebts: 0, pdqCheques: 0, balanceDue: 0, buckets: emptyBuckets() };
  for (const row of byPrincipal) {
    grandTotal.totalDebts += row.totalDebts;
    grandTotal.pdqCheques += row.pdqCheques;
    grandTotal.balanceDue += row.balanceDue;
    addBuckets(grandTotal.buckets, row.buckets);
  }

  return {
    asOf: asOf.toISOString(),
    monthLabels: monthLabels(asOf),
    currentMonthLabel: currentMonthLabel(asOf),
    byPrincipal,
    byCustomer,
    cheques: chequeRows,
    grandTotal,
    availablePrincipals,
    filters: { principals: [...filters.principals], from: filters.from ? isoDay(filters.from) : null, to: filters.to ? isoDay(filters.to) : null },
  };
}

/** The screen's view of a report: the pivot, without the customer and cheque rows. */
export function toSummary(report: GlobalAgeingReport): GlobalAgeingSummary {
  return {
    asOf: report.asOf,
    monthLabels: report.monthLabels,
    currentMonthLabel: report.currentMonthLabel,
    byPrincipal: report.byPrincipal,
    grandTotal: report.grandTotal,
    availablePrincipals: report.availablePrincipals,
    filters: report.filters,
    customerCount: report.byCustomer.length,
    chequeCount: report.cheques.length,
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_ONLY = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseDay(value: string): Date | null {
  if (!DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || isoDay(date) !== value ? null : date;
}

/** Reads the filters off a request: `principal` (repeated or comma-separated), and a period as either `month=yyyy-MM` or `from` / `to`
 *  (yyyy-MM-dd, either may be left out). A month wins over from/to. */
export function parseGlobalAgeingFilters(params: URLSearchParams): { filters: GlobalAgeingFilters; error: string | null } {
  const principals = Array.from(new Set(params.getAll("principal").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean)));
  const month = (params.get("month") ?? "").trim();
  const fromText = (params.get("from") ?? "").trim();
  const toText = (params.get("to") ?? "").trim();
  let from: Date | null = null;
  let to: Date | null = null;
  if (month) {
    if (!MONTH_ONLY.test(month)) return { filters: NO_FILTERS, error: "The month must look like 2026-09." };
    const [year, monthNumber] = month.split("-").map(Number);
    from = new Date(Date.UTC(year, monthNumber - 1, 1));
    to = new Date(Date.UTC(year, monthNumber, 0));
  } else {
    if (fromText) {
      from = parseDay(fromText);
      if (!from) return { filters: NO_FILTERS, error: "The from date must look like 2026-09-01." };
    }
    if (toText) {
      to = parseDay(toText);
      if (!to) return { filters: NO_FILTERS, error: "The to date must look like 2026-09-30." };
    }
    if (from && to && from.getTime() > to.getTime()) return { filters: NO_FILTERS, error: "The from date is after the to date." };
  }
  return { filters: { principals, from, to }, error: null };
}

/** The filters in words, for the Excel report's cover sheet and the file name. */
export function describeFilters(filters: GlobalAgeingFilters): { principals: string; period: string; slug: string } {
  const principals = filters.principals.length === 0 ? "All principals" : filters.principals.join(", ");
  const period = filters.from && filters.to ? `${isoDay(filters.from)} to ${isoDay(filters.to)}` : filters.from ? `From ${isoDay(filters.from)}` : filters.to ? `Up to ${isoDay(filters.to)}` : "All dates";
  const parts: string[] = [];
  if (filters.principals.length > 0) parts.push(filters.principals.length === 1 ? filters.principals[0].toLowerCase().replace(/[^a-z0-9]+/g, "-") : `${filters.principals.length}-principals`);
  if (filters.from || filters.to) parts.push(`${filters.from ? isoDay(filters.from) : "start"}_${filters.to ? isoDay(filters.to) : "end"}`);
  return { principals, period, slug: parts.join("-") };
}

/** The live report is always "as of" the latest receivables sync - there is
 *  no historical per-customer open-item history to query a past date from
 *  (ReceivableOpenItem is a full-replace mirror of SAP's current state; only
 *  company-wide totals are kept historically, in ReceivablesAgeingSnapshot). */
export async function getGlobalAgeingReport(filters: GlobalAgeingFilters = NO_FILTERS): Promise<GlobalAgeingReport | null> {
  const latestRun = await prisma.receivablesSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
  if (!latestRun) return null;

  const [openItems, customers, cheques] = await Promise.all([
    prisma.receivableOpenItem.findMany({ select: { customerCode: true, taxDate: true, postingDate: true, openBalance: true } }),
    prisma.customerCreditProfile.findMany({ select: { customerCode: true, customerName: true, principal: true } }),
    prisma.receivablesPostDatedCheque.findMany({ select: { customerCode: true, paymentNo: true, chequeNumber: true, bankCode: true, dueDate: true, amount: true } }),
  ]);

  return buildGlobalAgeingReport(latestRun.sourceDate, openItems, customers, cheques, filters);
}
