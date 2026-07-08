// Shared data model for the Sales Performance Dashboard.
// This is the exact shape produced by lib/parseWorkbook.ts and consumed by
// every view/component in the app, as well as persisted (as JSON) by the
// /api/upload route and read back by /api/dataset.
//
// v2: a monthly time-series model (one row per period/dimension combination)
// rather than a single "current state" snapshot. Period aggregation (MTD,
// YTD, quarters, halves, or any past month) is computed on demand from these
// arrays by lib/timeIntelligence.ts — nothing here is pre-aggregated to a
// "current" period, since which period is "current" is a UI selection now.

export interface MonthlySalesRow {
  year: string;
  month: string;
  monthIndex: number; // 0-11, Jan=0
  location: string;
  principal: string;
  principalKey: string;
  revenue: number;
  target: number | null; // null when this period has no target — never fabricate/backfill
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
}

export interface MonthlyCoverageRow {
  year: string;
  month: string;
  monthIndex: number;
  salesRole: string;
  employeeName: string;
  principal: string;
  principalKey: string;
  coverage: number;
  productiveCalls: number;
  productivityPct: number;
}

export interface MonthlyBrandCustomerRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  principalKey: string;
  salesEmployee: string;
  customerName: string;
  volume: number;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number | null;
}

export type PLLineType = "REVENUE" | "COGS" | "EXPENSE" | "OTHER_INCOME";

// Monthly-aggregated P&L journal-entry lines by Cost Centre/Account, pushed live
// by scripts/pl-bridge (SAP OJDT/JDT1) via /api/pl/upload, never from the Excel
// upload path. Overlaid onto Dataset.monthlyPL at read time by
// lib/datasetStore.ts — always [] coming out of lib/parseWorkbook.ts.
export interface MonthlyPLRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string; // Cost Centre — same raw Principal-Location string as MonthlySalesRow.principal
  principalKey: string;
  accountCode: string;
  accountName: string;
  lineType: PLLineType;
  amount: number;
}

export interface WeeklyProjectionRow {
  principal: string;
  weeklyRevenue: number;
  weeklyProjection: number;
  weeklyRR: number;
  weekVariance: number;
  achievedProjectionPct: number;
}

export interface StockItem {
  principal: string;
  key: string;
  item: string;
  openingVolume: number;
  openingPcs: number;
  openingValue: number;
  rrWeekValue: number;
  rrWeekVolume: number;
  daysCover: number;
  action: string;
}

export interface StockTotal {
  volume: number;
  pcs: number;
  value: number;
  rrWeekValue: number;
  rrWeekVolume: number;
  daysStock: number;
  itemCount: number;
  outOfStockCount: number;
  runningOutCount: number;
  okCount: number;
  noDataCount: number;
  action: string;
}

export interface ReportMeta {
  title: string;
  sheet: string;
}

export interface Dataset {
  monthlySales: MonthlySalesRow[];
  monthlyCoverage: MonthlyCoverageRow[];
  monthlyBrandCustomer: MonthlyBrandCustomerRow[];
  monthlyPL: MonthlyPLRow[];
  weeklyProjection: WeeklyProjectionRow[];
  stockTotal: StockTotal;
  stockItems: StockItem[];
  reportMeta: ReportMeta;
  uploadedAt: string;
}

export interface DatasetSnapshotSummary {
  id: string;
  uploadedAt: string;
  reportTitle: string;
}
