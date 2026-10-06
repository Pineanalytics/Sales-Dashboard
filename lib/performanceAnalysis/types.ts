// Shapes for the Performance Analysis module: the compact SAP sales line the
// bridge reads, and the aggregated payload the page renders. The payload is
// computed by lib/performanceAnalysis/aggregate.ts (a port of the standalone
// build_dashboard.py report) and stored whole in PerformanceAnalysisSnapshot.

/** Which gross-profit measure a payload was built from. */
export type GpBasis = "dashboard" | "recorded";

export const GP_BASIS_LABELS: Record<GpBasis, string> = {
  dashboard: "Dashboard GP",
  recorded: "SAP recorded GP",
};

/** One SAP document line, collapsed to Month x document type x customer x item x warehouse x rep. */
export interface PerfLine {
  /** YYYY-MM */
  month: string;
  /** Invoices add sales; credit notes arrive already negative. */
  doc: "invoice" | "credit";
  customerCode: string;
  customerName: string;
  rep: string;
  /** Brand-level principal (EABL, Mars...), not the location-specific key. */
  principal: string;
  itemCode: string;
  itemName: string;
  warehouse: string;
  cases: number;
  /** Net sales excl. VAT (credit notes negative). */
  sales: number;
  /** Gross profit on the dashboard's own definition (sales - quantity x current purchase price), held to the Sales Performance totals for closed months. */
  gp: number;
  /** Gross profit as SAP recorded it on the document (moving-average cost). */
  gpRecorded: number;
}

export interface PerformanceLabels {
  /** The comparison window and the equal-length one before it, e.g. "Q3" / "Q2", "Sep" / "Aug" or "Jul–Aug" / "May–Jun".
   *  The window is the latest complete calendar quarter inside a period longer than a quarter, otherwise the period's full months.
   *  Null when the data cannot support the comparison (a month still in progress, or no earlier data). */
  cq: string | null;
  pq: string | null;
  /** Latest full month of the period and the one before it, e.g. "Sep" / "Aug". */
  cm: string | null;
  pm: string | null;
}

export interface PerformanceKpi {
  sales: number;
  gp: number;
  gpm: number | null;
  /** Invoice value before credit notes. */
  gross: number;
  /** Credit notes (negative). */
  cn: number;
  cnPct: number | null;
  cqSales: number | null;
  pqSales: number | null;
  cqSalesGrowth: number | null;
  cqGp: number | null;
  pqGp: number | null;
  cqGpGrowth: number | null;
  cmSales: number | null;
  pmSales: number | null;
  cmGrowth: number | null;
  customers: number;
  skus: number;
  /** Mean sales of the full months. */
  avgMonth: number | null;
  /** Sales booked in the month-to-date month (0 when the latest month is complete). */
  mtdSales: number;
  lines: number;
}

export interface MonthlyRow {
  m: string;
  /** Whether this month is part of the selected period (earlier months are shown for context). */
  inScope: boolean;
  sales: number;
  gp: number;
  cust: number;
  sku: number;
  cases: number;
  inv: number;
  cn: number;
  trade: number;
  gpm: number | null;
  cnPct: number | null;
  mom: number | null;
  gpMom: number | null;
  dropSize: number | null;
}

export interface PrincipalRow {
  p: string;
  sales: number;
  gp: number;
  gpm: number | null;
  share: number;
  /** Net sales and GP per month, aligned to `months`. */
  m: number[];
  g: number[];
  pqSales: number;
  cqSales: number;
  cqGrowth: number | null;
  cqGpGrowth: number | null;
  pqGpm: number | null;
  cqGpm: number | null;
  cmGrowth: number | null;
  cnPct: number | null;
  skus: number;
  cust: number;
}

export interface ItemRow {
  code: string;
  name: string;
  p: string;
  sales: number;
  gp: number;
  gpm: number | null;
  cases: number;
  cust: number;
  share: number;
  pqSales: number;
  cqSales: number;
  cqGrowth: number | null;
  delta: number;
  m: number[];
}

export interface CustomerRow {
  rank: number;
  code: string;
  name: string;
  internal: boolean;
  sales: number;
  gp: number;
  gpm: number | null;
  share: number;
  cum: number;
  items: number;
  months: number;
  princ: number;
  pqSales: number;
  cqSales: number;
  cqGrowth: number | null;
  rep: string;
  wh: string;
}

export interface Concentration {
  top10: number;
  top20: number;
  top50: number;
  c80: number;
  active: number;
  tTop10: number;
  tTop20: number;
  t80: number;
  tActive: number;
  internalShare: number;
  internalCount: number;
}

export interface AbcRow {
  cls: "A" | "B" | "C";
  n: number;
  sales: number;
  share: number;
  gpm: number | null;
}

export interface MovementRow {
  m: string;
  active: number;
  retained: number;
  reactivated: number;
  new: number;
  lost: number;
}

export interface WarehouseRow {
  n: string;
  sales: number;
  gp: number;
  gpm: number | null;
  cust: number;
  share: number;
  cqGrowth: number | null;
}

export interface RepRow {
  n: string;
  sales: number;
  gp: number;
  gpm: number | null;
  cust: number;
  princ: string;
  share: number;
  cqGrowth: number | null;
}

export interface BridgeRow {
  p: string;
  ds: number;
  dg: number;
}

export interface PerformancePayload {
  basis: GpBasis;
  /** Nairobi calendar date of the read, YYYY-MM-DD. */
  asOf: string;
  /** Months the trend charts and tables span: from the first month with data to the last month of the selected period. */
  months: string[];
  /** The months of the selected period itself (a subset of `months`); every total, ranking and share is over these. */
  scope: string[];
  /** True when the last month is still in progress (month to date). */
  mtd: boolean;
  labels: PerformanceLabels;
  kpi: PerformanceKpi;
  monthly: MonthlyRow[];
  principals: PrincipalRow[];
  top10: ItemRow[];
  top10gp: ItemRow[];
  gainers: ItemRow[];
  decliners: ItemRow[];
  /** Items selling below cost, worst first. */
  belowCost: ItemRow[];
  top10Share: number;
  /** SKUs that make up 80% of sales, and how many SKUs sold at all. */
  sku80: number;
  skuActive: number;
  topCustomers: CustomerRow[];
  topTrade: CustomerRow[];
  concentration: Concentration;
  abc: AbcRow[];
  pareto: { x: number; y: number }[];
  movement: MovementRow[];
  warehouses: WarehouseRow[];
  reps: RepRow[];
  repCount: number;
  bridge: BridgeRow[];
}

/** Facts about the stored SAP lines, shown in the page footer. */
export interface PerformanceMeta {
  year: number;
  generatedAt: string;
  asOf: string;
  lineCount: number;
  /** Sales of SAP lines that map to no active principal, left out of every figure (they are outside the Sales Performance totals too). */
  excludedSales: number;
  excludedLines: number;
}

/** What /api/performance-analysis returns: the report for the requested period and principals. */
export interface PerformanceResponse {
  meta: PerformanceMeta | null;
  /** Null when no SAP lines exist yet. */
  report: PerformancePayload | null;
}
