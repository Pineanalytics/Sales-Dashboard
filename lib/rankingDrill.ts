import type { MonthlyBrandCustomerRow } from "./types";

export interface RankingDrillRow {
  name: string;
  cases: number;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number | null;
}

export interface RankingDrillSummary {
  totals: {
    revenue: number;
    grossProfit: number;
    cases: number;
    customerCount: number;
    repCount: number;
    brandCount: number;
    topFiveCustomerSharePct: number | null;
  };
  customers: RankingDrillRow[];
  reps: RankingDrillRow[];
  brands: RankingDrillRow[];
  principals: RankingDrillRow[];
}

type DrillDimension = "customerName" | "salesEmployee" | "brand" | "principal";

function summarizeDimension(rows: MonthlyBrandCustomerRow[], dimension: DrillDimension, fallback: string) {
  const grouped = new Map<string, Omit<RankingDrillRow, "name" | "grossMarginPct">>();
  for (const row of rows) {
    const raw = dimension === "brand" ? row.brand : row[dimension];
    const name = raw?.trim() || fallback;
    const current = grouped.get(name) ?? { cases: 0, revenue: 0, grossProfit: 0 };
    current.cases += row.cases;
    current.revenue += row.revenue;
    current.grossProfit += row.grossProfit;
    grouped.set(name, current);
  }
  return [...grouped.entries()]
    .map(([name, values]) => ({
      name,
      ...values,
      grossMarginPct: values.revenue > 0 ? (values.grossProfit / values.revenue) * 100 : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** Builds the compact payload used by the full-screen hierarchy drill. Raw SAP
 * customer/product rows stay on the server; the browser receives only bounded,
 * decision-ready aggregates and therefore does not lock up on portfolio scope. */
export function summarizeRankingDrill(rows: MonthlyBrandCustomerRow[]): RankingDrillSummary {
  const customers = summarizeDimension(rows, "customerName", "Unspecified customer");
  const reps = summarizeDimension(rows, "salesEmployee", "Unspecified sales rep");
  const brands = summarizeDimension(rows, "brand", "Unspecified product");
  const principals = summarizeDimension(rows, "principal", "Unspecified principal");
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const grossProfit = rows.reduce((sum, row) => sum + row.grossProfit, 0);
  const cases = rows.reduce((sum, row) => sum + row.cases, 0);
  const topFiveCustomerRevenue = customers.slice(0, 5).reduce((sum, row) => sum + row.revenue, 0);

  return {
    totals: {
      revenue,
      grossProfit,
      cases,
      customerCount: customers.length,
      repCount: reps.length,
      brandCount: brands.length,
      topFiveCustomerSharePct: revenue > 0 ? (topFiveCustomerRevenue / revenue) * 100 : null,
    },
    customers: customers.slice(0, 25),
    reps: reps.slice(0, 25),
    brands: brands.slice(0, 25),
    principals,
  };
}
