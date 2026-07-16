// The ~10 downloadable reports shown on /reports, one per analytics page. Every
// dataset-backed report calls the exact same selector/summarizer functions that
// already power the live view (lib/timeIntelligence.ts, lib/selectors.ts) — the
// numbers in a downloaded report are guaranteed to match what's on screen for the
// same period/principal filter, since nothing here recomputes anything independently.
import type { Dataset } from "@/lib/types";
import type { PageKey } from "@/lib/pageAccess";
import type { PeriodSelection } from "@/lib/timeIntelligence";
import {
  summarizeSalesForPeriod,
  summarizeSalesByPrincipal,
  summarizeCoverageForPeriod,
  summarizeCoverageByRep,
  summarizePLForPeriod,
  summarizePLByPrincipal,
  summarizePLByAccount,
  summarizeBrandCustomerByCustomer,
  summarizeBrandCustomerByRep,
  summarizeBrandCustomerByPrincipal,
  resolvePeriodMonths,
} from "@/lib/timeIntelligence";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { aggregateStockByPrincipal } from "@/lib/stock";
import { normalizePrincipalKey } from "@/lib/normalize";
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
  description: "Current stock position by item, across every principal.",
  pageKey: "stock",
  async build({ dataset, principalKey }) {
    if (!dataset) return emptyReport("Stock Balance");
    const { stockTotal, stockItems } = dataset;

    // Stock has no location split — like StockView.tsx, roll up by normalized brand key.
    const brandKey = principalKey ? normalizePrincipalKey(principalKey) : null;
    const filteredItems = brandKey ? stockItems.filter((i) => i.key === brandKey) : stockItems;
    const rollup = brandKey ? aggregateStockByPrincipal(dataset).find((r) => r.key === brandKey) ?? null : null;
    const summaryTotals = rollup ?? stockTotal;

    return {
      title: brandKey ? `Stock Balance — ${principalKey}` : "Stock Balance",
      generatedAt: new Date(),
      summary: [
        { label: "Total Value", value: summaryTotals.value.toLocaleString() },
        { label: "Total Volume", value: summaryTotals.volume.toLocaleString() },
        { label: "Item Count", value: (rollup ? rollup.itemCount : stockTotal.itemCount).toLocaleString() },
        { label: "Out of Stock", value: summaryTotals.outOfStockCount.toLocaleString() },
        { label: "Running Out", value: summaryTotals.runningOutCount.toLocaleString() },
        { label: "OK", value: (rollup ? rollup.okCount : stockTotal.okCount).toLocaleString() },
      ],
      sections: [
        {
          title: "Stock Items",
          columns: ["Principal", "Item", "Opening Value", "RR Week Value", "Days Cover", "Action"],
          rows: filteredItems.map((s) => [s.principal, s.item, round2(s.openingValue), round2(s.rrWeekValue), round2(s.daysCover), s.action]),
        },
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
          columns: ["Rep", "Volume", "Revenue", "Gross Profit", "Margin %"],
          rows: revenueByRep.map((r) => [r.salesEmployee, round2(r.volume), round2(r.revenue), round2(r.grossProfit), r.grossMarginPct !== null ? r.grossMarginPct : "N/A"]),
        },
      ],
    };
  },
};

const customersReport: ReportDefinition = {
  key: "customers",
  label: "Customers & Brands",
  description: "Revenue by customer and by principal for the current period.",
  pageKey: "customers",
  async build({ dataset, period, principalKey, periodLabel }) {
    if (!dataset) return emptyReport("Customers & Brands");
    const byCustomer = summarizeBrandCustomerByCustomer(dataset, period, principalKey).sort((a, b) => b.revenue - a.revenue);
    const byPrincipal = summarizeBrandCustomerByPrincipal(dataset, period).sort((a, b) => b.revenue - a.revenue);

    return {
      title: `Customers & Brands — ${periodLabel}`,
      generatedAt: new Date(),
      sections: [
        {
          title: "By Customer",
          columns: ["Customer", "Volume", "Revenue", "Gross Profit", "Margin %"],
          rows: byCustomer.map((c) => [c.customerName, round2(c.volume), round2(c.revenue), round2(c.grossProfit), c.grossMarginPct !== null ? c.grossMarginPct : "N/A"]),
        },
        {
          title: "By Principal",
          columns: ["Principal", "Volume", "Revenue", "Gross Profit", "Margin %"],
          rows: byPrincipal.map((p) => [p.principal, round2(p.volume), round2(p.revenue), round2(p.grossProfit), p.grossMarginPct !== null ? p.grossMarginPct : "N/A"]),
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

interface JPAdherenceDailyRow {
  date: string;
  employeeName: string;
  costCentre: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  status: string;
}
interface JPMonthlySplitRow {
  monthLabel: string;
  year: string;
  monthIndex: number;
  costCentre: string;
  salesRole: string;
  employeeName: string;
  activityStatus: string;
  coverage: number;
  productive: number;
  productivityPct: number;
  revenue: number;
}

const jpAdherenceReport: ReportDefinition = {
  key: "jp-adherence",
  label: "JP Adherence",
  description: "Journey plan adherence and monthly split, trailing 90 days.",
  pageKey: "jp-adherence",
  async build({ period, principalKey, repFilter }) {
    const res = await fetch("/api/jp-adherence", { cache: "no-store" });
    if (!res.ok) return emptyReport("JP Adherence");
    const body = (await res.json()) as { adherenceDaily: JPAdherenceDailyRow[]; monthlySplit: JPMonthlySplitRow[] };

    const bounds = dateBoundsForPeriod(period);
    const monthKeys = periodMonthKeys(period);

    const adherenceDaily = body.adherenceDaily.filter((d) => {
      if (bounds) {
        const dt = new Date(d.date);
        if (dt < bounds.from || dt > bounds.to) return false;
      }
      if (principalKey && d.costCentre !== principalKey) return false;
      if (!matchesRep(d.employeeName, repFilter)) return false;
      return true;
    });
    const monthlySplit = body.monthlySplit.filter((m) => {
      if (!monthKeys.has(`${m.year}|${m.monthIndex}`)) return false;
      if (principalKey && m.costCentre !== principalKey) return false;
      if (!matchesRep(m.employeeName, repFilter)) return false;
      return true;
    });

    return {
      title: "JP Adherence",
      generatedAt: new Date(),
      sections: [
        {
          title: "Adherence Daily",
          columns: ["Date", "Employee", "Cost Centre", "Planned", "Visited", "Adherence %", "Productive", "Strike Rate %", "Status"],
          rows: adherenceDaily.map((d) => [
            new Date(d.date).toLocaleDateString(),
            d.employeeName,
            d.costCentre,
            d.outletsPlanned,
            d.outletsVisited,
            d.jpAdherencePct,
            d.productiveOutlets,
            d.strikeRatePct,
            d.status,
          ]),
        },
        {
          title: "Monthly Split",
          columns: ["Month", "Cost Centre", "Sales Role", "Employee", "Activity Status", "Coverage", "Productive", "Productivity %", "Revenue"],
          rows: monthlySplit.map((m) => [m.monthLabel, m.costCentre, m.salesRole, m.employeeName, m.activityStatus, m.coverage, m.productive, m.productivityPct, round2(m.revenue)]),
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
];

// resolvePeriodMonths is re-exported for the catalog UI's periodLabel construction,
// so it doesn't need its own separate import of lib/timeIntelligence internals.
export { resolvePeriodMonths };
