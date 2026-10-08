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

/** Principal-month operational targets, sourced from Target.coverageTarget and
 * Target.productivityTarget. Both targets are outlet/call figures, never
 * percentages. A zero is intentionally absent here: it means "not configured",
 * never a genuine operating target. */
export interface MonthlyCoverageTargetRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  principalKey: string;
  coverageTarget: number | null;
  productivityTarget: number | null;
}

export interface MonthlyBrandCustomerRow {
  /** ISO "YYYY-MM-DD", UTC — real per-day resolution for the current month (the
   *  source pivot's Date column), a 1st-of-month placeholder for older months
   *  that predate it. See lib/parseWorkbook.ts's parseMonthlyBrandCustomer. */
  date: string;
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  principalKey: string;
  /** Product/brand label from SAP Item Name when supplied by the live sales bridge. */
  brand?: string;
  salesEmployee: string;
  customerName: string;
  /** Set only on rows built from the SFA-outlet tables, where customerName is the outlet: the SAP billing account behind it. */
  accountName?: string;
  /** SFA outlets only: the phone number pulled out of the outlet name, "" when none. */
  sfaContact?: string;
  /** SFA outlets only: invoices and credit notes behind the row (counted per principal). */
  docCount?: number;
  cases: number;
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

export interface StockItem {
  principal: string;
  key: string;
  item: string;
  /** SAP item code, when the source carries it (the live SAP feed does; legacy Excel snapshots do not). */
  itemCode?: string;
  /** Most recent invoice of this item across all SAP history (YYYY-MM-DD); null when it has never been invoiced,
   *  undefined when the source does not carry it. Drives the Stock Balance extract's inactivity columns. */
  lastSaleDate?: string | null;
  /** SAP's own OMRC "Manufacturer" master (queried as "Brand/Manufacturer" in
   *  scripts/db-bridge/queries/stockBalance.ts - this business repurposes it
   *  to record product brand), falling back to Product Master's "series"
   *  field when that's blank (see lib/datasetStore.ts's overlayStock). Null
   *  for the legacy Excel Snapshot stock path (which carries no item code to
   *  join on) and for any live SAP item neither source has brand data for. */
  brand?: string | null;
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

export interface DormantStockItem {
  principal: string;
  key: string;
  item: string;
  itemCode: string;
  openingPcs: number;
  openingValue: number;
  /** Most recent SAP invoice of the item (YYYY-MM-DD); null when it has never been invoiced. */
  lastSaleDate: string | null;
}

export interface Dataset {
  monthlySales: MonthlySalesRow[];
  monthlyCoverage: MonthlyCoverageRow[];
  monthlyCoverageTargets?: MonthlyCoverageTargetRow[];
  monthlyBrandCustomer: MonthlyBrandCustomerRow[];
  monthlyPL: MonthlyPLRow[];
  stockTotal: StockTotal;
  stockItems: StockItem[];
  /** Normalized brand keys an admin has flagged as dormant for stock (Principal.stockDormant): stopped
   *  principals still holding stock, left out of the operational Stock Balance whatever their recent sales. */
  dormantPrincipalKeys?: string[];
  /** When an admin recorded each flagged principal as dormant (YYYY-MM-DD), by normalized brand key; the earliest
   *  date among the brand's flagged principal rows. Absent for a principal whose start date was not recorded. */
  dormantPrincipalSince?: Record<string, string>;
  /** Zero-stock SKUs with no invoice in three months (DormantStockActual), which the operational stock list leaves out
   *  but the Stock Balance extract lists, so it can cover every SKU. */
  dormantStockItems?: DormantStockItem[];
  /** Present only when the dashboard's operational stock has been replaced by
   * the latest complete direct SAP snapshot. */
  stockSource?: {
    kind: "sap-direct";
    sourceDate: string;
    itemCount: number;
  };
  reportMeta: ReportMeta;
  uploadedAt: string;
}

export interface DatasetSnapshotSummary {
  id: string;
  uploadedAt: string;
  reportTitle: string;
}
