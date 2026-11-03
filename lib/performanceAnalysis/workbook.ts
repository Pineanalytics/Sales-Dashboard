// The Performance Analysis report as a formatted Excel workbook: every section the page shows, in full, for the period and principals
// that were selected. Built from the same payload the page renders (aggregate.ts) plus the untruncated lists (detail.ts), so the
// figures agree with the screen. Money is whole shillings, percentages are real percentages, growth is signed and red when negative.
import ExcelJS from "exceljs";
import type { PerformanceDetail } from "./detail";
import type { PerformanceMeta, PerformancePayload } from "./types";

type Cell = string | number | null;
type Format = "text" | "int" | "money" | "decimal" | "pct" | "growth";

const NUMBER_FORMATS: Record<Format, string | undefined> = {
  text: undefined,
  int: "#,##0",
  money: "#,##0;[Red]-#,##0",
  decimal: "#,##0.0;[Red]-#,##0.0",
  pct: "0.0%",
  growth: "+0.0%;[Red]-0.0%;0.0%",
};

const NAVY = "FF1F3A5F";
const BAND = "FFF3F6FA";
const TITLE_RULE = "FFB8C4D6";
const FONT = "Calibri";

export interface Column<T> {
  header: string;
  fmt?: Format;
  width?: number;
  /** A percentage column is read in percent units (8.1 = 8.1%) and written as 0.081. */
  value: (row: T, index: number) => Cell;
}

export interface WorkbookInput {
  payload: PerformancePayload;
  detail: PerformanceDetail;
  meta: PerformanceMeta;
  periodLabel: string;
  principalLabel: string;
  generatedAt: Date;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (month: string): string => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;

/** A cell value as the sheet stores it: percentages become fractions so Excel's % format reads them, null becomes an empty cell. */
function stored(value: Cell, fmt: Format | undefined): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && (fmt === "pct" || fmt === "growth")) return value / 100;
  return value;
}

function setTitle(ws: ExcelJS.Worksheet, row: number, text: string, size = 12): void {
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: FONT, size, bold: true, color: { argb: NAVY } };
}

/** Writes one table: a title row, a header row and the data, from `top`. Returns the first free row below it (one blank row left). */
function writeTable<T>(ws: ExcelJS.Worksheet, top: number, title: string, columns: Column<T>[], rows: T[], options: { note?: string; totals?: (Cell | undefined)[] } = {}): { next: number; headerRow: number } {
  let row = top;
  setTitle(ws, row, title);
  row += 1;
  if (options.note) {
    const note = ws.getCell(row, 1);
    note.value = options.note;
    note.font = { name: FONT, size: 9, italic: true, color: { argb: "FF5B6B80" } };
    row += 1;
  }
  const headerRow = row;
  columns.forEach((column, index) => {
    const cell = ws.getCell(row, index + 1);
    cell.value = column.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: column.fmt && column.fmt !== "text" ? "right" : "left", wrapText: true };
  });
  ws.getRow(row).height = 30;
  row += 1;

  rows.forEach((data, rowIndex) => {
    columns.forEach((column, index) => {
      const cell = ws.getCell(row, index + 1);
      cell.value = stored(column.value(data, rowIndex), column.fmt);
      cell.font = { name: FONT, size: 10 };
      const format = column.fmt ? NUMBER_FORMATS[column.fmt] : undefined;
      if (format) cell.numFmt = format;
      if (rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
    });
    row += 1;
  });

  if (options.totals) {
    options.totals.forEach((value, index) => {
      const column = columns[index];
      const cell = ws.getCell(row, index + 1);
      cell.value = stored(value ?? null, column?.fmt);
      cell.font = { name: FONT, size: 10, bold: true };
      cell.border = { top: { style: "thin", color: { argb: NAVY } } };
      const format = column?.fmt ? NUMBER_FORMATS[column.fmt] : undefined;
      if (format) cell.numFmt = format;
    });
    row += 1;
  }

  columns.forEach((column, index) => {
    const sheetColumn = ws.getColumn(index + 1);
    const wanted = column.width ?? Math.min(40, Math.max(11, column.header.length + 2));
    sheetColumn.width = Math.max(sheetColumn.width ?? 0, wanted);
  });
  return { next: row + 1, headerRow };
}

/** A sheet with one table: frozen header and a filter on every column. */
function tableSheet<T>(wb: ExcelJS.Workbook, name: string, title: string, subtitle: string, columns: Column<T>[], rows: T[], options: { totals?: (Cell | undefined)[] } = {}): void {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: NAVY } } });
  setTitle(ws, 1, title, 14);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { name: FONT, size: 10, color: { argb: "FF5B6B80" } };
  const { headerRow } = writeTable(ws, 4, "", columns, rows, options);
  ws.getCell(4, 1).value = null;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows.length, column: columns.length } };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export async function buildPerformanceWorkbook(input: WorkbookInput): Promise<Buffer> {
  const { payload: p, detail, meta, periodLabel, principalLabel, generatedAt } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pinefrost Sales Dashboard";
  wb.created = generatedAt;
  const scopeMonths = p.scope;
  const months = p.months;
  const cq = p.labels.cq;
  const pq = p.labels.pq;
  const sub = `${principalLabel} | ${periodLabel} | SAP data as at ${p.asOf}`;
  const monthColumns = <T extends { m: number[] }>(labels: string[], offset = 0): Column<T>[] =>
    labels.map((month, index) => ({ header: monthLabel(month), fmt: "money" as const, value: (row: T) => row.m[index + offset] ?? 0 }));

  // ---- Summary ------------------------------------------------------------------------------------
  {
    const ws = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF0F9D58" } } });
    ws.views = [{ showGridLines: false }];
    setTitle(ws, 1, "Performance Analysis", 16);
    const scope: [string, string][] = [
      ["Period", periodLabel],
      ["Principals", principalLabel],
      ["Months in the period", scopeMonths.map(monthLabel).join(", ")],
      ["SAP data as at", p.asOf],
      ["Month in progress", p.mtd ? "Yes: the latest month is month to date" : "No: every month is complete"],
      ["Growth compares", cq && pq ? `${cq} with ${pq}` : "Not available for this selection (not enough complete months)"],
      ["Generated", generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ];
    scope.forEach(([label, value], index) => {
      ws.getCell(3 + index, 1).value = label;
      ws.getCell(3 + index, 1).font = { name: FONT, size: 10, bold: true };
      ws.getCell(3 + index, 2).value = value;
      ws.getCell(3 + index, 2).font = { name: FONT, size: 10 };
    });
    const k = p.kpi;
    const kpiRows: { measure: string; value: Cell; fmt: Format; note?: string }[] = [
      { measure: "Net sales", value: k.sales, fmt: "money", note: "Invoices less credit notes, excl. VAT" },
      { measure: "Gross profit", value: k.gp, fmt: "money", note: "Net sales less quantity x current purchase price" },
      { measure: "Gross margin", value: k.gpm, fmt: "pct" },
      { measure: "Invoiced (before credit notes)", value: k.gross, fmt: "money" },
      { measure: "Credit notes", value: k.cn, fmt: "money" },
      { measure: "Credit notes as % of invoiced", value: k.cnPct, fmt: "pct" },
      { measure: `Sales ${cq ?? "current window"}`, value: k.cqSales, fmt: "money" },
      { measure: `Sales ${pq ?? "prior window"}`, value: k.pqSales, fmt: "money" },
      { measure: "Sales growth", value: k.cqSalesGrowth, fmt: "growth" },
      { measure: `Gross profit ${cq ?? "current window"}`, value: k.cqGp, fmt: "money" },
      { measure: `Gross profit ${pq ?? "prior window"}`, value: k.pqGp, fmt: "money" },
      { measure: "Gross profit growth", value: k.cqGpGrowth, fmt: "growth" },
      { measure: `Sales ${p.labels.cm ?? "latest month"}`, value: k.cmSales, fmt: "money" },
      { measure: `Sales ${p.labels.pm ?? "previous month"}`, value: k.pmSales, fmt: "money" },
      { measure: "Latest month growth", value: k.cmGrowth, fmt: "growth" },
      { measure: "Average monthly sales (full months)", value: k.avgMonth, fmt: "money" },
      { measure: "Month-to-date sales", value: k.mtdSales, fmt: "money" },
      { measure: "Customer accounts", value: k.customers, fmt: "int" },
      { measure: "SKUs sold", value: k.skus, fmt: "int" },
      { measure: "Document lines", value: k.lines, fmt: "int" },
      { measure: "Top 10 items' share of sales", value: p.top10Share, fmt: "pct" },
      { measure: "SKUs making up 80% of sales", value: p.sku80, fmt: "int", note: `of ${p.skuActive.toLocaleString("en-US")} SKUs that sold` },
      { measure: "Sales reps who sold", value: p.repCount, fmt: "int" },
    ];
    writeTable(ws, 12, "Key figures", [
      { header: "Measure", width: 40, value: (r: (typeof kpiRows)[number]) => r.measure },
      { header: "Value", fmt: "money", width: 20, value: () => null },
      { header: "Note", width: 52, value: (r) => r.note ?? "" },
    ], kpiRows);
    // The Value column takes each row's own format, so it is written after the table.
    kpiRows.forEach((row, index) => {
      const cell = ws.getCell(14 + index, 2);
      cell.value = stored(row.value, row.fmt);
      const format = NUMBER_FORMATS[row.fmt];
      if (format) cell.numFmt = format;
      cell.alignment = { horizontal: "right" };
    });
    ws.getColumn(1).width = 40;
    ws.getColumn(2).width = 28;
  }

  // ---- Principals ---------------------------------------------------------------------------------
  tableSheet(wb, "Principals", "Principals", sub, [
    { header: "Principal", width: 26, value: (r: PerformancePayload["principals"][number]) => r.p },
    { header: "Net Sales", fmt: "money", value: (r) => r.sales },
    { header: "Gross Profit", fmt: "money", value: (r) => r.gp },
    { header: "GP %", fmt: "pct", value: (r) => r.gpm },
    { header: "Share of Sales", fmt: "pct", value: (r) => r.share },
    { header: `Sales ${pq ?? "prior window"}`, fmt: "money", value: (r) => r.pqSales },
    { header: `Sales ${cq ?? "current window"}`, fmt: "money", value: (r) => r.cqSales },
    { header: "Sales Growth", fmt: "growth", value: (r) => r.cqGrowth },
    { header: "GP Growth", fmt: "growth", value: (r) => r.cqGpGrowth },
    { header: `GP % ${pq ?? "prior"}`, fmt: "pct", value: (r) => r.pqGpm },
    { header: `GP % ${cq ?? "current"}`, fmt: "pct", value: (r) => r.cqGpm },
    { header: "Latest Month Growth", fmt: "growth", value: (r) => r.cmGrowth },
    { header: "Credit Notes %", fmt: "pct", value: (r) => r.cnPct },
    { header: "SKUs", fmt: "int", value: (r) => r.skus },
    { header: "Customers", fmt: "int", value: (r) => r.cust },
    ...months.map((month, index): Column<PerformancePayload["principals"][number]> => ({ header: `Sales ${monthLabel(month)}`, fmt: "money", value: (r) => r.m[index] ?? 0 })),
    ...months.map((month, index): Column<PerformancePayload["principals"][number]> => ({ header: `GP ${monthLabel(month)}`, fmt: "money", value: (r) => r.g[index] ?? 0 })),
  ], p.principals, { totals: ["Total", p.kpi.sales, p.kpi.gp, p.kpi.gpm, 100] });

  // ---- Month on month -----------------------------------------------------------------------------
  tableSheet(wb, "Month on Month", "Month on month", `${sub}. Months before the period are shown for context.`, [
    { header: "Month", width: 14, value: (r: PerformancePayload["monthly"][number]) => monthLabel(r.m) },
    { header: "In Period", value: (r) => (r.inScope ? "Yes" : "No") },
    { header: "Net Sales", fmt: "money", value: (r) => r.sales },
    { header: "Gross Profit", fmt: "money", value: (r) => r.gp },
    { header: "GP %", fmt: "pct", value: (r) => r.gpm },
    { header: "Sales vs Prior Month", fmt: "growth", value: (r) => r.mom },
    { header: "Invoiced", fmt: "money", value: (r) => r.inv },
    { header: "Credit Notes", fmt: "money", value: (r) => r.cn },
    { header: "Credit Notes %", fmt: "pct", value: (r) => r.cnPct },
    { header: "Trade Sales (excl. internal accounts)", fmt: "money", width: 18, value: (r) => r.trade },
    { header: "Cases", fmt: "decimal", value: (r) => r.cases },
    { header: "Customers", fmt: "int", value: (r) => r.cust },
    { header: "SKUs", fmt: "int", value: (r) => r.sku },
    { header: "Avg Sales per Customer", fmt: "money", value: (r) => r.dropSize },
  ], p.monthly);

  // ---- Top items (the page's five lists, stacked) ----------------------------------------------------
  {
    const ws = wb.addWorksheet("Top Items", { properties: { tabColor: { argb: NAVY } } });
    ws.views = [{ showGridLines: false }];
    setTitle(ws, 1, "Top items", 14);
    ws.getCell(2, 1).value = sub;
    ws.getCell(2, 1).font = { name: FONT, size: 10, color: { argb: "FF5B6B80" } };
    const itemColumns = (): Column<PerformancePayload["top10"][number]>[] => [
      { header: "Rank", fmt: "int", width: 7, value: (_, i) => i + 1 },
      { header: "Item Code", width: 14, value: (r) => r.code },
      { header: "Item", width: 42, value: (r) => r.name },
      { header: "Principal", width: 16, value: (r) => r.p },
      { header: "Net Sales", fmt: "money", value: (r) => r.sales },
      { header: "Gross Profit", fmt: "money", value: (r) => r.gp },
      { header: "GP %", fmt: "pct", value: (r) => r.gpm },
      { header: "Cases", fmt: "decimal", value: (r) => r.cases },
      { header: "Customers", fmt: "int", value: (r) => r.cust },
      { header: "Share of Sales", fmt: "pct", value: (r) => r.share },
      { header: `Sales ${pq ?? "prior window"}`, fmt: "money", value: (r) => r.pqSales },
      { header: `Sales ${cq ?? "current window"}`, fmt: "money", value: (r) => r.cqSales },
      { header: "Change in Sales", fmt: "money", value: (r) => r.delta },
      { header: "Growth", fmt: "growth", value: (r) => r.cqGrowth },
    ];
    let row = 4;
    for (const [title, rows, note] of [
      ["Top 10 by sales", p.top10, `Together ${round1(p.top10Share)}% of sales; ${p.sku80.toLocaleString("en-US")} of ${p.skuActive.toLocaleString("en-US")} SKUs make up 80%.`],
      ["Top 10 by gross profit", p.top10gp, undefined],
      ["Biggest gainers", p.gainers, cq && pq ? `Change in sales, ${cq} against ${pq}.` : "Needs a comparison window."],
      ["Biggest decliners", p.decliners, cq && pq ? `Change in sales, ${cq} against ${pq}.` : "Needs a comparison window."],
      ["Selling below cost", p.belowCost, "Items with positive sales and negative gross profit, worst first."],
    ] as const) {
      row = writeTable(ws, row, title, itemColumns(), [...rows], { note }).next;
    }
  }

  // ---- All items ----------------------------------------------------------------------------------
  tableSheet(wb, "All Items", "All items", `${sub}. Every SKU that sold in the period.`, [
    { header: "Rank", fmt: "int", width: 7, value: (_: PerformanceDetail["items"][number], i: number) => i + 1 },
    { header: "Item Code", width: 14, value: (r) => r.code },
    { header: "Item", width: 42, value: (r) => r.name },
    { header: "Principal", width: 16, value: (r) => r.principal },
    { header: "Net Sales", fmt: "money", value: (r) => r.sales },
    { header: "Gross Profit", fmt: "money", value: (r) => r.gp },
    { header: "GP %", fmt: "pct", value: (r) => (r.sales !== 0 ? (r.gp / r.sales) * 100 : null) },
    { header: "Cases", fmt: "decimal", value: (r) => r.cases },
    { header: "Customers", fmt: "int", value: (r) => r.customers },
    { header: "Share of Sales", fmt: "pct", value: (r) => (detail.totalSales !== 0 ? (r.sales / detail.totalSales) * 100 : null) },
    ...monthColumns<PerformanceDetail["items"][number]>(detail.scope),
  ], detail.items, { totals: [null, null, "Total", null, detail.totalSales] });

  // ---- Customers: concentration, ABC, movement and the top accounts ----------------------------------------
  {
    const ws = wb.addWorksheet("Customers", { properties: { tabColor: { argb: NAVY } } });
    ws.views = [{ showGridLines: false }];
    setTitle(ws, 1, "Customers", 14);
    ws.getCell(2, 1).value = sub;
    ws.getCell(2, 1).font = { name: FONT, size: 10, color: { argb: "FF5B6B80" } };
    const c = p.concentration;
    let row = writeTable(ws, 4, "Concentration", [
      { header: "Measure", width: 44, value: (r: [string, Cell, Format]) => r[0] },
      { header: "All accounts", fmt: "pct", width: 16, value: () => null },
    ], [
      ["Top 10 customers' share of sales", c.top10, "pct"],
      ["Top 20 customers' share of sales", c.top20, "pct"],
      ["Top 50 customers' share of sales", c.top50, "pct"],
      ["Customers making up 80% of sales", c.c80, "int"],
      ["Customers who bought", c.active, "int"],
      ["Internal accounts (vans, counters, depots): share of sales", c.internalShare, "pct"],
      ["Internal accounts: number", c.internalCount, "int"],
      ["Top 10 trade customers' share (excl. internal)", c.tTop10, "pct"],
      ["Top 20 trade customers' share (excl. internal)", c.tTop20, "pct"],
      ["Trade customers making up 80% of trade sales", c.t80, "int"],
      ["Trade customers who bought", c.tActive, "int"],
    ]).next;
    // Fill the value column with each row's own format (rows 6 onward: title, header, then data).
    [
      [c.top10, "pct"], [c.top20, "pct"], [c.top50, "pct"], [c.c80, "int"], [c.active, "int"], [c.internalShare, "pct"], [c.internalCount, "int"], [c.tTop10, "pct"], [c.tTop20, "pct"], [c.t80, "int"], [c.tActive, "int"],
    ].forEach(([value, fmt], index) => {
      const cell = ws.getCell(6 + index, 2);
      cell.value = stored(value as number, fmt as Format);
      cell.numFmt = NUMBER_FORMATS[fmt as Format] ?? "General";
      cell.alignment = { horizontal: "right" };
    });
    row = writeTable(ws, row, "ABC classes", [
      { header: "Class", value: (r: PerformancePayload["abc"][number]) => r.cls },
      { header: "Customers", fmt: "int", value: (r) => r.n },
      { header: "Net Sales", fmt: "money", value: (r) => r.sales },
      { header: "Share of Sales", fmt: "pct", value: (r) => r.share },
      { header: "GP %", fmt: "pct", value: (r) => r.gpm },
    ], p.abc, { note: "A: the customers making up the first 80% of sales. B: the next 15%. C: the rest." }).next;
    row = writeTable(ws, row, "Customer movement by month", [
      { header: "Month", value: (r: PerformancePayload["movement"][number]) => monthLabel(r.m) },
      { header: "Active", fmt: "int", value: (r) => r.active },
      { header: "Retained", fmt: "int", value: (r) => r.retained },
      { header: "Reactivated", fmt: "int", value: (r) => r.reactivated },
      { header: "New", fmt: "int", value: (r) => r.new },
      { header: "Lost", fmt: "int", value: (r) => r.lost },
    ], p.movement).next;
    const customerColumns = (): Column<PerformancePayload["topCustomers"][number]>[] => [
      { header: "Rank", fmt: "int", width: 7, value: (r) => r.rank },
      { header: "Code", width: 14, value: (r) => r.code },
      { header: "Customer", width: 40, value: (r) => r.name },
      { header: "Internal Account", value: (r) => (r.internal ? "Yes" : "No") },
      { header: "Net Sales", fmt: "money", value: (r) => r.sales },
      { header: "Gross Profit", fmt: "money", value: (r) => r.gp },
      { header: "GP %", fmt: "pct", value: (r) => r.gpm },
      { header: "Share", fmt: "pct", value: (r) => r.share },
      { header: "Cumulative Share", fmt: "pct", value: (r) => r.cum },
      { header: "SKUs", fmt: "int", value: (r) => r.items },
      { header: "Months Bought", fmt: "int", value: (r) => r.months },
      { header: "Principals", fmt: "int", value: (r) => r.princ },
      { header: `Sales ${pq ?? "prior window"}`, fmt: "money", value: (r) => r.pqSales },
      { header: `Sales ${cq ?? "current window"}`, fmt: "money", value: (r) => r.cqSales },
      { header: "Growth", fmt: "growth", value: (r) => r.cqGrowth },
      { header: "Main Rep", width: 24, value: (r) => r.rep },
      { header: "Main Branch", width: 20, value: (r) => r.wh },
    ];
    row = writeTable(ws, row, "Top 25 customers", customerColumns(), p.topCustomers).next;
    writeTable(ws, row, "Top 25 trade customers (internal accounts excluded)", customerColumns(), p.topTrade);
  }

  // ---- All customers ------------------------------------------------------------------------------
  {
    let cumulative = 0;
    const cum = detail.customers.map((c) => {
      cumulative += detail.totalSales !== 0 ? (c.sales / detail.totalSales) * 100 : 0;
      return cumulative;
    });
    tableSheet(wb, "All Customers", "All customers", `${sub}. Every account that bought in the period.`, [
      { header: "Rank", fmt: "int", width: 7, value: (_: PerformanceDetail["customers"][number], i: number) => i + 1 },
      { header: "Code", width: 14, value: (r) => r.code },
      { header: "Customer", width: 40, value: (r) => r.name },
      { header: "Internal Account", value: (r) => (r.internal ? "Yes" : "No") },
      { header: "Net Sales", fmt: "money", value: (r) => r.sales },
      { header: "Gross Profit", fmt: "money", value: (r) => r.gp },
      { header: "GP %", fmt: "pct", value: (r) => (r.sales !== 0 ? (r.gp / r.sales) * 100 : null) },
      { header: "Share of Sales", fmt: "pct", value: (r) => (detail.totalSales !== 0 ? (r.sales / detail.totalSales) * 100 : null) },
      { header: "Cumulative Share", fmt: "pct", value: (_, i) => cum[i] ?? null },
      { header: "SKUs", fmt: "int", value: (r) => r.items },
      { header: "Months Bought", fmt: "int", value: (r) => r.months },
      { header: "Principals", width: 28, value: (r) => r.principals },
      { header: "Main Rep", width: 24, value: (r) => r.rep },
      { header: "Main Branch", width: 20, value: (r) => r.warehouse },
      ...monthColumns<PerformanceDetail["customers"][number]>(detail.scope),
    ], detail.customers, { totals: [null, null, "Total", null, detail.totalSales] });
  }

  // ---- Growth & GP bridge -----------------------------------------------------------------------------
  tableSheet(wb, "Growth & GP", "Growth and gross profit", `${sub}. ${cq && pq ? `Change from ${pq} to ${cq}, by principal.` : "Needs a comparison window."}`, [
    { header: "Principal", width: 26, value: (r: PerformancePayload["bridge"][number]) => r.p },
    { header: "Change in Sales", fmt: "money", value: (r) => r.ds },
    { header: "Change in Gross Profit", fmt: "money", value: (r) => r.dg },
  ], p.bridge, { totals: ["Total", p.bridge.reduce((s, r) => s + r.ds, 0), p.bridge.reduce((s, r) => s + r.dg, 0)] });

  // ---- Branches and reps (full lists) ----------------------------------------------------------------------
  const groupColumns = (label: string): Column<PerformanceDetail["reps"][number]>[] => [
    { header: label, width: 30, value: (r) => r.name },
    { header: "Net Sales", fmt: "money", value: (r) => r.sales },
    { header: "Gross Profit", fmt: "money", value: (r) => r.gp },
    { header: "GP %", fmt: "pct", value: (r) => (r.sales !== 0 ? (r.gp / r.sales) * 100 : null) },
    { header: "Share of Sales", fmt: "pct", value: (r) => (detail.totalSales !== 0 ? (r.sales / detail.totalSales) * 100 : null) },
    { header: "Cases", fmt: "decimal", value: (r) => r.cases },
    { header: "Customers", fmt: "int", value: (r) => r.customers },
    { header: "Principals", width: 30, value: (r) => r.principals },
    ...monthColumns<PerformanceDetail["reps"][number]>(detail.scope),
  ];
  tableSheet(wb, "Branches", "Branches (warehouses)", sub, groupColumns("Branch"), detail.warehouses, { totals: ["Total", detail.totalSales] });
  tableSheet(wb, "Reps", "Sales reps", sub, groupColumns("Sales Rep"), detail.reps, { totals: ["Total", detail.totalSales] });

  // ---- Notes --------------------------------------------------------------------------------------------
  {
    const ws = wb.addWorksheet("Notes", { properties: { tabColor: { argb: TITLE_RULE } } });
    ws.views = [{ showGridLines: false }];
    ws.getColumn(1).width = 150;
    setTitle(ws, 1, "How to read this workbook", 14);
    const notes = [
      `Period: ${periodLabel}. Principals: ${principalLabel}. The workbook follows the filters selected on the Performance Analysis page.`,
      "Source: SAP Business One invoices and credit notes. Net sales are the line total excluding VAT, invoices less credit notes. Credit notes are shown as negatives.",
      "Gross profit: net sales less quantity x current purchase price, the dashboard's own definition, held to the Sales Performance totals for closed months.",
      cq && pq ? `Growth compares ${cq} with ${pq}: the latest complete calendar quarter inside a period longer than a quarter, otherwise the period's full months, against the equal-length window before it.` : "Growth is not shown: the selection has no complete comparison window.",
      "Growth % is left blank where the earlier figure is too small to give a meaningful percentage.",
      "Internal accounts are vans, counters, cash customers, warehouses, routes and EABL and UDV depot accounts. Trade customers exclude them.",
      "Sheets: Summary and Principals are the page's first two tabs; Month on Month, Top Items, Customers and Growth & GP follow the page; All Items, All Customers, Branches and Reps list every row behind the page's top-N tables.",
      `Lines left out: ${meta.excludedLines.toLocaleString("en-US")} SAP lines (KES ${Math.round(meta.excludedSales).toLocaleString("en-US")}) belong to items with no active principal and are left out here, as they are on Sales Performance.`,
      `Source run: ${meta.generatedAt.slice(0, 16).replace("T", " ")} UTC, ${meta.lineCount.toLocaleString("en-US")} stored lines for ${meta.year}.`,
      "Percentages are real Excel percentages and growth is signed (red when negative), so the columns can be sorted, filtered and charted directly.",
    ];
    notes.forEach((note, index) => {
      const cell = ws.getCell(3 + index, 1);
      cell.value = note;
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { wrapText: true, vertical: "top" };
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
