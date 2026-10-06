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
  /** Latest complete quarter and the one before it, e.g. "Q3" / "Q2". Null when the year has no such quarter yet. */
  cq: string | null;
  pq: string | null;
  /** Latest full month and the one before it, e.g. "Sep" / "Aug". */
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
  q1: number;
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
  months: string[];
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

/** What the sync stores: both gross-profit measures built from the same lines. */
export interface PerformanceSnapshotPayload {
  version: 1;
  generatedAt: string;
  asOf: string;
  lineCount: number;
  /** Sales of SAP lines that map to no active principal, left out of every figure (they are outside the Sales Performance totals too). */
  excludedSales: number;
  excludedLines: number;
  dashboard: PerformancePayload;
  recorded: PerformancePayload;
}
