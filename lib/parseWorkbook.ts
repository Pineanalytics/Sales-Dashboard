import * as XLSX from "xlsx";
import { normalizePrincipalKey } from "./normalize";
import type {
  Dataset,
  Principal,
  CoverageTotal,
  CoverageTrends,
  CoverageTrendRow,
  TrendedRevenue,
  WeeklyProjectionRow,
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
  salesVsTarget: "Sales Vs Target",
  coverage: "Coverage & Productivity",
  stock: "Stock Balances",
  trendedRevenue: "Trended Revenue",
  weeklyProjection: "Weekly Projection",
} as const;

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

function buildHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = str(h);
    if (key) map.set(key, i);
  });
  return map;
}

function requireCol(headerIndex: Map<string, number>, name: string, sheetName: string): number {
  const idx = headerIndex.get(name);
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

// ---------------------------------------------------------------------------
// Sales Vs Target
// ---------------------------------------------------------------------------

const SALES_COLUMNS = [
  "Principal",
  "Current Month Target",
  "MTD Target",
  "MTD Revenue",
  "Achieved Vs Full Target",
  "Achieved Vs MTD Target",
  "Balance Of Month",
  "Revenue LMSP",
  "MOM",
  "Revenue LYSP",
  "YOY",
  "YTD Revenue.",
  "Full Year Target",
  "YTD Variance",
  "YTD Vs Target",
  "H1 Sales.",
  "H1 Mission",
  "H1 Variance",
  "Average Sales",
  "Gross Profit.",
  "Gross Margin %",
  "Next Month Forecast",
  "Next Quarter Forecast",
] as const;

interface SalesRowParsed {
  name: string;
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
}

function parseSalesVsTarget(wb: XLSX.WorkBook): { rows: SalesRowParsed[]; total: SalesRowParsed; reportMeta: ReportMeta } {
  const sheetName = SHEET_NAMES.salesVsTarget;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRowIdx = findHeaderRowIndex(aoa, "Principal", sheetName);

  let title = "";
  for (let rowIdx = headerRowIdx - 1; rowIdx >= 0; rowIdx--) {
    const row = aoa[rowIdx] ?? [];
    const cell = row.find((c) => !isBlank(c) && typeof c === "string");
    if (cell) {
      title = str(cell);
      break;
    }
  }

  const headerRow = aoa[headerRowIdx];
  const headerIndex = buildHeaderIndex(headerRow);
  const colIdx: Record<(typeof SALES_COLUMNS)[number], number> = {} as never;
  for (const col of SALES_COLUMNS) {
    colIdx[col] = requireCol(headerIndex, col, sheetName);
  }

  const dataRows = aoa.slice(headerRowIdx + 1);
  const parsed: SalesRowParsed[] = [];

  for (const row of dataRows) {
    const name = str(row[colIdx["Principal"]]);
    if (!name) continue;

    const mtdTarget = toNumber(row[colIdx["MTD Target"]]);
    const h1Mission = toNumber(row[colIdx["H1 Mission"]]);
    const h1Sales = toNumber(row[colIdx["H1 Sales."]]);

    parsed.push({
      name,
      currentMonthTarget: toNumber(row[colIdx["Current Month Target"]]),
      mtdTarget,
      mtdRev: toNumber(row[colIdx["MTD Revenue"]]),
      achFull: round1(toNumber(row[colIdx["Achieved Vs Full Target"]]) * 100),
      achMTD: mtdTarget > 0 ? toPercent1(row[colIdx["Achieved Vs MTD Target"]]) : null,
      balMonth: toNumber(row[colIdx["Balance Of Month"]]),
      revLMSP: toNumber(row[colIdx["Revenue LMSP"]]),
      mom: toPercent1(row[colIdx["MOM"]]),
      revLYSP: toNumber(row[colIdx["Revenue LYSP"]]),
      yoy: toPercent1(row[colIdx["YOY"]]),
      ytdRev: toNumber(row[colIdx["YTD Revenue."]]),
      fullTarget: toNumber(row[colIdx["Full Year Target"]]),
      ytdVariance: toNumber(row[colIdx["YTD Variance"]]),
      ytdVsTarget: toPercent1(row[colIdx["YTD Vs Target"]]),
      h1Sales,
      h1Mission,
      h1Variance: toNumber(row[colIdx["H1 Variance"]]),
      h1Achieved: h1Mission > 0 ? round1((h1Sales / h1Mission) * 100) : 0,
      avgSales: toNumber(row[colIdx["Average Sales"]]),
      grossProfit: toNumber(row[colIdx["Gross Profit."]]),
      grossMarginPct: toPercent1(row[colIdx["Gross Margin %"]]),
      nextMonthForecast: toNumber(row[colIdx["Next Month Forecast"]]),
      nextQuarterForecast: toNumber(row[colIdx["Next Quarter Forecast"]]),
    });
  }

  const totalIdx = parsed.findIndex((r) => r.name.toLowerCase().includes("total"));
  if (totalIdx === -1) {
    throw new WorkbookParseError(
      `Sheet "${sheetName}" has no "Total Sales" row — cannot compute portfolio totals.`
    );
  }
  const [total] = parsed.splice(totalIdx, 1);

  return { rows: parsed, total, reportMeta: { title, sheet: sheetName } };
}

// ---------------------------------------------------------------------------
// Coverage & Productivity
// ---------------------------------------------------------------------------

const COVERAGE_COLUMNS = ["Month Name", "Principal", "Coverage.", "Productive Calls", "Productivity %"] as const;

function parseCoverage(wb: XLSX.WorkBook): { trends: CoverageTrends; total: CoverageTotal } {
  const sheetName = SHEET_NAMES.coverage;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRowIdx = findHeaderRowIndex(aoa, "Month Name", sheetName);
  const headerRow = aoa[headerRowIdx];
  const headerIndex = buildHeaderIndex(headerRow);
  const colIdx: Record<(typeof COVERAGE_COLUMNS)[number], number> = {} as never;
  for (const col of COVERAGE_COLUMNS) {
    colIdx[col] = requireCol(headerIndex, col, sheetName);
  }

  const dataRows = aoa.slice(headerRowIdx + 1);
  const rows: CoverageTrendRow[] = [];
  const totals: (CoverageTrendRow & { isTotal: true })[] = [];
  let average: CoverageTrendRow | null = null;

  for (const row of dataRows) {
    const monthName = str(row[colIdx["Month Name"]]);
    const principal = str(row[colIdx["Principal"]]);
    if (!monthName && !principal) continue;

    const coverage = toNumber(row[colIdx["Coverage."]]);
    const productiveCalls = toNumber(row[colIdx["Productive Calls"]]);
    const productivityPct = round1(toNumber(row[colIdx["Productivity %"]]) * 100);

    if (monthName.toLowerCase() === "average") {
      average = { month: monthName, principal: "Average", coverage, productiveCalls, productivityPct };
      continue;
    }

    if (!principal && /total$/i.test(monthName)) {
      const month = monthName.replace(/\s*total$/i, "").trim();
      totals.push({ month, principal: "Total", coverage, productiveCalls, productivityPct, isTotal: true });
      continue;
    }

    if (principal && monthName) {
      rows.push({ month: monthName, principal, coverage, productiveCalls, productivityPct });
    }
  }

  if (totals.length === 0) {
    throw new WorkbookParseError(`Sheet "${sheetName}" has no monthly "Total" rows.`);
  }
  if (!average) {
    throw new WorkbookParseError(`Sheet "${sheetName}" has no "Average" row.`);
  }

  const currentTotal = totals[totals.length - 1];
  const currentMonth = currentTotal.month;

  const trends: CoverageTrends = { currentMonth, totals, average, rows };
  const total: CoverageTotal = {
    ytdCoverage: average.coverage,
    productiveCalls: average.productiveCalls,
    productivityPct: average.productivityPct,
    source: "Average",
    currentMonth,
    currentCoverage: currentTotal.coverage,
    currentProductiveCalls: currentTotal.productiveCalls,
    currentProductivityPct: currentTotal.productivityPct,
  };

  return { trends, total };
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

interface StockAggregate {
  key: string;
  principal: string;
  volume: number;
  pcs: number;
  value: number;
  rrWeekValue: number;
  rrWeekVolume: number;
  itemCount: number;
  outOfStockCount: number;
  runningOutCount: number;
  okCount: number;
  noDataCount: number;
}

function parseStock(wb: XLSX.WorkBook): { items: StockItem[]; byKey: Map<string, StockAggregate>; total: StockTotal } {
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
  const byKey = new Map<string, StockAggregate>();

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

    const key = normalizePrincipalKey(principal);
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        key,
        principal,
        volume: 0,
        pcs: 0,
        value: 0,
        rrWeekValue: 0,
        rrWeekVolume: 0,
        itemCount: 0,
        outOfStockCount: 0,
        runningOutCount: 0,
        okCount: 0,
        noDataCount: 0,
      };
      byKey.set(key, agg);
    }
    agg.volume += openingVolume;
    agg.pcs += openingPcs;
    agg.value += openingValue;
    agg.rrWeekValue += rrWeekValue;
    agg.rrWeekVolume += rrWeekVolume;
    agg.itemCount += 1;

    const tier = action.includes("\u{1F534}")
      ? "bad"
      : action.includes("\u{1F7E1}")
        ? "warn"
        : action.includes("\u{1F7E2}")
          ? "good"
          : "nodata";
    if (tier === "bad") {
      agg.outOfStockCount += 1;
      totalOOS += 1;
    } else if (tier === "warn") {
      agg.runningOutCount += 1;
      totalRunningOut += 1;
    } else if (tier === "good") {
      agg.okCount += 1;
      totalOK += 1;
    } else {
      agg.noDataCount += 1;
      totalNoData += 1;
    }

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

  return { items, byKey, total };
}

// ---------------------------------------------------------------------------
// Trended Revenue (irregular, scanned by label rather than fixed offsets)
// ---------------------------------------------------------------------------

const CANONICAL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function findMonthHeaderCols(aoa: unknown[][]): { rowIdx: number; colIdx: number }[] {
  const headers: { rowIdx: number; colIdx: number }[] = [];
  aoa.forEach((row, rowIdx) => {
    row.forEach((cell, colIdx) => {
      if (str(cell).toLowerCase() === "january") headers.push({ rowIdx, colIdx });
    });
  });
  return headers;
}

function parseTrendedRevenue(wb: XLSX.WorkBook): TrendedRevenue {
  const sheetName = SHEET_NAMES.trendedRevenue;
  const aoa = sheetToAOA(wb, sheetName);

  const headerRows = findMonthHeaderCols(aoa);
  if (headerRows.length === 0) {
    throw new WorkbookParseError(`Sheet "${sheetName}" has no recognizable month header row (expected "January").`);
  }

  const totals: { [year: string]: (number | null)[] } = {};
  let yoy: (number | null)[] = new Array(12).fill(null);
  const byPrincipalKey: { [key: string]: { [year: string]: (number | null)[] } } = {};

  const yearRe = /^\d{4}$/;

  for (let h = 0; h < headerRows.length; h++) {
    const { rowIdx: headerRowIdx, colIdx: monthStartCol } = headerRows[h];
    const nextHeaderRowIdx = h + 1 < headerRows.length ? headerRows[h + 1].rowIdx : aoa.length;

    for (let r = headerRowIdx + 1; r < nextHeaderRowIdx; r++) {
      const row = aoa[r];
      if (!row) continue;
      const colA = str(row[0]);
      const colB = str(row[1]);
      if (!colA && !colB) continue;

      const monthValues: (number | null)[] = [];
      for (let i = 0; i < 12; i++) {
        monthValues.push(toNullableNumber(row[monthStartCol + i]));
      }

      if (!colA && colB.toLowerCase() === "yoy") {
        yoy = monthValues.map((v) => (v === null ? null : round1(v * 100)));
        continue;
      }

      if (yearRe.test(colA) && colB.toLowerCase().replace(/\.$/, "") === "revenue") {
        totals[colA] = monthValues;
        continue;
      }

      if (yearRe.test(colA) && colB.toLowerCase().includes("total")) {
        continue; // explicit "<year> Total" rows duplicate the totals row already captured
      }

      if (yearRe.test(colA) && colB) {
        const key = normalizePrincipalKey(colB);
        byPrincipalKey[key] = byPrincipalKey[key] || {};
        byPrincipalKey[key][colA] = monthValues;
        continue;
      }
    }
  }

  if (Object.keys(totals).length === 0) {
    throw new WorkbookParseError(`Sheet "${sheetName}" has no portfolio "Revenue." rows keyed by year.`);
  }

  return { months: CANONICAL_MONTHS, totals, yoy, byPrincipalKey };
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

function parseWeeklyProjection(wb: XLSX.WorkBook): WeeklyProjectionRow[] {
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
  const rows: WeeklyProjectionRow[] = [];

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

function toPrincipal(row: SalesRowParsed, stockAgg: StockAggregate | undefined): Principal {
  const daysStock = stockAgg ? weightedCoverDays(stockAgg.value, stockAgg.rrWeekValue) : 0;
  return {
    name: row.name,
    stockKey: normalizePrincipalKey(row.name),
    fullTarget: row.fullTarget,
    currentMonthTarget: row.currentMonthTarget,
    mtdTarget: row.mtdTarget,
    mtdRev: row.mtdRev,
    achFull: row.achFull,
    achMTD: row.achMTD,
    balMonth: row.balMonth,
    revLMSP: row.revLMSP,
    revLYSP: row.revLYSP,
    mom: row.mom,
    yoy: row.yoy,
    ytdRev: row.ytdRev,
    ytdVariance: row.ytdVariance,
    ytdVsTarget: row.ytdVsTarget,
    avgSales: row.avgSales,
    h1Mission: row.h1Mission,
    h1Sales: row.h1Sales,
    h1Variance: row.h1Variance,
    h1Achieved: row.h1Achieved,
    grossProfit: row.grossProfit,
    grossMarginPct: row.grossMarginPct,
    nextMonthForecast: row.nextMonthForecast,
    nextQuarterForecast: row.nextQuarterForecast,
    // filled in below once coverage data is merged
    ytdCoverage: 0,
    productiveCalls: 0,
    productivityPct: 0,
    coverageMonth: "",
    stockVolume: stockAgg?.volume ?? 0,
    stockPcs: stockAgg?.pcs ?? 0,
    stockValue: stockAgg?.value ?? 0,
    rrWeekValue: stockAgg?.rrWeekValue ?? 0,
    rrWeekVolume: stockAgg?.rrWeekVolume ?? 0,
    daysStock,
    stockAction: stockAgg ? stockStatus(daysStock, stockAgg.value, stockAgg.rrWeekValue) : "\u{26AA} No Sales Data",
    stockItemCount: stockAgg?.itemCount ?? 0,
    stockOutOfStockCount: stockAgg?.outOfStockCount ?? 0,
    stockRunningOutCount: stockAgg?.runningOutCount ?? 0,
    stockOkCount: stockAgg?.okCount ?? 0,
    stockNoDataCount: stockAgg?.noDataCount ?? 0,
  };
}

export function parseWorkbook(buffer: ArrayBuffer, uploadedAt?: string): Dataset {
  const wb = XLSX.read(buffer, { type: "array" });

  const { rows: salesRows, total: salesTotal, reportMeta } = parseSalesVsTarget(wb);
  const { trends: coverageTrends, total: covTotal } = parseCoverage(wb);
  const { items: stockItems, byKey: stockByKey, total: stockTotal } = parseStock(wb);
  const trendedRevenue = parseTrendedRevenue(wb);
  const weeklyProjection = parseWeeklyProjection(wb);

  const currentMonthCoverageRows = coverageTrends.rows.filter((r) => r.month === coverageTrends.currentMonth);

  const principals: Principal[] = salesRows.map((row) => {
    const stockAgg = stockByKey.get(normalizePrincipalKey(row.name));
    const p = toPrincipal(row, stockAgg);
    const covRow = currentMonthCoverageRows.find((c) => c.principal === row.name);
    if (covRow) {
      p.ytdCoverage = covRow.coverage;
      p.productiveCalls = covRow.productiveCalls;
      p.productivityPct = covRow.productivityPct;
      p.coverageMonth = coverageTrends.currentMonth;
    } else {
      p.coverageMonth = coverageTrends.currentMonth;
    }
    return p;
  });

  const totalPrincipalShape: Principal = {
    ...toPrincipal({ ...salesTotal, name: "Total Sales" }, undefined),
    ytdCoverage: covTotal.currentCoverage,
    productiveCalls: covTotal.currentProductiveCalls,
    productivityPct: covTotal.currentProductivityPct,
    stockVolume: stockTotal.volume,
    stockPcs: stockTotal.pcs,
    stockValue: stockTotal.value,
    rrWeekValue: stockTotal.rrWeekValue,
    rrWeekVolume: stockTotal.rrWeekVolume,
    daysStock: stockTotal.daysStock,
    stockAction: stockTotal.action,
    stockItemCount: stockTotal.itemCount,
    stockOutOfStockCount: stockTotal.outOfStockCount,
    stockRunningOutCount: stockTotal.runningOutCount,
    stockOkCount: stockTotal.okCount,
    stockNoDataCount: stockTotal.noDataCount,
  };
  const { name: _name, stockKey: _stockKey, coverageMonth: _coverageMonth, ...totals } = totalPrincipalShape;
  void _name;
  void _stockKey;
  void _coverageMonth;

  return {
    principals,
    totals,
    covTotal,
    coverageTrends,
    trendedRevenue,
    weeklyProjection,
    stockTotal,
    stockItems,
    reportMeta,
    uploadedAt: uploadedAt ?? new Date().toISOString(),
  };
}
