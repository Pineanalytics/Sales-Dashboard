// The ~10 downloadable reports shown on /reports, one per analytics page. Every
// dataset-backed report calls the exact same selector/summarizer functions that
// already power the live view (lib/timeIntelligence.ts, lib/selectors.ts) — the
// numbers in a downloaded report are guaranteed to match what's on screen for the
// same period/principal filter, since nothing here recomputes anything independently.
import type { Dataset } from "@/lib/types";
import type { PageKey } from "@/lib/pageAccess";
import type { PeriodSelection } from "@/lib/timeIntelligence";
import type { ReceivablesDashboard } from "@/lib/receivables";
import {
  summarizeSalesForPeriod,
  summarizeSalesByPrincipal,
  summarizeCoverageForPeriod,
  summarizeCoverageByRep,
  summarizePLForPeriod,
  summarizePLByPrincipal,
  summarizePLByAccount,
  summarizeBrandCustomerByRep,
  resolvePeriodMonths,
} from "@/lib/timeIntelligence";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { aggregateStockByPrincipal, stockPrincipalStatuses, sumStockRollups } from "@/lib/stock";
import { STOCK_EXTRACT_ITEM_COLUMNS, STOCK_EXTRACT_PRINCIPAL_COLUMNS, buildStockExtract, formatExtractDate } from "@/lib/stockExtract";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { CustomerPortfolioSummary } from "@/lib/customerPortfolio";
import type { ReportContent } from "./types";

export interface ReportContext {
  dataset: Dataset | null;
  period: PeriodSelection;
  principalKey: string | null;
  /** Free-text, case-insensitive substring match against whichever rep-name field a
   *  report's rows carry — never a strict equality, since Pine (field-force) and SAP
   *  (finance) source systems spell the same rep's name differently. null/"" = no filter.
   *  Reports with no rep dimension (Sales, Profitability, Stock, Time Intelligence,
   *  Customers) ignore it. */
  repFilter: string | null;
  periodLabel: string;
}

/** Case-insensitive substring match — see ReportContext.repFilter. */
function matchesRep(name: string | null | undefined, repFilter: string | null): boolean {
  if (!repFilter) return true;
  if (!name) return false;
  return name.toLowerCase().includes(repFilter.toLowerCase());
}

/** Every (year, monthIndex) the selected period covers, as `"year|monthIndex"` keys —
 *  for filtering already-fetched rows that carry their own year/monthIndex (bridge
 *  reports' monthly-grain sections) without re-deriving the period logic. */
function periodMonthKeys(period: PeriodSelection): Set<string> {
  return new Set(resolvePeriodMonths(period).map((m) => `${m.year}|${m.monthIndex}`));
}

/** Translates the selected period into a concrete [from, to] calendar-day span — for
 *  filtering bridge rows that carry a day-level `date` (Timestamps, JP Adherence daily)
 *  rather than their own year/monthIndex. Returns null if the period resolves to zero
 *  months (nothing to filter against — callers should skip range filtering, not empty
 *  every row). */
function dateBoundsForPeriod(period: PeriodSelection): { from: Date; to: Date } | null {
  const months = resolvePeriodMonths(period);
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => (a.year === b.year ? a.monthIndex - b.monthIndex : Number(a.year) - Number(b.year)));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    from: new Date(Number(first.year), first.monthIndex, 1),
    to: new Date(Number(last.year), last.monthIndex + 1, 0, 23, 59, 59, 999),
  };
}

export interface ReportDefinition {
  key: string;
  label: string;
  description: string;
  pageKey: PageKey;
  build: (ctx: ReportContext) => Promise<ReportContent>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyReport(title: string): ReportContent {
  return { title, generatedAt: new Date(), sections: [] };
}

// ---------------------------------------------------------------------------
// Dataset-backed reports
// ---------------------------------------------------------------------------

const salesReport: ReportDefinition = {
  key: "sales",
  label: "Sales Performance",
  description: "Revenue vs Target by principal for the current period.",
  pageKey: "sales",
  async build({ dataset, period, principalKey, periodLabel }) {
    if (!dataset) return emptyReport("Sales Performance");
    const current = summarizeSalesForPeriod(dataset, period, principalKey);
    const byPrincipal = principalsByRevenueDesc(dataset, period);

    return {
      title: `Sales Performance — ${periodLabel}`,
      generatedAt: new Date(),
      summary: [
        { label: "Revenue", value: current.revenue.toLocaleString() },
        { label: "Target", value: current.target !== null ? current.target.toLocaleString() : "N/A" },
        { label: "Achievement %", value: current.achievementPct !== null ? `${current.achievementPct}%` : "N/A" },
        { label: "Gross Profit", value: current.grossProfit.toLocaleString() },
        { label: "Gross Margin %", value: current.grossMarginPct !== null ? `${current.grossMarginPct}%` : "N/A" },
      ],
      sections: [
        {
          title: "By Principal",
          columns: ["Principal", "Revenue", "Target", "Achievement %", "Gross Profit", "Margin %"],
          rows: byPrincipal.map((p) => [
            p.principal,
            round2(p.revenue),
            p.target !== null ? round2(p.target) : "N/A",
            p.achievementPct !== null ? p.achievementPct : "N/A",
            round2(p.grossProfit),
            p.grossMarginPct !== null ? p.grossMarginPct : "N/A",
          ]),
        },
      ],
    };
  },
};

const coverageReport: ReportDefinition = {
  key: "coverage",
  label: "Coverage & Productivity",
  description: "Outlet coverage and call productivity by rep for the current period.",
  pageKey: "coverage",
  async build({ dataset, period, principalKey, periodLabel, repFilter }) {
    if (!dataset) return emptyReport("Coverage & Productivity");
    const current = summarizeCoverageForPeriod(dataset, period, principalKey);
    const byRep = summarizeCoverageByRep(dataset, period, principalKey)
      .filter((r) => matchesRep(r.employeeName, repFilter))
      .sort((a, b) => b.coverage - a.coverage);

    return {
      title: `Coverage & Productivity — ${periodLabel}`,
      generatedAt: new Date(),
      summary: [
        { label: "Coverage", value: current.coverage.toLocaleString() },
        { label: "Productive Calls", value: current.productiveCalls.toLocaleString() },
        { label: "Productivity %", value: `${current.productivityPct}%` },
      ],
      sections: [
        {
          title: "By Rep",
          columns: ["Rep", "Role", "Coverage", "Productive Calls", "Productivity %"],
          rows: byRep.map((r) => [r.employeeName, r.salesRole, r.coverage, r.productiveCalls, r.productivityPct]),
        },
      ],
    };
  },
};

const profitabilityReport: ReportDefinition = {
  key: "profitability",
  label: "Profitability",
  description: "P&L by principal and account for the current period.",
  pageKey: "profitability",
  async build({ dataset, period, principalKey, periodLabel }) {
    if (!dataset) return emptyReport("Profitability");
    const current = summarizePLForPeriod(dataset, period, principalKey);
    const byPrincipal = Array.from(summarizePLByPrincipal(dataset, period).values()).sort((a, b) => b.revenue - a.revenue);
    const byAccount = summarizePLByAccount(dataset, period, principalKey).sort((a, b) => b.amount - a.amount);

    return {
      title: `Profitability — ${periodLabel}`,
      generatedAt: new Date(),
      summary: [
        { label: "Revenue", value: current.revenue.toLocaleString() },
        { label: "COGS", value: current.cogs.toLocaleString() },
        { label: "Gross Profit", value: current.grossProfit.toLocaleString() },
        { label: "Total Income", value: current.totalIncome.toLocaleString() },
        { label: "Expenses", value: current.expenses.toLocaleString() },
        { label: "Net Profit", value: current.netProfit.toLocaleString() },
        { label: "Net Margin %", value: current.netMarginPct !== null ? `${current.netMarginPct}%` : "N/A" },
      ],
      sections: [
        {
          title: "By Principal",
          columns: ["Principal", "Revenue", "COGS", "Gross Profit", "Net Profit", "Net Margin %"],
          rows: byPrincipal.map((p) => [
            p.principal,
            round2(p.revenue),
            round2(p.cogs),
            round2(p.grossProfit),
            round2(p.netProfit),
            p.netMarginPct !== null ? p.netMarginPct : "N/A",
          ]),
        },
        {
          title: "By Account",
          columns: ["Account Code", "Account Name", "Line Type", "Amount"],
          rows: byAccount.map((a) => [a.accountCode, a.accountName, a.lineType, round2(a.amount)]),
        },
      ],
    };
  },
};

const stockReport: ReportDefinition = {
  key: "stock",
  label: "Stock Balance",
  description: "Every SKU with its stock, last sale and period of inactivity, with each SKU and principal marked active or dormant.",
  pageKey: "stock",
  async build({ dataset, principalKey }) {
    if (!dataset) return emptyReport("Stock Balance");

    // The extract lists EVERY SKU, including the stock of dormant principals and the zero-stock SKUs the screen leaves
    // out, because it is a record of what is on the shelves and what has stopped moving. Principals are marked Active or
    // Inactive and SKUs Active or Dormant, with the period of inactivity, so the operational view (which leaves
    // Inactive principals out) can be reproduced by filtering the status columns. See lib/stockExtract.ts.
    // Stock has no location split - like StockView.tsx, roll up by normalized brand key.
    const brandKey = principalKey ? normalizePrincipalKey(principalKey) : null;
    const filteredItems = brandKey ? dataset.stockItems.filter((i) => i.key === brandKey) : dataset.stockItems;
    const extract = buildStockExtract(dataset, { brandKey });
    const statusByKey = stockPrincipalStatuses(dataset);
    const statusOf = (key: string) => statusByKey.get(key) ?? "Active";

    const rollups = aggregateStockByPrincipal({ ...dataset, stockItems: filteredItems });
    const active = sumStockRollups(rollups.filter((r) => statusOf(r.key) === "Active"));
    const inactive = sumStockRollups(rollups.filter((r) => statusOf(r.key) === "Inactive"));
    const all = sumStockRollups(rollups);

    return {
      title: brandKey ? `Stock Balance — ${principalKey}` : "Stock Balance",
      generatedAt: new Date(),
      summary: [
        { label: "Stock as at", value: formatExtractDate(extract.asOf) },
        { label: "Total Value (all stock held)", value: all.value.toLocaleString() },
        { label: "Active Principals — Value", value: active.value.toLocaleString() },
        { label: "Inactive Principals — Value", value: inactive.value.toLocaleString() },
        { label: "Total Volume", value: all.volume.toLocaleString() },
        { label: "Item Count", value: all.itemCount.toLocaleString() },
        { label: "SKUs listed (all)", value: extract.skuCounts.total.toLocaleString() },
        { label: "Active SKUs (sold in last 3 months)", value: extract.skuCounts.active.toLocaleString() },
        { label: "Dormant SKUs (no sale in 3 months)", value: extract.skuCounts.dormant.toLocaleString() },
        { label: "Out of Stock (active principals)", value: active.outOfStockCount.toLocaleString() },
        { label: "Running Out (active principals)", value: active.runningOutCount.toLocaleString() },
        { label: "OK (active principals)", value: active.okCount.toLocaleString() },
      ],
      sections: [
        { title: "Stock Items", columns: STOCK_EXTRACT_ITEM_COLUMNS, rows: extract.itemRows },
        { title: "By Principal", columns: STOCK_EXTRACT_PRINCIPAL_COLUMNS, rows: extract.principalRows },
      ],
    };
  },
};

const timeIntelligenceReport: ReportDefinition = {
  key: "time-intelligence",
  label: "Time Intelligence",
  description: "Monthly revenue trend against target, for the selected date range.",
  pageKey: "time-intelligence",
  async build({ dataset, principalKey, period, periodLabel }) {
    if (!dataset) return emptyReport("Time Intelligence");
    const monthKeys = periodMonthKeys(period);
    const rows = dataset.monthlySales.filter(
      (r) => monthKeys.has(`${r.year}|${r.monthIndex}`) && (!principalKey || r.principal === principalKey)
    );

    const byMonth = new Map<string, { year: string; month: string; monthIndex: number; revenue: number; target: number; hasTarget: boolean; grossProfit: number }>();
    for (const r of rows) {
      const key = `${r.year}-${String(r.monthIndex).padStart(2, "0")}`;
      const existing = byMonth.get(key);
      if (existing) {
        existing.revenue += r.revenue;
        existing.grossProfit += r.grossProfit;
        if (r.target !== null) {
          existing.target += r.target;
          existing.hasTarget = true;
        }
      } else {
        byMonth.set(key, { year: r.year, month: r.month, monthIndex: r.monthIndex, revenue: r.revenue, grossProfit: r.grossProfit, target: r.target ?? 0, hasTarget: r.target !== null });
      }
    }
    const sorted = Array.from(byMonth.values()).sort((a, b) => (a.year === b.year ? a.monthIndex - b.monthIndex : a.year < b.year ? -1 : 1));

    return {
      title: `Time Intelligence — Monthly Trend (${periodLabel})`,
      generatedAt: new Date(),
      sections: [
        {
          title: "Monthly Trend",
          columns: ["Year", "Month", "Revenue", "Target", "Achievement %", "Gross Profit"],
          rows: sorted.map((m) => [
            m.year,
            m.month,
            round2(m.revenue),
            m.hasTarget ? round2(m.target) : "N/A",
            m.hasTarget && m.target > 0 ? round2((m.revenue / m.target) * 100) : "N/A",
            round2(m.grossProfit),
          ]),
        },
      ],
    };
  },
};

const repsReport: ReportDefinition = {
  key: "reps",
  label: "Rep Performance",
  description: "Coverage and revenue by rep for the current period.",
  pageKey: "reps",
  async build({ dataset, period, principalKey, periodLabel, repFilter }) {
    if (!dataset) return emptyReport("Rep Performance");
    const coverageByRep = summarizeCoverageByRep(dataset, period, principalKey)
      .filter((r) => matchesRep(r.employeeName, repFilter))
      .sort((a, b) => b.coverage - a.coverage);
    const revenueByRep = summarizeBrandCustomerByRep(dataset, period, principalKey)
      .filter((r) => matchesRep(r.salesEmployee, repFilter))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      title: `Rep Performance — ${periodLabel}`,
      generatedAt: new Date(),
      sections: [
        {
          title: "Coverage by Rep",
          columns: ["Rep", "Role", "Coverage", "Productive Calls", "Productivity %"],
          rows: coverageByRep.map((r) => [r.employeeName, r.salesRole, r.coverage, r.productiveCalls, r.productivityPct]),
        },
        {
          title: "Revenue by Rep",
          columns: ["Rep", "Cases", "Revenue", "Gross Profit", "Margin %"],
          rows: revenueByRep.map((r) => [r.salesEmployee, round2(r.cases), round2(r.revenue), round2(r.grossProfit), r.grossMarginPct !== null ? r.grossMarginPct : "N/A"]),
        },
      ],
    };
  },
};

/** The brand/customer rows are not part of the in-browser dataset (they load on demand, per period and principal), so
 *  this report reads the same on-demand portfolio the Customers page does. What it lists is what the page shows. */
async function fetchCustomerPortfolio(period: PeriodSelection, principalKey: string | null): Promise<CustomerPortfolioSummary> {
  const months = resolvePeriodMonths(period);
  const ym = (year: string, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const params = new URLSearchParams();
  for (const m of months) params.append("period", ym(m.year, m.monthIndex));
  const latest = months[months.length - 1];
  if (latest) {
    params.append("latestPeriod", ym(latest.year, latest.monthIndex));
    params.append("previousPeriod", latest.monthIndex === 0 ? ym(String(Number(latest.year) - 1), 11) : ym(latest.year, latest.monthIndex - 1));
  }
  for (const m of months) params.append("priorYearPeriod", ym(String(Number(m.year) - 1), m.monthIndex));
  if (principalKey) params.append("principal", principalKey);
  const response = await fetch(`/api/customer-portfolio?${params.toString()}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Failed to load customer portfolio.");
  return body.portfolio as CustomerPortfolioSummary;
}

const pctCell = (n: number | null): string | number => (n === null ? "N/A" : round2(n));

const customersReport: ReportDefinition = {
  key: "customers",
  label: "Customers & Brands",
  description: "Customer ranking and tiering, brands and products, and principals for the current period. For the full raw-data extracts use the Brand and Customer extract buttons on the Customers page.",
  pageKey: "customers",
  async build({ period, principalKey, periodLabel }) {
    const portfolio = await fetchCustomerPortfolio(period, principalKey);
    const { totals } = portfolio;

    return {
      title: `Customers & Brands — ${periodLabel}`,
      generatedAt: new Date(),
      summary: [
        { label: "Revenue", value: round2(totals.revenue).toLocaleString() },
        { label: "Cases", value: round2(totals.cases).toLocaleString() },
        { label: "Gross Profit", value: round2(totals.grossProfit).toLocaleString() },
        { label: "Gross Margin %", value: totals.grossMarginPct !== null ? `${round2(totals.grossMarginPct)}%` : "N/A" },
        { label: "Buying Customers", value: totals.customerCount.toLocaleString() },
        { label: "Top 10 Customer Share %", value: totals.topTenSharePct !== null ? `${round2(totals.topTenSharePct)}%` : "N/A" },
      ],
      sections: [
        {
          title: "Customer Ranking",
          columns: ["Rank", "Customer", "Tier", "Principal(s)", "Products", "Cases", "Revenue", "Gross Profit", "Margin %", "Contribution %", "Cumulative %", "YoY Growth %"],
          rows: portfolio.customers.map((c) => [c.rank, c.customerName, c.tier, c.principals.join(", "), c.brandCount, round2(c.cases), round2(c.revenue), round2(c.grossProfit), pctCell(c.grossMarginPct), pctCell(c.contributionPct), pctCell(c.cumulativeContributionPct), pctCell(c.yoyGrowthPct)]),
        },
        {
          title: "Brands & Products",
          columns: ["Brand / Product", "Cases", "Revenue", "Gross Profit", "Margin %", "Contribution %"],
          rows: portfolio.brands.map((b) => [b.name, round2(b.cases), round2(b.revenue), round2(b.grossProfit), pctCell(b.grossMarginPct), pctCell(b.contributionPct)]),
        },
        {
          title: "By Principal",
          columns: ["Principal", "Cases", "Revenue", "Gross Profit", "Margin %", "Contribution %"],
          rows: portfolio.principals.map((p) => [p.name, round2(p.cases), round2(p.revenue), round2(p.grossProfit), pctCell(p.grossMarginPct), pctCell(p.contributionPct)]),
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Bridge-backed reports — fetch their own data client-side (not part of the
// Zustand `dataset`), same pattern each corresponding page already uses.
// ---------------------------------------------------------------------------

interface ActiveOutletRow {
  principal: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  salesRole: string;
  timesBought: number;
  purchaseDays: number;
  sales: number;
  frequencyBand: string;
  mostRecentRep: string | null;
}
interface ActiveOutletMonthlyRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  salesRole: string;
  distinctOutlets: number;
  transactions: number;
  sales: number;
}

const activeOutletsReport: ReportDefinition = {
  key: "active-outlets",
  label: "Active Outlets",
  description: "Outlet-level purchase activity, year-to-date.",
  pageKey: "active-outlets",
  async build({ period, principalKey, repFilter }) {
    const res = await fetch("/api/active-outlets", { cache: "no-store" });
    if (!res.ok) return emptyReport("Active Outlets");
    const body = (await res.json()) as { outlets: ActiveOutletRow[]; monthly: ActiveOutletMonthlyRow[] };

    // Outlets have no per-row date, so Range only narrows the Monthly Trend section.
    const monthKeys = periodMonthKeys(period);
    const outlets = body.outlets.filter(
      (o) => (!principalKey || o.principal === principalKey) && matchesRep(o.mostRecentRep, repFilter)
    );
    const monthly = body.monthly.filter(
      (m) => monthKeys.has(`${m.year}|${m.monthIndex}`) && (!principalKey || m.principal === principalKey)
    );

    const totalSales = outlets.reduce((s, o) => s + o.sales, 0);

    return {
      title: "Active Outlets",
      generatedAt: new Date(),
      summary: [
        { label: "Total Outlets", value: outlets.length.toLocaleString() },
        { label: "Total Sales", value: totalSales.toLocaleString() },
      ],
      sections: [
        {
          title: "Outlets",
          columns: ["Principal", "Outlet", "Channel", "Sub Channel", "Territory", "Sales Role", "Times Bought", "Purchase Days", "Sales", "Frequency Band", "Most Recent Rep"],
          rows: outlets.map((o) => [o.principal, o.outletName, o.channel, o.subChannel, o.territory, o.salesRole, o.timesBought, o.purchaseDays, round2(o.sales), o.frequencyBand, o.mostRecentRep ?? "—"]),
        },
        {
          title: "Monthly Trend",
          columns: ["Month", "Principal", "Sales Role", "Distinct Outlets", "Transactions", "Sales"],
          rows: monthly.map((m) => [m.month, m.principal, m.salesRole, m.distinctOutlets, m.transactions, round2(m.sales)]),
        },
      ],
    };
  },
};

interface RepCallRow {
  date: string;
  salesRep: string;
  outletName: string;
  channel: string;
  callOutcome: string;
  sales: number;
  qty: number;
  costCentresBought: string; // comma-joined — one call can span multiple cost centres
}

const timestampsReport: ReportDefinition = {
  key: "timestamps",
  label: "Timestamps",
  description: "Rep call log for the current month.",
  pageKey: "timestamps",
  async build({ period, principalKey, repFilter }) {
    const res = await fetch("/api/timestamps", { cache: "no-store" });
    if (!res.ok) return emptyReport("Timestamps");
    const body = (await res.json()) as { calls: RepCallRow[] };

    const bounds = dateBoundsForPeriod(period);
    const calls = body.calls.filter((c) => {
      if (bounds) {
        const d = new Date(c.date);
        if (d < bounds.from || d > bounds.to) return false;
      }
      if (principalKey && !c.costCentresBought.split(", ").filter(Boolean).includes(principalKey)) return false;
      if (!matchesRep(c.salesRep, repFilter)) return false;
      return true;
    });

    return {
      title: "Timestamps — Call Log",
      generatedAt: new Date(),
      summary: [{ label: "Total Calls", value: calls.length.toLocaleString() }],
      sections: [
        {
          title: "Calls",
          columns: ["Date", "Rep", "Outlet", "Channel", "Outcome", "Sales", "Qty"],
          rows: calls.map((c) => [new Date(c.date).toLocaleDateString(), c.salesRep, c.outletName, c.channel, c.callOutcome, round2(c.sales), round2(c.qty)]),
        },
      ],
    };
  },
};

interface JPRepDaySummaryRow {
  date: string;
  employeeName: string;
  salesRole: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  status: string;
}
interface JPMonthlyCoverageRow {
  year: string;
  monthIndex: number;
  principal: string;
  principalKey: string;
  salesRole: string;
  employeeName: string;
  activityStatus: string;
  coverage: number;
  productive: number;
  productivityPct: number;
}

const jpAdherenceReport: ReportDefinition = {
  key: "jp-adherence",
  label: "JP Adherence",
  description: "Journey plan adherence (planned vs. RepCall-verified actual visits) and monthly coverage.",
  pageKey: "jp-adherence",
  async build({ period, principalKey, repFilter }) {
    const bounds = dateBoundsForPeriod(period);
    if (!bounds) return emptyReport("JP Adherence");
    const params = new URLSearchParams({ from: bounds.from.toISOString(), to: bounds.to.toISOString() });
    if (principalKey) params.set("principal", principalKey);
    const res = await fetch(`/api/jp-adherence?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return emptyReport("JP Adherence");
    const body = (await res.json()) as { repDaySummary: JPRepDaySummaryRow[]; monthlyCoverage: JPMonthlyCoverageRow[] };

    const monthKeys = periodMonthKeys(period);
    const repDaySummary = body.repDaySummary.filter((d) => matchesRep(d.employeeName, repFilter));
    const monthlyCoverage = body.monthlyCoverage.filter((m) => {
      if (!monthKeys.has(`${m.year}|${m.monthIndex}`)) return false;
      if (principalKey && m.principalKey !== principalKey) return false;
      if (!matchesRep(m.employeeName, repFilter)) return false;
      return true;
    });

    return {
      title: "JP Adherence",
      generatedAt: new Date(),
      sections: [
        {
          title: "Adherence Daily",
          columns: ["Date", "Employee", "Role", "Planned", "Visited", "Adherence %", "Productive", "Strike Rate %", "Status"],
          rows: repDaySummary.map((d) => [
            new Date(d.date).toLocaleDateString(),
            d.employeeName,
            d.salesRole,
            d.outletsPlanned,
            d.outletsVisited,
            d.jpAdherencePct,
            d.productiveOutlets,
            d.strikeRatePct,
            d.status,
          ]),
        },
        {
          title: "Monthly Coverage",
          columns: ["Month", "Principal", "Sales Role", "Employee", "Activity Status", "Coverage", "Productive", "Productivity %"],
          rows: monthlyCoverage.map((m) => [`${m.monthIndex + 1}/${m.year}`, m.principal, m.salesRole, m.employeeName, m.activityStatus, m.coverage, m.productive, m.productivityPct]),
        },
      ],
    };
  },
};

interface TimeInTradeRowDto {
  source: string;
  principalKey: string;
  principal: string;
  bucketLabel: string;
  repDays: number;
  visits: number;
  productivityPct: number | null;
  avgStartTime: string | null;
  avgCloseTime: string | null;
  avgHoursInTrade: number | null;
  newOutlets: number | null;
}

const TIME_IN_TRADE_SOURCE_LABELS: Record<string, string> = { pine: "Pine", eabl: "EABL", upfield: "Upfield", unilever: "Unilever" };

const timeInTradeReport: ReportDefinition = {
  key: "time-in-trade",
  label: "Time in Trade",
  description: "Average start/close time, productivity and incremental outlet visits per principal, trended across the selected period.",
  pageKey: "coverage",
  async build({ period, periodLabel }) {
    const params = new URLSearchParams({ kind: period.kind, year: period.year });
    if (period.month) params.set("month", period.month);
    if (period.toYear) params.set("toYear", period.toYear);
    if (period.toMonth) params.set("toMonth", period.toMonth);
    const res = await fetch(`/api/coverage/time-in-trade?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return emptyReport("Time in Trade");
    const body = (await res.json()) as { rows: TimeInTradeRowDto[] };

    return {
      title: `Time in Trade — ${periodLabel}`,
      generatedAt: new Date(),
      sections: [
        {
          title: "Trend by Principal",
          columns: ["Period", "Principal", "System", "Rep-Days", "Visits", "Avg Start", "Avg Close", "Hours in Trade", "Productivity %", "New Outlets"],
          rows: body.rows.map((r) => [
            r.bucketLabel,
            r.principal,
            TIME_IN_TRADE_SOURCE_LABELS[r.source] ?? r.source,
            r.repDays,
            r.visits,
            r.avgStartTime ?? "N/A",
            r.avgCloseTime ?? "N/A",
            r.avgHoursInTrade ?? "N/A",
            r.productivityPct ?? "N/A",
            r.newOutlets ?? "N/A",
          ]),
        },
      ],
    };
  },
};

interface Order360MetaDto {
  range: string;
  totalOrders: number;
  totalValue: number;
  podConfirmedPct: number;
}
interface Order360BacklogRowDto {
  ref: string;
  date: string;
  customer: string;
  fsr: string;
  amount: number;
  age: number;
  owner: string;
}
interface Order360ReturnRowDto {
  ref: string;
  date: string;
  customer: string;
  fsr: string;
  type: string;
  returnDate: string | null;
  amount: number;
  owner: string;
}

const order360Report: ReportDefinition = {
  key: "order-360",
  label: "Order 360",
  description: "Order-fulfillment backlog and returns for the current period. Company-wide — no principal dimension in source data.",
  pageKey: "order-360",
  async build({ period, repFilter }) {
    const bounds = dateBoundsForPeriod(period);
    if (!bounds) return emptyReport("Order 360");
    const params = new URLSearchParams({ dateFrom: bounds.from.toISOString().slice(0, 10), dateTo: bounds.to.toISOString().slice(0, 10) });
    const res = await fetch(`/api/order-360?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return emptyReport("Order 360");
    const body = (await res.json()) as {
      meta: Order360MetaDto;
      backlog: Record<"clearance" | "pick" | "dispatch" | "audit" | "delivery", Order360BacklogRowDto[]>;
      returns: { rows: Order360ReturnRowDto[] };
    };

    const stages: Array<[string, Order360BacklogRowDto[]]> = [
      ["Clearance", body.backlog.clearance],
      ["Pick", body.backlog.pick],
      ["Dispatch", body.backlog.dispatch],
      ["Audit", body.backlog.audit],
      ["Delivery", body.backlog.delivery],
    ];
    const backlogRows = stages.flatMap(([stage, rows]) =>
      rows.filter((r) => matchesRep(r.fsr, repFilter)).map((r) => [stage, r.ref, new Date(r.date).toLocaleDateString(), r.customer, r.fsr, round2(r.amount), r.age, r.owner])
    );
    const returnRows = body.returns.rows.filter((r) => matchesRep(r.fsr, repFilter));

    return {
      title: `Order 360 — ${body.meta.range}`,
      generatedAt: new Date(),
      summary: [
        { label: "Total Orders", value: body.meta.totalOrders.toLocaleString() },
        { label: "Total Value", value: body.meta.totalValue.toLocaleString() },
        { label: "POD Confirmed %", value: `${body.meta.podConfirmedPct}%` },
      ],
      sections: [
        {
          title: "Open Backlog",
          columns: ["Stage", "Ref", "Date", "Customer", "FSR", "Amount", "Age (days)", "Owner"],
          rows: backlogRows,
        },
        {
          title: "Returns",
          columns: ["Ref", "Date", "Customer", "FSR", "Type", "Return Date", "Amount", "Owner"],
          rows: returnRows.map((r) => [r.ref, new Date(r.date).toLocaleDateString(), r.customer, r.fsr, r.type, r.returnDate ? new Date(r.returnDate).toLocaleDateString() : "—", round2(r.amount), r.owner]),
        },
      ],
    };
  },
};

interface SalesReturnsSummaryDto {
  salesNet: number;
  returnsNet: number;
  netAfterReturns: number;
  invoiceLineCount: number;
  returnLineCount: number;
}
interface SalesReturnsRepRowDto {
  salesRepCode: string;
  salesRepName: string;
  sales: number;
  returns: number;
  net: number;
  lineCount: number;
}
interface SalesReturnsDocTypeRowDto {
  documentType: string;
  documentTypeDesc: string;
  lineCount: number;
  netSale: number;
}

const salesReturnsReport: ReportDefinition = {
  key: "sales-returns",
  label: "Sales & Returns",
  description: "Sales vs. returns by rep and document type for the current period. Branch-level — no principal dimension in source data.",
  pageKey: "sales-returns",
  async build({ period, repFilter }) {
    const bounds = dateBoundsForPeriod(period);
    if (!bounds) return emptyReport("Sales & Returns");
    const params = new URLSearchParams({ from: bounds.from.toISOString().slice(0, 10), to: bounds.to.toISOString().slice(0, 10) });
    const res = await fetch(`/api/sales-returns?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return emptyReport("Sales & Returns");
    const body = (await res.json()) as { summary: SalesReturnsSummaryDto; byRep: SalesReturnsRepRowDto[]; byDocType: SalesReturnsDocTypeRowDto[] };
    const byRep = body.byRep.filter((r) => matchesRep(r.salesRepName, repFilter));

    return {
      title: "Sales & Returns",
      generatedAt: new Date(),
      summary: [
        { label: "Sales (Net)", value: body.summary.salesNet.toLocaleString() },
        { label: "Returns (Net)", value: body.summary.returnsNet.toLocaleString() },
        { label: "Net After Returns", value: body.summary.netAfterReturns.toLocaleString() },
        { label: "Invoice Lines", value: body.summary.invoiceLineCount.toLocaleString() },
        { label: "Return Lines", value: body.summary.returnLineCount.toLocaleString() },
      ],
      sections: [
        {
          title: "By Rep",
          columns: ["Rep Code", "Rep Name", "Sales", "Returns", "Net", "Lines"],
          rows: byRep.map((r) => [r.salesRepCode, r.salesRepName, round2(r.sales), round2(r.returns), round2(r.net), r.lineCount]),
        },
        {
          title: "By Document Type",
          columns: ["Document Type", "Description", "Lines", "Net Sale"],
          rows: body.byDocType.map((d) => [d.documentType, d.documentTypeDesc, d.lineCount, round2(d.netSale)]),
        },
      ],
    };
  },
};

interface DormantStockItemDto {
  principal: string;
  item: string;
  itemCode: string;
  openingPcs: number;
  openingValue: number;
  lastSaleDate: string | null;
}

const dormantStockReport: ReportDefinition = {
  key: "dormant-stock",
  label: "Dormant OOS",
  description: "Dormant out-of-stock items — no recent sale, still holding value.",
  pageKey: "dormant-stock",
  async build({ principalKey }) {
    const res = await fetch("/api/dormant-stock", { cache: "no-store" });
    if (!res.ok) return emptyReport("Dormant OOS");
    const body = (await res.json()) as { items: DormantStockItemDto[] };
    const items = body.items.filter((i) => !principalKey || i.principal === principalKey);
    const totalValue = items.reduce((sum, i) => sum + i.openingValue, 0);

    return {
      title: "Dormant OOS",
      generatedAt: new Date(),
      summary: [
        { label: "Item Count", value: items.length.toLocaleString() },
        { label: "Total Value", value: totalValue.toLocaleString() },
      ],
      sections: [
        {
          title: "Dormant Items",
          columns: ["Principal", "Item", "Item Code", "Opening Pcs", "Opening Value", "Last Sale Date"],
          rows: items.map((i) => [i.principal, i.item, i.itemCode, round2(i.openingPcs), round2(i.openingValue), i.lastSaleDate ? new Date(i.lastSaleDate).toLocaleDateString() : "Never"]),
        },
      ],
    };
  },
};

interface MarsSellerRowDto {
  name: string;
  ptdSsu: number;
  ytdSsu: number;
  ptdRevenue: number;
  ytdRevenue: number;
  ptdVisits: number;
  ptdProductive: number;
}
interface MarsSummaryDto {
  current: { ptdSsu: number; ytdSsu: number; ptdRevenue: number; ytdRevenue: number };
  target: { ptdSsuTarget: number };
  ptdAchievement: number | null;
  ytdAchievement: number | null;
}

const principalKpisReport: ReportDefinition = {
  key: "principal-kpis",
  label: "Principal KPIs",
  description: "Mars SSU/revenue performance vs. target and by seller for the current fiscal period. Uses Mars' own fiscal-period filter, not the global period/principal selector.",
  pageKey: "principal-kpis",
  async build() {
    const res = await fetch("/api/principal-kpis/mars", { cache: "no-store" });
    if (!res.ok) return emptyReport("Principal KPIs");
    const body = (await res.json()) as {
      available: boolean;
      fiscalYear?: string;
      selectedPeriod?: number;
      summary?: MarsSummaryDto;
      bySeller?: MarsSellerRowDto[];
    };
    if (!body.available || !body.summary) return emptyReport("Principal KPIs");
    const { summary } = body;

    return {
      title: `Principal KPIs — Mars, Period ${body.selectedPeriod ?? "?"} FY${body.fiscalYear ?? "?"}`,
      generatedAt: new Date(),
      summary: [
        { label: "PTD SSU", value: summary.current.ptdSsu.toLocaleString() },
        { label: "PTD SSU Target", value: summary.target.ptdSsuTarget.toLocaleString() },
        { label: "PTD Achievement %", value: summary.ptdAchievement !== null ? `${summary.ptdAchievement}%` : "N/A" },
        { label: "YTD SSU", value: summary.current.ytdSsu.toLocaleString() },
        { label: "YTD Achievement %", value: summary.ytdAchievement !== null ? `${summary.ytdAchievement}%` : "N/A" },
        { label: "PTD Revenue", value: summary.current.ptdRevenue.toLocaleString() },
      ],
      sections: [
        {
          title: "By Seller",
          columns: ["Seller", "PTD SSU", "YTD SSU", "PTD Revenue", "YTD Revenue", "PTD Visits", "PTD Productive"],
          rows: (body.bySeller ?? []).map((s) => [s.name, round2(s.ptdSsu), round2(s.ytdSsu), round2(s.ptdRevenue), round2(s.ytdRevenue), s.ptdVisits, s.ptdProductive]),
        },
      ],
    };
  },
};

const receivablesReport: ReportDefinition = {
  key: "receivables",
  label: "Receivables",
  description: "Customer credit exposure and ageing. Company-wide — not filtered by principal or period.",
  pageKey: "receivables",
  async build() {
    const res = await fetch("/api/receivables", { cache: "no-store" });
    if (!res.ok) return emptyReport("Receivables");
    const body = (await res.json()) as { dashboard: ReceivablesDashboard | null };
    if (!body.dashboard) return emptyReport("Receivables");
    const d = body.dashboard;

    return {
      title: `Receivables — as of ${new Date(d.asOf).toLocaleDateString()}`,
      generatedAt: new Date(),
      summary: [
        { label: "Outstanding", value: d.masterBalance.toLocaleString() },
        { label: "Customers", value: d.customerCount.toLocaleString() },
        { label: "Credit Limit Breaches", value: d.creditLimitBreaches.toLocaleString() },
        { label: "Open Items", value: d.openItemCount.toLocaleString() },
      ],
      sections: [
        {
          title: "Customers",
          columns: ["Code", "Name", "Status", "Term", "Credit Limit", "Outstanding", "Utilisation %"],
          rows: d.customers.map((c) => [c.code, c.name, c.status, c.term, round2(c.creditLimit), round2(c.outstanding), c.utilisationPct !== null ? round2(c.utilisationPct) : "N/A"]),
        },
        {
          title: "Largest Open Items",
          columns: ["Customer", "Document Ref", "Due Date", "Open Balance", "Bucket"],
          rows: d.largestItems.map((i) => [i.customer, i.documentRef ?? "—", new Date(i.dueDate).toLocaleDateString(), round2(i.openBalance), i.bucket]),
        },
      ],
    };
  },
};

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  salesReport,
  coverageReport,
  profitabilityReport,
  stockReport,
  timeIntelligenceReport,
  repsReport,
  customersReport,
  activeOutletsReport,
  timestampsReport,
  jpAdherenceReport,
  timeInTradeReport,
  order360Report,
  salesReturnsReport,
  dormantStockReport,
  principalKpisReport,
  receivablesReport,
];

// resolvePeriodMonths is re-exported for the catalog UI's periodLabel construction,
// so it doesn't need its own separate import of lib/timeIntelligence internals.
export { resolvePeriodMonths };
