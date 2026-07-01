// Shared data model for the Sales Performance Dashboard.
// This is the exact shape produced by lib/parseWorkbook.ts and consumed by
// every view/component in the app, as well as persisted (as JSON) by the
// /api/upload route and read back by /api/dataset.

export interface Principal {
  name: string;
  stockKey: string;
  fullTarget: number;
  currentMonthTarget: number;
  mtdTarget: number;
  mtdRev: number;
  achFull: number;
  achMTD: number | null;
  balMonth: number;
  revLMSP: number;
  revLYSP: number;
  mom: number | null;
  yoy: number | null;
  ytdRev: number;
  ytdVariance: number;
  ytdVsTarget: number | null;
  avgSales: number;
  h1Mission: number;
  h1Sales: number;
  h1Variance: number;
  h1Achieved: number;
  grossProfit: number;
  grossMarginPct: number | null;
  nextMonthForecast: number;
  nextQuarterForecast: number;
  ytdCoverage: number;
  productiveCalls: number;
  productivityPct: number;
  coverageMonth: string;
  stockVolume: number;
  stockPcs: number;
  stockValue: number;
  rrWeekValue: number;
  rrWeekVolume: number;
  daysStock: number;
  stockAction: string;
  stockItemCount: number;
  stockOutOfStockCount: number;
  stockRunningOutCount: number;
  stockOkCount: number;
  stockNoDataCount: number;
}

export type Totals = Omit<Principal, "name" | "stockKey" | "coverageMonth">;

export interface CoverageTotal {
  ytdCoverage: number;
  productiveCalls: number;
  productivityPct: number;
  source: "Average";
  currentMonth: string;
  currentCoverage: number;
  currentProductiveCalls: number;
  currentProductivityPct: number;
}

export interface CoverageTrendRow {
  month: string;
  principal: string;
  coverage: number;
  productiveCalls: number;
  productivityPct: number;
}

export interface CoverageTrends {
  currentMonth: string;
  totals: (CoverageTrendRow & { isTotal: true })[];
  average: CoverageTrendRow;
  rows: CoverageTrendRow[];
}

export interface TrendedRevenue {
  months: string[];
  totals: { [year: string]: (number | null)[] };
  yoy: (number | null)[];
  byPrincipalKey: { [normalizedKey: string]: { [year: string]: (number | null)[] } };
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
  principals: Principal[];
  totals: Totals;
  covTotal: CoverageTotal;
  coverageTrends: CoverageTrends;
  trendedRevenue: TrendedRevenue;
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
