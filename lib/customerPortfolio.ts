import type { MonthlyBrandCustomerRow } from "./types";

export type CustomerTier = "Strategic" | "Growth" | "Long Tail" | "Adjustment";

export interface CustomerPortfolioRow {
  rank: number;
  customerName: string;
  principals: string[];
  brandCount: number;
  cases: number;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number | null;
  contributionPct: number | null;
  cumulativeContributionPct: number | null;
  tier: CustomerTier;
  latestMonthRevenue: number;
  previousMonthRevenue: number;
  momGrowthPct: number | null;
  priorYearRevenue: number;
  yoyGrowthPct: number | null;
}

export interface PortfolioDimensionRow {
  name: string;
  revenue: number;
  grossProfit: number;
  cases: number;
  grossMarginPct: number | null;
  contributionPct: number | null;
}

export interface CustomerPortfolioSummary {
  totals: {
    revenue: number;
    grossProfit: number;
    cases: number;
    grossMarginPct: number | null;
    customerCount: number;
    averageRevenuePerCustomer: number;
    topTenSharePct: number | null;
    priorYearRevenue: number;
    yoyGrowthPct: number | null;
    lyspRevenue: number | null;
    vsLyspGrowthPct: number | null;
    latestMonthRevenue: number;
    previousMonthRevenue: number;
    previousFullMonthRevenue: number;
    momGrowthPct: number | null;
    comparisonDay: number | null;
    retainedCustomers: number;
    newCustomers: number;
    lapsedCustomers: number;
  };
  tierSummary: Array<{ tier: CustomerTier; customerCount: number; revenue: number; revenueSharePct: number | null }>;
  customers: CustomerPortfolioRow[];
  brands: PortfolioDimensionRow[];
  principals: PortfolioDimensionRow[];
}

interface CustomerAccumulator {
  customerName: string;
  principals: Set<string>;
  brands: Set<string>;
  cases: number;
  revenue: number;
  grossProfit: number;
}

function customerKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleUpperCase();
}

function growth(current: number, comparison: number) {
  return comparison > 0 ? ((current - comparison) / comparison) * 100 : null;
}

export interface CanonicalPortfolioComparisons {
  revenue: number;
  priorYearRevenue: number;
  lyspRevenue: number | null;
  latestMonthRevenue: number;
  previousMonthRevenue: number;
  previousFullMonthRevenue: number;
  comparisonDay: number | null;
}

/** Keeps customer ranking/detail at SAP customer grain while anchoring headline
 * revenue comparisons to the canonical SAP principal/month and day facts. */
export function applyCanonicalPortfolioComparisons(
  portfolio: CustomerPortfolioSummary,
  comparisons: CanonicalPortfolioComparisons
): CustomerPortfolioSummary {
  return {
    ...portfolio,
    totals: {
      ...portfolio.totals,
      revenue: comparisons.revenue,
      priorYearRevenue: comparisons.priorYearRevenue,
      yoyGrowthPct: growth(comparisons.revenue, comparisons.priorYearRevenue),
      lyspRevenue: comparisons.lyspRevenue,
      vsLyspGrowthPct: comparisons.lyspRevenue === null ? null : growth(comparisons.revenue, comparisons.lyspRevenue),
      latestMonthRevenue: comparisons.latestMonthRevenue,
      previousMonthRevenue: comparisons.previousMonthRevenue,
      previousFullMonthRevenue: comparisons.previousFullMonthRevenue,
      momGrowthPct: growth(comparisons.latestMonthRevenue, comparisons.previousMonthRevenue),
      comparisonDay: comparisons.comparisonDay,
    },
  };
}

function customerMap(rows: MonthlyBrandCustomerRow[]) {
  const map = new Map<string, CustomerAccumulator>();
  for (const row of rows) {
    const key = customerKey(row.customerName || "Unspecified customer");
    const current = map.get(key) ?? {
      customerName: row.customerName.trim() || "Unspecified customer",
      principals: new Set<string>(),
      brands: new Set<string>(),
      cases: 0,
      revenue: 0,
      grossProfit: 0,
    };
    current.principals.add(row.principal);
    if (row.brand?.trim()) current.brands.add(row.brand.trim());
    current.cases += row.cases;
    current.revenue += row.revenue;
    current.grossProfit += row.grossProfit;
    map.set(key, current);
  }
  return map;
}

function dimension(rows: MonthlyBrandCustomerRow[], key: "brand" | "principal", totalRevenue: number) {
  const map = new Map<string, { revenue: number; grossProfit: number; cases: number }>();
  for (const row of rows) {
    const name = (key === "brand" ? row.brand : row.principal)?.trim() || (key === "brand" ? "Unspecified product" : "Unspecified principal");
    const current = map.get(name) ?? { revenue: 0, grossProfit: 0, cases: 0 };
    current.revenue += row.revenue;
    current.grossProfit += row.grossProfit;
    current.cases += row.cases;
    map.set(name, current);
  }
  return [...map.entries()].map(([name, value]) => ({
    name,
    ...value,
    grossMarginPct: value.revenue > 0 ? (value.grossProfit / value.revenue) * 100 : null,
    contributionPct: totalRevenue !== 0 ? (value.revenue / totalRevenue) * 100 : null,
  })).sort((a, b) => b.revenue - a.revenue);
}

/** Customer identity is case/whitespace-normalized but punctuation is preserved;
 * this avoids obvious duplicates without pretending that similarly named SAP
 * accounts are the same customer. Tiers use positive selected-period revenue only. */
export function summarizeCustomerPortfolio({
  currentRows,
  latestMonthRows,
  previousMonthRows,
  priorYearRows,
}: {
  currentRows: MonthlyBrandCustomerRow[];
  latestMonthRows: MonthlyBrandCustomerRow[];
  previousMonthRows: MonthlyBrandCustomerRow[];
  priorYearRows: MonthlyBrandCustomerRow[];
}): CustomerPortfolioSummary {
  const current = customerMap(currentRows);
  const latest = customerMap(latestMonthRows);
  const previous = customerMap(previousMonthRows);
  const priorYear = customerMap(priorYearRows);
  const revenue = currentRows.reduce((sum, row) => sum + row.revenue, 0);
  const positiveRevenue = [...current.values()].reduce((sum, row) => sum + Math.max(0, row.revenue), 0);
  let runningPositiveRevenue = 0;

  const customers = [...current.entries()]
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .map(([key, row], index): CustomerPortfolioRow => {
      const priorCumulative = positiveRevenue > 0 ? (runningPositiveRevenue / positiveRevenue) * 100 : 0;
      if (row.revenue > 0) runningPositiveRevenue += row.revenue;
      const cumulative = positiveRevenue > 0 && row.revenue > 0 ? (runningPositiveRevenue / positiveRevenue) * 100 : null;
      const tier: CustomerTier = row.revenue <= 0 ? "Adjustment" : priorCumulative < 80 ? "Strategic" : priorCumulative < 95 ? "Growth" : "Long Tail";
      const latestRevenue = latest.get(key)?.revenue ?? 0;
      const previousRevenue = previous.get(key)?.revenue ?? 0;
      const priorYearRevenue = priorYear.get(key)?.revenue ?? 0;
      return {
        rank: index + 1,
        customerName: row.customerName,
        principals: [...row.principals].sort(),
        brandCount: row.brands.size,
        cases: row.cases,
        revenue: row.revenue,
        grossProfit: row.grossProfit,
        grossMarginPct: row.revenue > 0 ? (row.grossProfit / row.revenue) * 100 : null,
        contributionPct: revenue !== 0 ? (row.revenue / revenue) * 100 : null,
        cumulativeContributionPct: cumulative,
        tier,
        latestMonthRevenue: latestRevenue,
        previousMonthRevenue: previousRevenue,
        momGrowthPct: growth(latestRevenue, previousRevenue),
        priorYearRevenue,
        yoyGrowthPct: growth(row.revenue, priorYearRevenue),
      };
    });

  const grossProfit = currentRows.reduce((sum, row) => sum + row.grossProfit, 0);
  const cases = currentRows.reduce((sum, row) => sum + row.cases, 0);
  const latestRevenue = latestMonthRows.reduce((sum, row) => sum + row.revenue, 0);
  const previousRevenue = previousMonthRows.reduce((sum, row) => sum + row.revenue, 0);
  const priorRevenue = priorYearRows.reduce((sum, row) => sum + row.revenue, 0);
  const topTenRevenue = customers.slice(0, 10).reduce((sum, row) => sum + row.revenue, 0);
  const currentLatestKeys = new Set([...latest.entries()].filter(([, row]) => row.revenue > 0).map(([key]) => key));
  const previousKeys = new Set([...previous.entries()].filter(([, row]) => row.revenue > 0).map(([key]) => key));
  const tiers: CustomerTier[] = ["Strategic", "Growth", "Long Tail", "Adjustment"];

  return {
    totals: {
      revenue,
      grossProfit,
      cases,
      grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : null,
      customerCount: current.size,
      averageRevenuePerCustomer: current.size > 0 ? revenue / current.size : 0,
      topTenSharePct: revenue > 0 ? (topTenRevenue / revenue) * 100 : null,
      priorYearRevenue: priorRevenue,
      yoyGrowthPct: growth(revenue, priorRevenue),
      lyspRevenue: null,
      vsLyspGrowthPct: null,
      latestMonthRevenue: latestRevenue,
      previousMonthRevenue: previousRevenue,
      previousFullMonthRevenue: previousRevenue,
      momGrowthPct: growth(latestRevenue, previousRevenue),
      comparisonDay: null,
      retainedCustomers: [...currentLatestKeys].filter((key) => previousKeys.has(key)).length,
      newCustomers: [...currentLatestKeys].filter((key) => !previousKeys.has(key)).length,
      lapsedCustomers: [...previousKeys].filter((key) => !currentLatestKeys.has(key)).length,
    },
    tierSummary: tiers.map((tier) => {
      const rows = customers.filter((customer) => customer.tier === tier);
      const tierRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
      return { tier, customerCount: rows.length, revenue: tierRevenue, revenueSharePct: revenue !== 0 ? (tierRevenue / revenue) * 100 : null };
    }),
    customers,
    brands: dimension(currentRows, "brand", revenue),
    principals: dimension(currentRows, "principal", revenue),
  };
}
