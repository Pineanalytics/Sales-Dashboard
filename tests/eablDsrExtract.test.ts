import { describe, expect, it } from "vitest";
import { buildDsrExtractSheets, DSR_EXTRACT_MAX_DAYS, fetchDsrExtractData, parseDsrExtractParams, type DsrExtractData } from "@/lib/eablDsrExtract";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";

const parse = (query: string) => parseDsrExtractParams(new URLSearchParams(query));

describe("the DSR extract request", () => {
  it("accepts a valid range, with or without a salesman", () => {
    expect(parse("start=2026-11-01&end=2026-11-21").params).toEqual({ start: "2026-11-01", end: "2026-11-21", salesman: null });
    expect(parse("start=2026-11-01&end=2026-11-01&salesman=%20Geoffrey%20Kimaru%20").params).toEqual({ start: "2026-11-01", end: "2026-11-01", salesman: "Geoffrey Kimaru" });
  });

  it("refuses missing, malformed, impossible, reversed and over-wide ranges", () => {
    expect(parse("").error).toMatch(/yyyy-mm-dd/);
    expect(parse("start=2026-11-01&end=21-11-2026").error).toMatch(/yyyy-mm-dd/);
    expect(parse("start=2026-02-30&end=2026-03-05").error).toMatch(/real calendar/);
    expect(parse("start=2026-11-10&end=2026-11-01").error).toMatch(/before start/);
    expect(parse("start=2026-01-01&end=2026-12-31").error).toMatch(String(DSR_EXTRACT_MAX_DAYS));
    expect(parse(`start=2026-11-01&end=2026-11-02&salesman=${"x".repeat(81)}`).error).toMatch(/too long/);
  });

  it("allows exactly the widest range", () => {
    const end = new Date(Date.UTC(2026, 0, 1) + (DSR_EXTRACT_MAX_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    expect(parse(`start=2026-01-01&end=${end}`).params).toBeDefined();
    const over = new Date(Date.UTC(2026, 0, 1) + DSR_EXTRACT_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(parse(`start=2026-01-01&end=${over}`).error).toBeDefined();
  });
});

const data: DsrExtractData = {
  summary: { TradingDays: 20, Salesmen: 2, Calls: 100, TotalSales: 1000, JPAdherencePct: 91.4, StrikeRatePct: 84.2, StrikeRTD: null },
  salesmanSummary: [
    { Salesman: "Small", TradingDays: 5, Calls: 20, Invoices: 10, TotalSales: 250, JPAdherencePct: 90 },
    { Salesman: "Big", TradingDays: 10, Calls: 80, Invoices: 50, TotalSales: 750, JPAdherencePct: 95 },
  ],
  trend: [
    { ReportDate: "2026-11-02", TotalSales: 400, Calls: 40, Invoices: 20, Outlets: 30 },
    { ReportDate: "2026-11-03", TotalSales: 600, Calls: 0, Invoices: 0, Outlets: 0 },
  ],
  brands: [{ Brand: "Tusker", SaleQty: 120.5, ReturnQty: 20, Outlets: 9 }],
  customers: [{ CustomerCode: "KE1", CustomerName: "Shop", Segment: "Bar", Calls: 3, Invoices: 2, TotalSales: 500, EarliestTimeIn: "09:00", LatestTimeOut: "17:00", AvgDurationMins: 12, Notes: null }],
  outletCalls: [
    { ReportDate: "2026-11-02", Salesman: "Big", CustomerCode: "KE1", CustomerName: "Shop", Segment: "Bar", TimeIn: "09:00:00", TimeOut: "09:10:00", DurationMins: 10, CashSaleNo: "C1", TotalSales: 300, Reason: null },
    { ReportDate: "2026-11-03", Salesman: "Small", CustomerCode: "KE1", CustomerName: "Shop", Segment: "Bar", TimeIn: "10:00:00", TimeOut: "10:05:00", DurationMins: 5, CashSaleNo: null, TotalSales: 0, Reason: "Closed" },
    { ReportDate: "2026-11-03", Salesman: "Big", CustomerCode: "KE1", CustomerName: "Shop", Segment: "Bar", TimeIn: null, TimeOut: null, DurationMins: null, CashSaleNo: null, TotalSales: 0, Reason: null },
    { ReportDate: "2026-11-03", Salesman: "Big", CustomerCode: "KE2", CustomerName: "Other", Segment: "Wholesaler", TimeIn: "11:00:00", TimeOut: "11:30:00", DurationMins: 30, CashSaleNo: "C2", TotalSales: 900, Reason: null },
  ],
  strikeRates: [{ Category: "Beer", Orders: 3, Calls: 5, StrikeRatePct: 60 }],
  odometer: [{ ReportDate: "2026-11-02", Salesman: "Big", KMAtStart: 100, KMAtEnd: 140, KMCovered: 40, JourneyPlan: 30, OdometerStatus: "OK" }],
  unsold: { snapshot_date: "2026-11-21", products: [{ ProductName: "KC 250ml", Units: 10 }], by_salesman: [{ Salesman: "Big", SKUs: 4, Units: 25 }] },
  signoff: [
    { SalesmanDayId: 1, ReportDate: "2026-11-02", Salesman: "Big", Calls: 40, Invoices: 20, TotalSales: 400, SalesmanSignedName: "Big", SalesmanSignedAt: "2026-11-02T18:00", ManagerSignedName: "Boss", ManagerSignedAt: "2026-11-03T08:00", CommentCount: 1 },
    { SalesmanDayId: 2, ReportDate: "2026-11-03", Salesman: "Big", Calls: 0, Invoices: 0, TotalSales: 0, SalesmanSignedName: "Big", SalesmanSignedAt: "2026-11-03T18:00", ManagerSignedName: null, ManagerSignedAt: null, CommentCount: 0 },
    { SalesmanDayId: 3, ReportDate: "2026-11-03", Salesman: "Small", Calls: 0, Invoices: 0, TotalSales: 0, SalesmanSignedName: null, SalesmanSignedAt: null, ManagerSignedName: null, ManagerSignedAt: null, CommentCount: 0 },
  ],
};

const scope = { params: { start: "2026-11-01", end: "2026-11-21", salesman: null }, generatedAt: new Date("2026-11-23T10:15:00Z") };

describe("the full DSR extract sheets", () => {
  const sheets = buildDsrExtractSheets(data, scope);
  const sheet = (name: string) => sheets.find((candidate) => candidate.name === name)!;
  const column = (name: string, header: string) => {
    const target = sheet(name);
    const index = target.columns.indexOf(header);
    expect(index, `${name} has ${header}`).toBeGreaterThanOrEqual(0);
    return target.rows.map((row) => row[index]);
  };

  it("lists every DSR section in reading order, every row as wide as its header", () => {
    expect(sheets.map((s) => s.name)).toEqual([
      "Summary", "Salesman Summary", "Daily Trend", "Brands", "Top Customers", "Outlet Summary", "Strike Rates", "Outlet Calls", "Odometer", "Unsold Products", "Unsold By Salesman", "Sign-off Status",
    ]);
    for (const s of sheets) for (const row of s.rows) expect(row).toHaveLength(s.columns.length);
  });

  it("puts the period, salesman, snapshot date and headline figures on the cover", () => {
    const cover = Object.fromEntries(sheet("Summary").rows.map((row) => [row[0], row[1]]));
    expect(cover.Period).toBe("2026-11-01 to 2026-11-21");
    expect(cover.Salesman).toBe("All salesmen");
    expect(cover.Generated).toBe("2026-11-23 10:15 UTC");
    expect(cover["Total sales"]).toBe(1000);
    expect(cover["JP adherence %"]).toBe(91.4);
    expect(cover["Strike rate: RTD %"]).toBe("");
    expect(sheet("Summary").rows.some((row) => String(row[1]).includes("(2026-11-21)"))).toBe(true);
  });

  it("ranks salesmen by sales with their share and sales per call", () => {
    expect(column("Salesman Summary", "Salesman")).toEqual(["Big", "Small"]);
    expect(column("Salesman Summary", "Sales Rank")).toEqual([1, 2]);
    expect(column("Salesman Summary", "Share Of Sales %")).toEqual([75, 25]);
    expect(column("Salesman Summary", "Sales Per Call")).toEqual([9.38, 12.5]);
  });

  it("adds the weekday and sales per call to the daily trend, leaving a day with no calls blank", () => {
    expect(column("Daily Trend", "Weekday")).toEqual(["Monday", "Tuesday"]);
    expect(column("Daily Trend", "Sales Per Call")).toEqual([10, ""]);
  });

  it("works out net quantity per brand", () => {
    expect(column("Brands", "Net Qty")).toEqual([100.5]);
  });

  it("builds the outlet summary from the call lines: visits need a check-in, productive calls need sales", () => {
    const outlets = sheet("Outlet Summary");
    expect(outlets.rows.map((row) => row[1])).toEqual(["Other", "Shop"]);
    const shop = outlets.rows.find((row) => row[0] === "KE1")!;
    const byHeader = Object.fromEntries(outlets.columns.map((header, index) => [header, shop[index]]));
    expect(byHeader).toMatchObject({ Salesmen: 2, "Call Lines": 3, "Visits (With Check-in)": 2, "Productive Calls": 1, "Strike Rate %": 50, "Total Sales": 300, "Last Visit": "2026-11-03" });
  });

  it("keeps every call line, with blanks for missing values", () => {
    expect(sheet("Outlet Calls").rows).toHaveLength(4);
    expect(column("Outlet Calls", "Reason")).toEqual(["", "Closed", "", ""]);
    expect(column("Outlet Calls", "Time In")[2]).toBe("");
  });

  it("states each day's sign-off", () => {
    expect(column("Sign-off Status", "Sign-off State")).toEqual(["Signed off", "Awaiting manager", "Not signed"]);
  });

  it("writes a workbook Excel can open, with money formatted", () => {
    const buffer = extractToXlsxBuffer(sheets);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("copes with a section the service returned empty", () => {
    const empty = buildDsrExtractSheets({ ...data, outletCalls: [], unsold: {}, signoff: [] }, scope);
    expect(empty.find((s) => s.name === "Outlet Summary")!.rows).toEqual([]);
    expect(empty.find((s) => s.name === "Unsold Products")!.rows).toEqual([]);
  });
});

describe("reading the DSR service", () => {
  it("asks every section for the range and salesman, with the rankings capped at the service's limit", async () => {
    const seen: string[] = [];
    const fake = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      seen.push(`${url.pathname}?${url.searchParams}`);
      const body = url.pathname === "/dsr/summary" ? {} : url.pathname === "/dsr/unsold" ? { products: [], by_salesman: [] } : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const result = await fetchDsrExtractData({ start: "2026-11-01", end: "2026-11-21", salesman: "Geoffrey Kimaru" }, fake);
    expect(Object.keys(result).sort()).toEqual(["brands", "customers", "odometer", "outletCalls", "salesmanSummary", "signoff", "strikeRates", "summary", "trend", "unsold"]);
    expect(seen).toHaveLength(10);
    expect(seen.every((line) => line.includes("start=2026-11-01") && line.includes("end=2026-11-21") && line.includes("salesman=Geoffrey+Kimaru"))).toBe(true);
    expect(seen.find((line) => line.startsWith("/dsr/customers"))).toContain("top=200");
    expect(seen.find((line) => line.startsWith("/dsr/unsold"))).toContain("top=200");
  });

  it("fails the whole extract when one section fails, rather than writing a workbook with a hole", async () => {
    const fake = (async (input: URL | RequestInfo) => new Response("{}", { status: new URL(String(input)).pathname === "/dsr/odometer" ? 500 : 200 })) as typeof fetch;
    await expect(fetchDsrExtractData({ start: "2026-11-01", end: "2026-11-02", salesman: null }, fake)).rejects.toThrow(/500 for dsr\/odometer/);
  });
});
