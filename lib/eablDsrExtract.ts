// The full EABL DSR extract: one Excel workbook holding every DSR Review section for a date range and (optionally) one salesman, read from the
// DSR service behind the /api/eabl-dsr-review proxy. Pure apart from fetchDsrExtractData, so the parameter checks and the sheets are testable.
import type { ExtractCell, ExtractSheet } from "@/lib/brandCustomerExtract";
import { eablDsrUpstreamBase } from "@/lib/eablDsrProxy";
import { DSR_EXTRACT_MAX_DAYS } from "@/lib/eablDsrExtractLimits";

export { DSR_EXTRACT_MAX_DAYS };

/** The DSR service caps its customer and product rankings at this many rows. */
const DSR_TOP_LIMIT = 200;

export interface DsrExtractParams {
  start: string;
  end: string;
  salesman: string | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;

/** Checks a request's ?start=&end=&salesman=: real yyyy-mm-dd dates in order, within DSR_EXTRACT_MAX_DAYS, and a short salesman name if any. */
export function parseDsrExtractParams(params: URLSearchParams): { params?: DsrExtractParams; error?: string } {
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  if (!DAY_RE.test(start) || !DAY_RE.test(end) || Number.isNaN(dayNumber(start)) || Number.isNaN(dayNumber(end))) {
    return { error: "start and end must be dates in the form yyyy-mm-dd." };
  }
  if (new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10) !== start || new Date(`${end}T00:00:00Z`).toISOString().slice(0, 10) !== end) {
    return { error: "start and end must be real calendar dates." };
  }
  if (dayNumber(end) < dayNumber(start)) return { error: "end must not be before start." };
  if (dayNumber(end) - dayNumber(start) + 1 > DSR_EXTRACT_MAX_DAYS) return { error: `Pick a range of at most ${DSR_EXTRACT_MAX_DAYS} days.` };
  const salesman = (params.get("salesman") ?? "").trim();
  if (salesman.length > 80) return { error: "The salesman name is too long." };
  return { params: { start, end, salesman: salesman || null } };
}

type Row = Record<string, unknown>;

export interface DsrExtractData {
  summary: Row;
  salesmanSummary: Row[];
  trend: Row[];
  brands: Row[];
  customers: Row[];
  outletCalls: Row[];
  strikeRates: Row[];
  odometer: Row[];
  unsold: { snapshot_date?: string | null; products?: Row[]; by_salesman?: Row[] };
  signoff: Row[];
}

const SECTIONS: { key: keyof DsrExtractData; path: string; extra?: Record<string, string> }[] = [
  { key: "summary", path: "dsr/summary" },
  { key: "salesmanSummary", path: "dsr/salesman-summary" },
  { key: "trend", path: "dsr/trend" },
  { key: "brands", path: "dsr/brands" },
  { key: "customers", path: "dsr/customers", extra: { top: String(DSR_TOP_LIMIT) } },
  { key: "outletCalls", path: "dsr/outlet-calls" },
  { key: "strikeRates", path: "dsr/strike-rates" },
  { key: "odometer", path: "dsr/odometer" },
  { key: "unsold", path: "dsr/unsold", extra: { top: String(DSR_TOP_LIMIT) } },
  { key: "signoff", path: "dsr/signoff-status" },
];

/** Reads every DSR section from the DSR service in parallel. Throws if any one fails, so a workbook is never missing a section without saying so. */
export async function fetchDsrExtractData(params: DsrExtractParams, fetchImpl: typeof fetch = fetch): Promise<DsrExtractData> {
  const base = eablDsrUpstreamBase();
  const results = await Promise.all(
    SECTIONS.map(async (section) => {
      const url = new URL(`/${section.path}`, base);
      url.searchParams.set("start", params.start);
      url.searchParams.set("end", params.end);
      if (params.salesman) url.searchParams.set("salesman", params.salesman);
      for (const [name, value] of Object.entries(section.extra ?? {})) url.searchParams.set(name, value);
      const response = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`The DSR service returned ${response.status} for ${section.path}.`);
      return [section.key, await response.json()] as const;
    })
  );
  return Object.fromEntries(results) as unknown as DsrExtractData;
}

// --- sheets ---------------------------------------------------------------------------------------------------------------------------------

type Column = { header: string; key: string };

const cell = (value: unknown): ExtractCell => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value ? "Y" : "N";
  return String(value);
};

const round = (value: number, places = 1) => Number(value.toFixed(places));
const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function sheetOf(name: string, columns: Column[], rows: Row[], extra?: { header: string; value: (row: Row, index: number) => ExtractCell }[]): ExtractSheet {
  return {
    name,
    columns: [...columns.map((column) => column.header), ...(extra ?? []).map((column) => column.header)],
    rows: rows.map((row, index) => [...columns.map((column) => cell(row[column.key])), ...(extra ?? []).map((column) => column.value(row, index))]),
  };
}

const SALESMAN_COLUMNS: Column[] = [
  { header: "Salesman", key: "Salesman" },
  { header: "Trading Days", key: "TradingDays" },
  { header: "Calls", key: "Calls" },
  { header: "Invoices", key: "Invoices" },
  { header: "Total Sales", key: "TotalSales" },
  { header: "Earliest Call Time", key: "EarliestCallTime" },
  { header: "Latest Call Time", key: "LatestCallTime" },
  { header: "Avg Time In Trade (Min)", key: "AvgTimeInTradeMins" },
  { header: "KM At Start", key: "KMAtStart" },
  { header: "KM At End", key: "KMAtEnd" },
  { header: "KM Covered", key: "KMCovered" },
  { header: "Journey Plan", key: "JourneyPlan" },
  { header: "Actual Calls", key: "ActualCalls" },
  { header: "Hit Calls", key: "HitCalls" },
  { header: "JP Adherence %", key: "JPAdherencePct" },
  { header: "Coverage %", key: "CoveragePct" },
  { header: "Strike Rate %", key: "StrikeRatePct" },
  { header: "Beer Strike %", key: "BeerStrike" },
  { header: "Spirit Strike %", key: "SpiritStrike" },
  { header: "RTD Strike %", key: "RTDStrike" },
];

const SUMMARY_LABELS: [string, string][] = [
  ["TradingDays", "Trading days"],
  ["Salesmen", "Salesmen"],
  ["Calls", "Calls"],
  ["Invoices", "Invoices"],
  ["Outlets", "Outlets"],
  ["TotalSales", "Total sales"],
  ["NetSales", "Net sales"],
  ["Discounts", "Discounts"],
  ["TotalTimeInTradeMins", "Total time in trade (min)"],
  ["AvgMinPerOutlet", "Average minutes per outlet"],
  ["JPPlan", "Journey plan (planned calls)"],
  ["JPActual", "Journey plan (actual calls)"],
  ["JPAdherencePct", "JP adherence %"],
  ["CoveragePct", "Coverage %"],
  ["HitCalls", "Hit (productive) calls"],
  ["StrikeRatePct", "Strike rate %"],
  ["StrikeBeer", "Strike rate: beer %"],
  ["StrikeSpirits", "Strike rate: spirits %"],
  ["StrikeRTD", "Strike rate: RTD %"],
  ["KMCovered", "Kilometres covered"],
  ["DaysWithReadings", "Salesman-days with odometer readings"],
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The outlet-level view worked out from the call lines: a line with a check-in time is a visit, a line with sales is a productive one. */
function outletSummary(calls: Row[]): ExtractSheet {
  const byOutlet = new Map<string, { code: string; name: string; segment: string; lines: number; visits: number; productive: number; sales: number; lastVisit: string; salesmen: Set<string> }>();
  for (const call of calls) {
    const code = String(call.CustomerCode ?? "");
    const name = String(call.CustomerName ?? "");
    const key = code || name;
    if (!key) continue;
    const entry = byOutlet.get(key) ?? { code, name, segment: String(call.Segment ?? ""), lines: 0, visits: 0, productive: 0, sales: 0, lastVisit: "", salesmen: new Set<string>() };
    entry.lines += 1;
    const visited = call.TimeIn !== null && call.TimeIn !== undefined && call.TimeIn !== "";
    if (visited) {
      entry.visits += 1;
      const date = String(call.ReportDate ?? "");
      if (date > entry.lastVisit) entry.lastVisit = date;
    }
    const sales = numberOf(call.TotalSales);
    if (sales > 0) entry.productive += 1;
    entry.sales += sales;
    if (call.Salesman) entry.salesmen.add(String(call.Salesman));
    byOutlet.set(key, entry);
  }
  const rows = [...byOutlet.values()].sort((a, b) => b.sales - a.sales);
  return {
    name: "Outlet Summary",
    columns: ["Customer Code", "Customer", "Segment", "Salesmen", "Call Lines", "Visits (With Check-in)", "Productive Calls", "Strike Rate %", "Total Sales", "Last Visit"],
    rows: rows.map((entry) => [
      entry.code,
      entry.name,
      entry.segment,
      entry.salesmen.size,
      entry.lines,
      entry.visits,
      entry.productive,
      entry.visits > 0 ? round((entry.productive / entry.visits) * 100) : "",
      round(entry.sales, 2),
      entry.lastVisit,
    ]),
  };
}

/** The workbook's sheets, in reading order: the cover with the headline figures, the analysis sheets, then the call-level and day-level detail. */
export function buildDsrExtractSheets(data: DsrExtractData, scope: { params: DsrExtractParams; generatedAt: Date }): ExtractSheet[] {
  const { params } = scope;
  const unsold = data.unsold ?? {};

  const cover: ExtractSheet = {
    name: "Summary",
    columns: ["Item", "Value"],
    rows: [
      ["Report", "EABL DSR Review: full extract"],
      ["Period", `${params.start} to ${params.end}`],
      ["Salesman", params.salesman ?? "All salesmen"],
      ["Generated", scope.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
      ["Source", "EABL DSR service (daily sales reports, journey plan, odometer and sign-off records)"],
      ["", ""],
      ...SUMMARY_LABELS.filter(([key]) => key in (data.summary ?? {})).map(([key, label]) => [label, cell(data.summary[key])] as [string, ExtractCell]),
      ["", ""],
      ["Notes", "JP adherence is actual calls over the journey plan; coverage is hit calls over the journey plan; strike rate and the beer, spirit and RTD strike rates are as the DSR service reports them."],
      ["", "Unsold stock is the DSR service's latest van-stock snapshot" + (unsold.snapshot_date ? ` (${unsold.snapshot_date})` : "") + ", not a period figure."],
      ["", "Outlet Summary is worked out from the Outlet Calls sheet: a line with a check-in time is a visit; a line with sales is a productive call."],
      ["", "Top Customers and Unsold Products list the DSR service's top 200."],
    ],
  };

  const totalSales = data.salesmanSummary.reduce((sum, row) => sum + numberOf(row.TotalSales), 0);
  const salesmen = sheetOf("Salesman Summary", SALESMAN_COLUMNS, [...data.salesmanSummary].sort((a, b) => numberOf(b.TotalSales) - numberOf(a.TotalSales)), [
    { header: "Sales Rank", value: (_row, index) => index + 1 },
    { header: "Share Of Sales %", value: (row) => (totalSales > 0 ? round((numberOf(row.TotalSales) / totalSales) * 100) : "") },
    { header: "Sales Per Call", value: (row) => (numberOf(row.Calls) > 0 ? round(numberOf(row.TotalSales) / numberOf(row.Calls), 2) : "") },
  ]);

  const trend = sheetOf(
    "Daily Trend",
    [
      { header: "Date", key: "ReportDate" },
      { header: "Total Sales", key: "TotalSales" },
      { header: "Calls", key: "Calls" },
      { header: "Invoices", key: "Invoices" },
      { header: "Outlets", key: "Outlets" },
    ],
    data.trend,
    [
      { header: "Weekday", value: (row) => (DAY_RE.test(String(row.ReportDate)) ? WEEKDAYS[new Date(`${row.ReportDate}T00:00:00Z`).getUTCDay()] : "") },
      { header: "Sales Per Call", value: (row) => (numberOf(row.Calls) > 0 ? round(numberOf(row.TotalSales) / numberOf(row.Calls), 2) : "") },
    ]
  );

  const brands = sheetOf(
    "Brands",
    [
      { header: "Brand", key: "Brand" },
      { header: "Sale Qty", key: "SaleQty" },
      { header: "Return Qty", key: "ReturnQty" },
      { header: "Outlets", key: "Outlets" },
    ],
    data.brands,
    [{ header: "Net Qty", value: (row) => round(numberOf(row.SaleQty) - numberOf(row.ReturnQty), 2) }]
  );

  const customers = sheetOf(
    "Top Customers",
    [
      { header: "Customer Code", key: "CustomerCode" },
      { header: "Customer", key: "CustomerName" },
      { header: "Segment", key: "Segment" },
      { header: "Calls", key: "Calls" },
      { header: "Invoices", key: "Invoices" },
      { header: "Total Sales", key: "TotalSales" },
      { header: "Earliest Time In", key: "EarliestTimeIn" },
      { header: "Latest Time Out", key: "LatestTimeOut" },
      { header: "Avg Duration (Min)", key: "AvgDurationMins" },
      { header: "Notes", key: "Notes" },
    ],
    data.customers
  );

  const calls = sheetOf("Outlet Calls", [
    { header: "Date", key: "ReportDate" },
    { header: "Salesman", key: "Salesman" },
    { header: "Customer Code", key: "CustomerCode" },
    { header: "Customer", key: "CustomerName" },
    { header: "Segment", key: "Segment" },
    { header: "Time In", key: "TimeIn" },
    { header: "Time Out", key: "TimeOut" },
    { header: "Duration (Min)", key: "DurationMins" },
    { header: "Cash Sale No", key: "CashSaleNo" },
    { header: "Total Sales", key: "TotalSales" },
    { header: "Reason", key: "Reason" },
  ], data.outletCalls);

  const strike = sheetOf(
    "Strike Rates",
    [
      { header: "Category", key: "Category" },
      { header: "Orders", key: "Orders" },
      { header: "Calls", key: "Calls" },
      { header: "Strike Rate %", key: "StrikeRatePct" },
    ],
    data.strikeRates
  );

  const odometer = sheetOf(
    "Odometer",
    [
      { header: "Date", key: "ReportDate" },
      { header: "Salesman", key: "Salesman" },
      { header: "KM At Start", key: "KMAtStart" },
      { header: "KM At End", key: "KMAtEnd" },
      { header: "KM Covered", key: "KMCovered" },
      { header: "Journey Plan", key: "JourneyPlan" },
      { header: "Odometer Status", key: "OdometerStatus" },
    ],
    data.odometer
  );

  const unsoldProducts = sheetOf("Unsold Products", [
    { header: "Product", key: "ProductName" },
    { header: "Units", key: "Units" },
  ], unsold.products ?? []);

  const unsoldBySalesman = sheetOf("Unsold By Salesman", [
    { header: "Salesman", key: "Salesman" },
    { header: "SKUs", key: "SKUs" },
    { header: "Units", key: "Units" },
  ], unsold.by_salesman ?? []);

  const signoff = sheetOf(
    "Sign-off Status",
    [
      { header: "Date", key: "ReportDate" },
      { header: "Salesman", key: "Salesman" },
      { header: "Calls", key: "Calls" },
      { header: "Invoices", key: "Invoices" },
      { header: "Total Sales", key: "TotalSales" },
      { header: "Salesman Signed By", key: "SalesmanSignedName" },
      { header: "Salesman Signed At", key: "SalesmanSignedAt" },
      { header: "Manager Signed By", key: "ManagerSignedName" },
      { header: "Manager Signed At", key: "ManagerSignedAt" },
      { header: "Comments", key: "CommentCount" },
    ],
    data.signoff,
    [
      {
        header: "Sign-off State",
        value: (row) => (row.ManagerSignedAt ? "Signed off" : row.SalesmanSignedAt ? "Awaiting manager" : "Not signed"),
      },
    ]
  );

  return [cover, salesmen, trend, brands, customers, outletSummary(data.outletCalls), strike, calls, odometer, unsoldProducts, unsoldBySalesman, signoff];
}
