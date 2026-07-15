import * as XLSX from "xlsx";
import { normalizePrincipalKey } from "./normalize";
import type {
  Dataset,
  MonthlySalesRow,
  MonthlyCoverageRow,
  MonthlyBrandCustomerRow,
  StockItem,
  StockTotal,
  ReportMeta,
} from "./types";

export class WorkbookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookParseError";
  }
}

const SHEET_NAMES = {
  monthlySales: "All Month Sales Vs Target",
  coverage: "Calls & Productivity",
  brandCustomer: "Brand&Customer Listing",
  stock: "Stock Balances",
  weeklyProjection: "Weekly Projection",
} as const;

const CANONICAL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------------------------------------------------------------------------
// Generic cell / row helpers
// ---------------------------------------------------------------------------

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function toNumber(v: unknown): number {
  if (isBlank(v)) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(v: unknown): number | null {
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Sheet fraction (e.g. 0.4298) -> percent 1dp, or null if the cell is blank. */
function toPercent1(v: unknown): number | null {
  const n = toNullableNumber(v);
  if (n === null) return null;
  return round1(n * 100);
}

function str(v: unknown): string {
  if (isBlank(v)) return "";
  return String(v).trim();
}

function sheetToAOA(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new WorkbookParseError(
      `Missing required sheet "${sheetName}". Found sheets: ${wb.SheetNames.join(", ")}`
    );
  }
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];
}

/** Power Query / SAP exports sometimes append a stray trailing "." to a
 *  column header when a refresh hits a name-collision-resolution path (this
 *  file already special-cased a few columns for it, e.g. "Revenue.") — but
 *  which columns get the period is inconsistent run to run (e.g. "Days
 *  Cover" gained one and broke every upload for 2+ days before this fix).
 *  Normalizing both sides of the comparison makes header matching immune to
 *  it regardless of which column it hits next. */
function normalizeHeaderKey(s: string): string {
  return s.trim().replace(/\.+$/, "");
}

function buildHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = normalizeHeaderKey(str(h));
    if (key) map.set(key, i);
  });
  return map;
}

function requireCol(headerIndex: Map<string, number>, name: string, sheetName: string): number {
  const idx = headerIndex.get(normalizeHeaderKey(name));
  if (idx === undefined) {
    throw new WorkbookParseError(
      `Sheet "${sheetName}" is missing expected column "${name}". Check the export format.`
    );
  }
  return idx;
}

/**
 * Scans the first few rows for one whose first cell matches `firstCellName` — the sheet's
 * actual header row. Different monthly exports pad the rows above the header inconsistently
 * (a title row only, or a blank row plus a title row), so we locate it by content rather than
 * assuming a fixed index.
 */
function findHeaderRowIndex(aoa: unknown[][], firstCellName: string, sheetName: string, scanRows = 10): number {
  const limit = Math.min(aoa.length, scanRows);
  for (let i = 0; i < limit; i++) {
    const row = aoa[i];
    if (row && str(row[0]) === firstCellName) return i;
  }
  throw new WorkbookParseError(
    `Sheet "${sheetName}" does not have a header row starting with "${firstCellName}" in the first ${limit} rows.`
  );
}

function findTitle(aoa: unknown[][], headerRowIdx: number): string {
  for (let rowIdx = headerRowIdx - 1; rowIdx >= 0; rowIdx--) {
    const row = aoa[rowIdx] ?? [];
    const cell = row.find((c) => !isBlank(c) && typeof c === "string");
    if (cell) return str(cell);
  }
  return "";
}

// ---------------------------------------------------------------------------
// All Month Sales Vs Target
// ---------------------------------------------------------------------------

const MONTHLY_SALES_COLUMNS = [
  "Year",
  "Month Name",
  "Location",
  "Principal",
  "Revenue.",
  "Monthly Target",
  "Cost Of Goods.",
  "Gross Profit.",
  "Gross Margin %",
] as const;

function parseMonthlySales(wb: XLSX.WorkBook): { rows: MonthlySalesRow[]; reportMeta: ReportMeta } {
  const sheetName = SHEET_NAMES.monthlySales;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRowIdx = findHeaderRowIndex(aoa, "Year", sheetName);
  const title = findTitle(aoa, headerRowIdx);

  const headerRow = aoa[headerRowIdx];
  const headerIndex = buildHeaderIndex(headerRow);
  const colIdx: Record<(typeof MONTHLY_SALES_COLUMNS)[number], number> = {} as never;
  for (const col of MONTHLY_SALES_COLUMNS) {
    colIdx[col] = requireCol(headerIndex, col, sheetName);
  }

  const dataRows = aoa.slice(headerRowIdx + 1);
  const rows: MonthlySalesRow[] = [];

  for (const row of dataRows) {
    const year = str(row[colIdx["Year"]]);
    const month = str(row[colIdx["Month Name"]]);
    const principal = str(row[colIdx["Principal"]]);
    if (!year || !month || !principal) continue;
    if (principal.toLowerCase().includes("total")) continue;

    rows.push({
      year,
      month,
      monthIndex: CANONICAL_MONTHS.indexOf(month),
      location: str(row[colIdx["Location"]]),
      principal,
      principalKey: normalizePrincipalKey(principal),
      revenue: toNumber(row[colIdx["Revenue."]]),
      // Only populated from 2026 onward in the source workbook — a blank cell must
      // stay null (no target for the period), never coerced to 0.
      target: toNullableNumber(row[colIdx["Monthly Target"]]),
      cogs: toNumber(row[colIdx["Cost Of Goods."]]),
      grossProfit: toNumber(row[colIdx["Gross Profit."]]),
      grossMarginPct: toPercent1(row[colIdx["Gross Margin %"]]),
    });
  }

  if (rows.length === 0) {
    throw new WorkbookParseError(`Sheet "${sheetName}" contains no valid monthly sales rows.`);
  }

  return { rows, reportMeta: { title, sheet: sheetName } };
}

// ---------------------------------------------------------------------------
// Calls & Productivity (monthly, rep-level)
// ---------------------------------------------------------------------------

const MONTHLY_COVERAGE_COLUMNS = [
  "Month Name",
  "SalesRole",
  "Employee Name",
  "Principal",
  "Coverage.",
  "Productive Calls",
  "Productivity %",
] as const;

function parseMonthlyCoverage(wb: XLSX.WorkBook): MonthlyCoverageRow[] {
  const sheetName = SHEET_NAMES.coverage;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRowIdx = findHeaderRowIndex(aoa, "Month Name", sheetName);
  const headerRow = aoa[headerRowIdx];
  const headerIndex = buildHeaderIndex(headerRow);
  const colIdx: Record<(typeof MONTHLY_COVERAGE_COLUMNS)[number], number> = {} as never;
  for (const col of MONTHLY_COVERAGE_COLUMNS) {
    colIdx[col] = requireCol(headerIndex, col, sheetName);
  }

  const dataRows = aoa.slice(headerRowIdx + 1);
  const rows: MonthlyCoverageRow[] = [];

  for (const row of dataRows) {
    const month = str(row[colIdx["Month Name"]]);
    const employeeName = str(row[colIdx["Employee Name"]]);
    if (!month || !employeeName) continue;
    if (employeeName.toLowerCase().includes("total")) continue;

    rows.push({
      // This sheet has no Year column; parseWorkbook() backfills it from the max
      // year present in monthlySales once both sheets are parsed.
      year: "",
      month,
      monthIndex: CANONICAL_MONTHS.indexOf(month),
      salesRole: str(row[colIdx["SalesRole"]]),
      employeeName,
      principal: str(row[colIdx["Principal"]]),
      principalKey: normalizePrincipalKey(str(row[colIdx["Principal"]])),
      coverage: toNumber(row[colIdx["Coverage."]]),
      productiveCalls: toNumber(row[colIdx["Productive Calls"]]),
      productivityPct: toPercent1(row[colIdx["Productivity %"]]) ?? 0,
    });
  }

  if (rows.length === 0) {
    throw new WorkbookParseError(`Sheet "${sheetName}" contains no valid coverage rows.`);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Brand & Customer Listing (monthly, rep + customer level)
// ---------------------------------------------------------------------------

const BRAND_CUSTOMER_COLUMNS = [
  "Year",
  "Month Name",
  "Principal",
  "Sales Employee",
  "Customer Name",
  "Volume",
  "Revenue",
  "GP",
] as const;

interface BrandCustomerAgg {
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
}

/**
 * Parses the Brand&Customer sheet and collapses it to one row per
 * Year+Month+Principal+Sales Employee+Customer, regardless of the grain the
 * source pivot actually exports at. The pivot is meant to be pre-aggregated to
 * that grain, but a live export was still ~101k transaction-line rows (one per
 * Item Name) — serialized, that inflates the whole Dataset past Netlify
 * Functions' response payload limit. Aggregating here makes correctness
 * independent of how the user's pivot happens to be configured: a no-op if
 * it's already at the target grain, a collapse if it isn't. "Item Name" is
 * never read, and "GP Margin %" is always derived from the aggregated
 * revenue/GP rather than trusted from a per-line column, since summing
 * already-averaged percentages across collapsed rows would be wrong.
 */
function parseMonthlyBrandCustomer(wb: XLSX.WorkBook): MonthlyBrandCustomerRow[] {
  const sheetName = SHEET_NAMES.brandCustomer;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRowIdx = findHeaderRowIndex(aoa, "Year", sheetName);
  const headerRow = aoa[headerRowIdx];
  const headerIndex = buildHeaderIndex(headerRow);
  const colIdx: Record<(typeof BRAND_CUSTOMER_COLUMNS)[number], number> = {} as never;
  for (const col of BRAND_CUSTOMER_COLUMNS) {
    colIdx[col] = requireCol(headerIndex, col, sheetName);
  }

  const dataRows = aoa.slice(headerRowIdx + 1);
  const byKey = new Map<string, BrandCustomerAgg>();

  for (const row of dataRows) {
    const year = str(row[colIdx["Year"]]);
    const month = str(row[colIdx["Month Name"]]);
    const customerName = str(row[colIdx["Customer Name"]]);
    if (!year || !month || !customerName) continue;
    if (customerName.toLowerCase().includes("total")) continue;

    const principal = str(row[colIdx["Principal"]]);
    const principalKey = normalizePrincipalKey(principal);
    const salesEmployee = str(row[colIdx["Sales Employee"]]);
    const key = `${year}|${month}|${principalKey}|${salesEmployee}|${customerName}`;

    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        year,
        month,
        monthIndex: CANONICAL_MONTHS.indexOf(month),
        principal,
        principalKey,
        salesEmployee,
        customerName,
        volume: 0,
        revenue: 0,
        grossProfit: 0,
      };
      byKey.set(key, agg);
    }
    agg.volume += toNumber(row[colIdx["Volume"]]);
    agg.revenue += toNumber(row[colIdx["Revenue"]]);
    agg.grossProfit += toNumber(row[colIdx["GP"]]);
  }

  const rows: MonthlyBrandCustomerRow[] = Array.from(byKey.values()).map((agg) => ({
    ...agg,
    grossMarginPct: agg.revenue > 0 ? round1((agg.grossProfit / agg.revenue) * 100) : null,
  }));

  if (rows.length === 0) {
    throw new WorkbookParseError(`Sheet "${sheetName}" contains no valid customer/rep rows.`);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Stock Balances
// ---------------------------------------------------------------------------

const STOCK_COLUMNS = [
  "Principal",
  "Item Description",
  "Opening Volume",
  "Opening Stock Pcs",
  "Opening Value",
  "RR/Week-Value",
  "RR/Week-Volume",
  "Days Cover",
  "Action!",
] as const;

export function weightedCoverDays(value: number, rrWeekValue: number): number {
  return value > 0 && rrWeekValue > 0 ? round1((value / rrWeekValue) * 7) : 0;
}

export function stockStatus(days: number, value: number, rrWeekValue: number): string {
  if (value <= 0) return "\u{1F534} Out of Stock - To Order";
  if (rrWeekValue <= 0) return "\u{26AA} No Sales Data";
  if (days < 7) return "\u{1F534} Out of Stock - To Order";
  if (days < 14) return "\u{1F7E1} Running Out";
  return "\u{1F7E2} OK";
}

function parseStock(wb: XLSX.WorkBook): { items: StockItem[]; total: StockTotal } {
  const sheetName = SHEET_NAMES.stock;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRowIdx = findHeaderRowIndex(aoa, "Principal", sheetName);
  const headerRow = aoa[headerRowIdx];
  const headerIndex = buildHeaderIndex(headerRow);
  const colIdx: Record<(typeof STOCK_COLUMNS)[number], number> = {} as never;
  for (const col of STOCK_COLUMNS) {
    colIdx[col] = requireCol(headerIndex, col, sheetName);
  }

  const dataRows = aoa.slice(headerRowIdx + 1);
  const items: StockItem[] = [];

  let totalVolume = 0;
  let totalPcs = 0;
  let totalValue = 0;
  let totalRRValue = 0;
  let totalRRVolume = 0;
  let totalOOS = 0;
  let totalRunningOut = 0;
  let totalOK = 0;
  let totalNoData = 0;

  for (const row of dataRows) {
    const principal = str(row[colIdx["Principal"]]);
    const item = str(row[colIdx["Item Description"]]);
    if (!principal || !item) continue;
    if (principal.toLowerCase().includes("total")) continue;

    const openingVolume = toNumber(row[colIdx["Opening Volume"]]);
    const openingPcs = toNumber(row[colIdx["Opening Stock Pcs"]]);
    const openingValue = toNumber(row[colIdx["Opening Value"]]);
    const rrWeekValue = toNumber(row[colIdx["RR/Week-Value"]]);
    const rrWeekVolume = toNumber(row[colIdx["RR/Week-Volume"]]);
    const daysCover = weightedCoverDays(openingValue, rrWeekValue);
    const action = stockStatus(daysCover, openingValue, rrWeekValue);

    items.push({
      principal,
      key: normalizePrincipalKey(principal),
      item,
      openingVolume,
      openingPcs,
      openingValue,
      rrWeekValue,
      rrWeekVolume,
      daysCover,
      action,
    });

    const tier = action.includes("\u{1F534}")
      ? "bad"
      : action.includes("\u{1F7E1}")
        ? "warn"
        : action.includes("\u{1F7E2}")
          ? "good"
          : "nodata";
    if (tier === "bad") totalOOS += 1;
    else if (tier === "warn") totalRunningOut += 1;
    else if (tier === "good") totalOK += 1;
    else totalNoData += 1;

    totalVolume += openingVolume;
    totalPcs += openingPcs;
    totalValue += openingValue;
    totalRRValue += rrWeekValue;
    totalRRVolume += rrWeekVolume;
  }

  if (items.length === 0) {
    throw new WorkbookParseError(`Sheet "${sheetName}" contains no valid stock item rows.`);
  }

  const totalDays = weightedCoverDays(totalValue, totalRRValue);
  const total: StockTotal = {
    volume: totalVolume,
    pcs: totalPcs,
    value: totalValue,
    rrWeekValue: totalRRValue,
    rrWeekVolume: totalRRVolume,
    daysStock: totalDays,
    itemCount: items.length,
    outOfStockCount: totalOOS,
    runningOutCount: totalRunningOut,
    okCount: totalOK,
    noDataCount: totalNoData,
    action: stockStatus(totalDays, totalValue, totalRRValue),
  };

  return { items, total };
}

// ---------------------------------------------------------------------------
// Weekly Projection
// ---------------------------------------------------------------------------

const WEEKLY_COLUMNS = [
  "Principal",
  "Weekly Revenue",
  "Weekly Projection",
  "Weekly RR",
  "Week Variance",
  "Achieved Projection",
] as const;

function parseWeeklyProjection(wb: XLSX.WorkBook): import("./types").WeeklyProjectionRow[] {
  const sheetName = SHEET_NAMES.weeklyProjection;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRowIdx = findHeaderRowIndex(aoa, "Principal", sheetName);
  const headerRow = aoa[headerRowIdx];
  const headerIndex = buildHeaderIndex(headerRow);
  const colIdx: Record<(typeof WEEKLY_COLUMNS)[number], number> = {} as never;
  for (const col of WEEKLY_COLUMNS) {
    colIdx[col] = requireCol(headerIndex, col, sheetName);
  }

  const dataRows = aoa.slice(headerRowIdx + 1);
  const rows: import("./types").WeeklyProjectionRow[] = [];

  for (const row of dataRows) {
    const principal = str(row[colIdx["Principal"]]);
    if (!principal || principal.toLowerCase().includes("total")) continue;

    const weeklyRevenue = toNumber(row[colIdx["Weekly Revenue"]]);
    const weeklyProjection = toNumber(row[colIdx["Weekly Projection"]]);
    const rawAchieved = row[colIdx["Achieved Projection"]];
    const achievedProjectionPct = isBlank(rawAchieved)
      ? weeklyProjection !== 0
        ? round1((weeklyRevenue / weeklyProjection) * 100)
        : 0
      : round1(toNumber(rawAchieved) * 100);

    rows.push({
      principal,
      weeklyRevenue,
      weeklyProjection,
      weeklyRR: toNumber(row[colIdx["Weekly RR"]]),
      weekVariance: toNumber(row[colIdx["Week Variance"]]),
      achievedProjectionPct,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Top level assembly
// ---------------------------------------------------------------------------

export function parseWorkbook(buffer: ArrayBuffer, uploadedAt?: string): Dataset {
  const wb = XLSX.read(buffer, { type: "array" });

  const { rows: monthlySales, reportMeta } = parseMonthlySales(wb);
  const monthlyCoverageRaw = parseMonthlyCoverage(wb);
  const monthlyBrandCustomer = parseMonthlyBrandCustomer(wb);
  const { items: stockItems, total: stockTotal } = parseStock(wb);
  const weeklyProjection = parseWeeklyProjection(wb);

  // Calls & Productivity has no Year column; assume it covers a single year and
  // derive it from the latest year present in the sheet that does have one.
  const impliedYear = monthlySales.reduce((max, r) => (r.year > max ? r.year : max), "");
  const monthlyCoverage: MonthlyCoverageRow[] = monthlyCoverageRaw.map((r) => ({
    ...r,
    year: impliedYear || r.year,
  }));

  return {
    monthlySales,
    monthlyCoverage,
    monthlyBrandCustomer,
    // P&L has no Excel-upload path — always empty here; lib/datasetStore.ts
    // overlays it from the PLEntry table at read time (same pattern as targets).
    monthlyPL: [],
    weeklyProjection,
    stockTotal,
    stockItems,
    reportMeta,
    uploadedAt: uploadedAt ?? new Date().toISOString(),
  };
}
