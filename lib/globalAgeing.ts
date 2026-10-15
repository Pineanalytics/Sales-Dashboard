// "Global Ageing" — a per-customer, per-Principal aged-receivables report
// matching the business's own SAP B1 query (Future / Current month / 1-12
// months ago / Over 12 months ago, bucketed by JDT1.TaxDate against an as-of
// date). Distinct from the older days-past-due ageing in lib/receivables.ts
// and lib/receivablesAgeing.ts (Current/30/60/90/Over-90 off dueDate), which
// stay as they are — this is a new, separate view, not a replacement.
//
// "Property" in the source query is this business's Principal, resolved in
// SAP from OCRD's QryGroup1-64 flags joined to OCQG (see
// scripts/db-bridge/receivables/query.ts's PROPERTY_QUERY) — stored as
// CustomerCreditProfile.principal. PDQ Cheques (post-dated cheques held but
// not yet banked) has no source anywhere in SAP's open-item ledger or
// elsewhere already synced into this dashboard, so it is a manually
// maintained offset (ReceivablesPdqCheque), merged in here rather than
// computed.
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

export interface GlobalAgeingReport {
  asOf: string;
  /** 12 labels, index 0 = 1 month ago ... index 11 = 12 months ago (e.g. "Sep 2026"). */
  monthLabels: string[];
  currentMonthLabel: string;
  byPrincipal: GlobalAgeingPrincipalRow[];
  byCustomer: GlobalAgeingCustomerRow[];
  grandTotal: GlobalAgeingRow;
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

/** Calendar-month difference, asOf minus taxDate — 0 = same month, positive = taxDate in the past,
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
export interface GlobalAgeingPdqInput {
  customerCode: string;
  amount: number;
}

/** Pure builder — no DB access, so the bucketing math is directly testable.
 *  getGlobalAgeingReport() below is the thin DB-reading wrapper. */
export function buildGlobalAgeingReport(
  asOf: Date,
  openItems: GlobalAgeingOpenItemInput[],
  customers: GlobalAgeingCustomerInput[],
  pdqEntries: GlobalAgeingPdqInput[]
): GlobalAgeingReport {
  const customerByCode = new Map(customers.map((c) => [c.customerCode, c]));
  const pdqByCode = new Map(pdqEntries.map((p) => [p.customerCode, p.amount]));

  const bucketsByCustomer = new Map<string, GlobalAgeingBuckets>();
  for (const item of openItems) {
    let buckets = bucketsByCustomer.get(item.customerCode);
    if (!buckets) {
      buckets = emptyBuckets();
      bucketsByCustomer.set(item.customerCode, buckets);
    }
    // Falls back to postingDate for any row synced before taxDate was added.
    assignToBucket(buckets, asOf, item.taxDate ?? item.postingDate, item.openBalance);
  }

  const allCodes = new Set<string>([...bucketsByCustomer.keys(), ...pdqByCode.keys(), ...customerByCode.keys()]);

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
      principal: customer?.principal?.trim() || UNCLASSIFIED_PRINCIPAL,
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
    grandTotal,
  };
}

/** The live report is always "as of" the latest receivables sync — there is
 *  no historical per-customer open-item history to query a past date from
 *  (ReceivableOpenItem is a full-replace mirror of SAP's current state; only
 *  company-wide totals are kept historically, in ReceivablesAgeingSnapshot). */
export async function getGlobalAgeingReport(): Promise<GlobalAgeingReport | null> {
  const latestRun = await prisma.receivablesSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
  if (!latestRun) return null;

  const [openItems, customers, pdqEntries] = await Promise.all([
    prisma.receivableOpenItem.findMany({ select: { customerCode: true, taxDate: true, postingDate: true, openBalance: true } }),
    prisma.customerCreditProfile.findMany({ select: { customerCode: true, customerName: true, principal: true } }),
    prisma.receivablesPdqCheque.findMany({ select: { customerCode: true, amount: true } }),
  ]);

  return buildGlobalAgeingReport(latestRun.sourceDate, openItems, customers, pdqEntries);
}
