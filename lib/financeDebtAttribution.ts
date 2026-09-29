// Debt has no principal dimension anywhere in the receivables mirror
// (ReceivableOpenItem/CustomerCreditProfile are customer-only) — this
// reconstructs a per-principal view by cross-referencing BrandCustomerActual
// (customer x principal x revenue) over a trailing-12-month window, then
// prorating each customer's live outstanding balance across the principals
// they've actually bought from in that window. A customer with no matching
// purchase history in the window falls into an explicit "Unattributed"
// bucket rather than being silently dropped. Credit-limit-in-days is not
// re-derived per principal here — a customer's ageing/overdue status is
// already one company-wide fact (from getReceivablesDashboard), and that
// same fact is what gets split across principals, matching the guideline's
// "the limits in days apply across all principals the customer has had
// sales in."
import { prisma } from "@/lib/db";
import { normalizeCustomerName, normalizePrincipalKey } from "@/lib/normalize";
import { getReceivablesDashboard } from "@/lib/receivables";

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

/** {year, monthIndex} keys for the 12 calendar months ending at `asOf`'s month, inclusive. */
function trailing12MonthKeys(asOf: Date = new Date()): Set<string> {
  const keys = new Set<string>();
  let year = asOf.getUTCFullYear();
  let month = asOf.getUTCMonth();
  for (let i = 0; i < 12; i++) {
    keys.add(`${year}|${month}`);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return keys;
}

export async function getDebtByPrincipal(): Promise<DebtAttribution> {
  const receivables = await getReceivablesDashboard();
  if (!receivables) return EMPTY;

  const keys = trailing12MonthKeys();
  const purchaseRows = await prisma.brandCustomerActual.findMany({
    select: { year: true, monthIndex: true, principal: true, customerName: true, revenue: true },
  });

  // normalized customer key -> normalized principal key -> { label, revenue }
  // NOTE: BrandCustomerActual.sapName is the raw SAP *salesperson* name (see
  // its schema comment), not a customer identifier — customerName is the
  // only field that actually identifies the buying customer, and it's the
  // same field lib/customerPortfolio.ts keys the /customers page off of.
  const revenueByCustomer = new Map<string, Map<string, { label: string; revenue: number }>>();
  for (const row of purchaseRows) {
    if (!keys.has(`${row.year}|${row.monthIndex}`)) continue;
    const customerKey = normalizeCustomerName(row.customerName);
    if (!customerKey) continue;
    const principalKey = normalizePrincipalKey(row.principal);
    const byPrincipal = revenueByCustomer.get(customerKey) ?? new Map();
    const existing = byPrincipal.get(principalKey);
    byPrincipal.set(principalKey, { label: existing?.label ?? row.principal.split("-")[0].trim(), revenue: (existing?.revenue ?? 0) + row.revenue });
    revenueByCustomer.set(customerKey, byPrincipal);
  }

  const principalTotals = new Map<string, { label: string; debt: number }>();
  const customers: CustomerDebtBreakdown[] = [];
  let unattributedDebt = 0;
  let totalDebt = 0;

  for (const customer of receivables.customers) {
    totalDebt += customer.outstanding;
    if (customer.outstanding === 0) continue;
    const byPrincipal = revenueByCustomer.get(normalizeCustomerName(customer.name));
    if (!byPrincipal || byPrincipal.size === 0) {
      unattributedDebt += customer.outstanding;
      customers.push({ customerCode: customer.code, customerName: customer.name, outstanding: customer.outstanding, byPrincipal: [] });
      continue;
    }
    const revenueTotal = Array.from(byPrincipal.values()).reduce((sum, v) => sum + v.revenue, 0);
    const breakdown = Array.from(byPrincipal.entries())
      .map(([principalKey, { label, revenue }]) => {
        const sharePct = revenueTotal > 0 ? (revenue / revenueTotal) * 100 : 0;
        const amount = customer.outstanding * (revenueTotal > 0 ? revenue / revenueTotal : 0);
        const totals = principalTotals.get(principalKey) ?? { label, debt: 0 };
        totals.debt += amount;
        principalTotals.set(principalKey, totals);
        return { principal: label, amount, sharePct };
      })
      .sort((a, b) => b.amount - a.amount);
    customers.push({ customerCode: customer.code, customerName: customer.name, outstanding: customer.outstanding, byPrincipal: breakdown });
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
