// Debt has no principal dimension anywhere in the receivables mirror
// (ReceivableOpenItem/CustomerCreditProfile are customer-only) — this
// reconstructs a per-principal view by cross-referencing BrandCustomerActual
// (customer x principal x revenue) over a trailing-12-month window, then
// prorating each customer's live outstanding balance across the principals
// they've actually bought from in that window. A customer with no matching
// purchase history in the window falls into an explicit "Unattributed"
// bucket rather than being silently dropped. Credit-limit-in-days is not
// re-derived per principal here — a customer's ageing/overdue status is
// already one company-wide fact (what they owe across all open items), and
// that same fact is what gets split across principals, matching the guideline's
// "the limits in days apply across all principals the customer has had
// sales in."
//
// Performance: BrandCustomerActual is the largest sales table (hundreds of
// thousands of rows). Only the trailing 12 months matter, so the window is
// applied and summed to (customer, principal) in the database, which returns a
// few thousand rows, instead of reading the whole table into memory. A
// customer's balance likewise comes from one grouped read of the open items
// rather than from a second build of the whole receivables dashboard.
import { prisma } from "@/lib/db";
import { normalizeCustomerName, normalizePrincipalKey } from "@/lib/normalize";

export interface PrincipalDebt {
  principal: string;
  debt: number;
  pctOfTotal: number;
}

export interface CustomerDebtBreakdown {
  customerCode: string;
  customerName: string;
  outstanding: number;
  byPrincipal: { principal: string; amount: number; sharePct: number }[];
}

export interface DebtAttribution {
  windowLabel: string;
  totalDebt: number;
  unattributedDebt: number;
  byPrincipal: PrincipalDebt[];
  customers: CustomerDebtBreakdown[];
}

const EMPTY: DebtAttribution = { windowLabel: "Trailing 12 months", totalDebt: 0, unattributedDebt: 0, byPrincipal: [], customers: [] };

/** The 12 calendar months ending at `asOf`'s month, inclusive, as { year, monthIndexes[] } groups (a window can span two years). */
export function trailing12MonthWindow(asOf: Date = new Date()): { year: string; monthIndexes: number[] }[] {
  const byYear = new Map<string, number[]>();
  let year = asOf.getUTCFullYear();
  let month = asOf.getUTCMonth();
  for (let i = 0; i < 12; i++) {
    byYear.set(String(year), [...(byYear.get(String(year)) ?? []), month]);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return Array.from(byYear.entries()).map(([windowYear, monthIndexes]) => ({ year: windowYear, monthIndexes }));
}

/** `includeCustomers: false` leaves out the per-customer breakdown, which only the Financials "Total outstanding"
 *  tab shows; the Finance Presentation needs just the totals and the per-principal split. */
export async function getDebtByPrincipal({ includeCustomers = true }: { includeCustomers?: boolean } = {}): Promise<DebtAttribution> {
  const latest = await prisma.receivablesSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
  if (!latest) return EMPTY;

  const [customerProfiles, owedRows, purchaseRows] = await Promise.all([
    prisma.customerCreditProfile.findMany({ select: { customerCode: true, customerName: true } }),
    prisma.receivableOpenItem.groupBy({ by: ["customerCode"], _sum: { openBalance: true } }),
    prisma.brandCustomerActual.groupBy({
      by: ["customerName", "principal"],
      where: { OR: trailing12MonthWindow().map((window) => ({ year: window.year, monthIndex: { in: window.monthIndexes } })) },
      _sum: { revenue: true },
    }),
  ]);
  const owedByCode = new Map(owedRows.map((row) => [row.customerCode, row._sum.openBalance ?? 0]));

  // normalized customer key -> normalized principal key -> { label, revenue }
  // NOTE: BrandCustomerActual.sapName is the raw SAP *salesperson* name (see
  // its schema comment), not a customer identifier — customerName is the
  // only field that actually identifies the buying customer, and it's the
  // same field lib/customerPortfolio.ts keys the /customers page off of.
  const revenueByCustomer = new Map<string, Map<string, { label: string; revenue: number }>>();
  for (const row of [...purchaseRows].sort((a, b) => a.principal.localeCompare(b.principal))) {
    const customerKey = normalizeCustomerName(row.customerName);
    if (!customerKey) continue;
    const principalKey = normalizePrincipalKey(row.principal);
    const byPrincipal = revenueByCustomer.get(customerKey) ?? new Map();
    const existing = byPrincipal.get(principalKey);
    byPrincipal.set(principalKey, { label: existing?.label ?? row.principal.split("-")[0].trim(), revenue: (existing?.revenue ?? 0) + (row._sum.revenue ?? 0) });
    revenueByCustomer.set(customerKey, byPrincipal);
  }

  const principalTotals = new Map<string, { label: string; debt: number }>();
  const customers: CustomerDebtBreakdown[] = [];
  let unattributedDebt = 0;
  let totalDebt = 0;

  for (const profile of customerProfiles) {
    const outstanding = owedByCode.get(profile.customerCode) ?? 0;
    totalDebt += outstanding;
    // Open items that net to nothing leave floating-point dust (about 1e-12), which is not a balance.
    if (Math.abs(outstanding) < 0.005) continue;
    const byPrincipal = revenueByCustomer.get(normalizeCustomerName(profile.customerName));
    if (!byPrincipal || byPrincipal.size === 0) {
      unattributedDebt += outstanding;
      if (includeCustomers) customers.push({ customerCode: profile.customerCode, customerName: profile.customerName, outstanding, byPrincipal: [] });
      continue;
    }
    const revenueTotal = Array.from(byPrincipal.values()).reduce((sum, v) => sum + v.revenue, 0);
    const breakdown = Array.from(byPrincipal.entries())
      .map(([principalKey, { label, revenue }]) => {
        const sharePct = revenueTotal > 0 ? (revenue / revenueTotal) * 100 : 0;
        const amount = outstanding * (revenueTotal > 0 ? revenue / revenueTotal : 0);
        const totals = principalTotals.get(principalKey) ?? { label, debt: 0 };
        totals.debt += amount;
        principalTotals.set(principalKey, totals);
        return { principal: label, amount, sharePct };
      })
      .sort((a, b) => b.amount - a.amount);
    if (includeCustomers) customers.push({ customerCode: profile.customerCode, customerName: profile.customerName, outstanding, byPrincipal: breakdown });
  }

  const byPrincipal: PrincipalDebt[] = Array.from(principalTotals.values())
    .map(({ label, debt }) => ({ principal: label, debt, pctOfTotal: totalDebt > 0 ? (debt / totalDebt) * 100 : 0 }))
    .sort((a, b) => b.debt - a.debt);

  if (unattributedDebt > 0) {
    byPrincipal.push({ principal: "Unattributed", debt: unattributedDebt, pctOfTotal: totalDebt > 0 ? (unattributedDebt / totalDebt) * 100 : 0 });
  }

  return {
    windowLabel: "Trailing 12 months",
    totalDebt,
    unattributedDebt,
    byPrincipal,
    customers: customers.sort((a, b) => b.outstanding - a.outstanding),
  };
}
