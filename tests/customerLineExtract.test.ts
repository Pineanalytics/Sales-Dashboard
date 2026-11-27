import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  salesLine: { count: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  salesLineMonth: { upsert: vi.fn(), findMany: vi.fn() },
  outletUniverse: { findMany: vi.fn() },
  salesRecord: { findMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/teamLeaderScope", () => ({ resolveScopeForSession: vi.fn(async () => null) }));

import { createCustomerLineExtract, type LinkedLine } from "@/lib/customerLineExtract";
import { createOutletDirectory, createOutletResolver, type OutletListRow } from "@/lib/customerOutlets";
import { parseInvoiceReference } from "@/lib/invoiceReferences";
import { combineExtracts, trimLargeExtract, type ExtractSheet } from "@/lib/brandCustomerExtract";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";
import { lineCustomerKey, lineMeasures, RAW_LINE_COLUMNS, rawCsvCell, rawLineRow, splitSfaCustomer, type SalesLineRecord } from "@/lib/salesLines";
import { monthRange } from "@/scripts/db-bridge/sfa/monthRange";
import { SALES_DETAIL_SQL, toSalesDetailLine } from "@/scripts/db-bridge/queries/salesDetailLines";
import { POST } from "@/app/api/sales/upload-sales-lines/route";
import { GET as rawCsv } from "@/app/api/reports/customer-raw-lines/route";

function line(over: Partial<LinkedLine<SalesLineRecord>> = {}): LinkedLine<SalesLineRecord> {
  return {
    outletId: null,
    docType: "INVOICE", docEntry: 1, lineNum: 0, docNum: "1001", docDate: "2026-11-05", docStatus: "O", printed: true, seriesName: "INV", cardCode: "Van-09", customerName: "Van 9 - PIGEON",
    sfaName: "Jebbs Supermarket (0703655088)", phone: null, numAtCard: null, remarks: null, salesEmployee: "Amina", principal: "Mars-Nairobi", itemCode: "MARS1", itemName: "Galaxy", quantity: 24, inventoryQty: 24, packSize: 12,
    whsCode: "01", whsName: "Main", priceBeforeDiscount: 100, price: 95, discountPct: 5, vatAmount: 364.8, salesAmount: 2280, paidAmount: 0, unitCost: 80, createdBy: "clerk", creationDate: "2026-11-05",
    costCentre1: "Mars", costCentre2: null, costCentre3: null, paymentTerm: "14 Days", paymentTermDays: 14, dueDate: "2026-11-19", ...over,
  };
}

const scope = { principalLabel: "All principals", periodLabel: "MTD November 2026", generatedAt: new Date("2026-11-26T09:00:00Z") };
const sheet = (sheets: ExtractSheet[], name: string) => sheets.find((s) => s.name === name)!;
const record = (s: ExtractSheet, row: number) => Object.fromEntries(s.columns.map((column, i) => [column, s.rows[row][i]]));

const outletRow = (over: Partial<OutletListRow>): OutletListRow => ({
  source: "PINE", outletKey: "1", principal: "Mars-Nairobi", outletName: "Jebbs Supermarket", channel: "Retail", segment: "Supermarkets", region: "Nairobi East", territory: "umoja", territoryClean: "Umoja", route: null, teamLeader: "Grace", ...over,
});
const outlets = [
  outletRow({}),
  outletRow({ source: "EABL", outletKey: "KE1", principal: "EABL-Nyeri", outletName: "Belea Pharmacy Ltd", channel: "Wholesale", segment: "Pharmacies", region: "Nyeri", territory: "Nyeri", territoryClean: null }),
  outletRow({ outletKey: "7", outletName: "Zuri Shop" }),
  outletRow({ outletKey: "8", outletName: "Zuri Shop", principal: "Suntory-Nairobi" }),
];
const directory = createOutletDirectory(outlets);
const builderOf = (rawRowLimit: number) => createCustomerLineExtract({ rawRowLimit, directory });

describe("the SFA customer name of a line", () => {
  it("is U_CustomerName with a trailing bracket moved to the contact", () => {
    expect(splitSfaCustomer("Jebbs Supermarket (0703655088)", "Van 9")).toEqual({ sfaCustomer: "Jebbs Supermarket", sfaContact: "0703655088", remarks: "Original" });
    expect(splitSfaCustomer("Wilcheck Inv(Total thika rd)", "Brivian")).toEqual({ sfaCustomer: "Wilcheck Inv", sfaContact: "Total thika rd", remarks: "Original" });
    expect(splitSfaCustomer("First Walk Umoja ()", "Van 9")).toEqual({ sfaCustomer: "First Walk Umoja", sfaContact: "", remarks: "Original" });
  });

  it("is filled with the SAP customer name, and says so, where there is none", () => {
    expect(splitSfaCustomer(null, "BELEA PHARMACY LTD")).toEqual({ sfaCustomer: "BELEA PHARMACY LTD", sfaContact: "", remarks: "Prefilled" });
    expect(splitSfaCustomer("  ", "BELEA PHARMACY LTD").remarks).toBe("Prefilled");
    expect(splitSfaCustomer("(0712345678)", "Cash Customer")).toEqual({ sfaCustomer: "Cash Customer", sfaContact: "0712345678", remarks: "Prefilled" });
  });

  it("matches customers ignoring case and repeated spaces only", () => {
    expect(lineCustomerKey(" Jebbs   supermarket ")).toBe("JEBBS SUPERMARKET");
    expect(lineCustomerKey("")).toBe("UNKNOWN");
  });
});

describe("line measures and raw columns", () => {
  it("works out cases, gross sales, COGs and gross profit", () => {
    expect(lineMeasures(line())).toEqual({ cases: 2, grossSales: 2400, cogs: 1920, grossProfit: 480 });
  });

  it("gives a free line no sales or cost, and leaves profit blank without a purchase price", () => {
    expect(lineMeasures(line({ priceBeforeDiscount: 0 }))).toMatchObject({ grossSales: 0, cogs: 0, grossProfit: 0 });
    expect(lineMeasures(line({ unitCost: null }))).toMatchObject({ grossSales: 2400, cogs: null, grossProfit: null });
    expect(lineMeasures(line({ packSize: null })).cases).toBeNull();
  });

  it("writes the tool's columns, with both names and the remark", () => {
    const row = Object.fromEntries(RAW_LINE_COLUMNS.map((column, i) => [column, rawLineRow(line())[i]]));
    expect(rawLineRow(line())).toHaveLength(RAW_LINE_COLUMNS.length);
    expect(row).toMatchObject({ "Doc Type": "Invoice", "Invoice/Credit Note No": 1001, "Customer Name": "Van 9 - PIGEON", "SFA Customer Name": "Jebbs Supermarket", "SFA Contact": "0703655088", "Customer Ref Remarks": "Original", Cases: 2, "Gross Profit": 480, "Print Status": "Printed" });
  });

  it("keeps spreadsheet formulas out of the CSV without touching phone numbers", () => {
    expect(rawCsvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(rawCsvCell("-cmd")).toBe("'-cmd");
    expect(rawCsvCell("+254722915665")).toBe("+254722915665");
    expect(rawCsvCell(-5)).toBe("-5");
    expect(rawCsvCell('Shop "A", Ruiru')).toBe('"Shop ""A"", Ruiru"');
  });
});

const ANALYSIS_SHEETS = [
  "Top 50 Customers", "Top 80% Customers", "Principal Concentration", "Top Customers by Principal", "Sales by Channel", "Sales by Segment", "Sales by Territory", "Sales by Team Leader", "Channel by Principal", "Customer Ranking", "Customer Rank by Principal",
];

describe("invoice references", () => {
  it("names the system that raised each form", () => {
    expect(parseInvoiceReference("26W003008890_T005400900100105694_18058585")).toEqual({ system: "LEVERAGE", outletKey: "T005400900100105694" });
    expect(parseInvoiceReference("OI-0719-239013-7111233")).toEqual({ system: "UPFIELD", key: "OI-0719-239013" });
    expect(parseInvoiceReference(" oi-186249 ")).toEqual({ system: "PINE_ORDER", key: "OI-186249" });
    expect(parseInvoiceReference("SI-250936-5621510")).toEqual({ system: "PINE_SALE", key: "SI-250936-5621510" });
    expect(parseInvoiceReference("CSPFL009003300-OLKALAU")).toEqual({ system: "EABL", key: "CSPFL009003300" });
    for (const other of ["", null, "7501618688", "van sales", "PO18264885"]) expect(parseInvoiceReference(other)).toBeNull();
  });
});

describe("the outlet behind a customer", () => {
  it("comes from the line's reference, else the customer's other invoices, else a unique name", () => {
    const resolver = createOutletResolver(directory);
    resolver.observe("VAN 9 CUSTOMER", "PINE|1");
    expect(resolver.line("VAN 9 CUSTOMER", "Mars-Nairobi", "PINE|1")).toMatchObject({ match: "Invoice reference", channel: "Retail", territory: "Umoja", teamLeader: "Grace" });
    expect(resolver.line("VAN 9 CUSTOMER", "Suntory-Nairobi", null)).toMatchObject({ match: "Same customer", code: "1", teamLeader: "" });
    expect(resolver.line("BELEA PHARMACY LTD", "Bennet-Nairobi", null)).toMatchObject({ match: "Name", system: "EABL DMS", segment: "Pharmacies", territory: "Nyeri" });
    expect(resolver.line("SOMEBODY ELSE", "Mars-Nairobi", null)).toMatchObject({ match: "Not matched", channel: "Not matched", system: "" });
  });

  it("does not guess between outlets sharing a name, unless only one is the principal's", () => {
    expect(directory.named("ZURI SHOP", "Bennet-Nairobi")).toBeNull();
    expect(directory.named("zuri  shop", "Suntory-Nairobi")).toBe("PINE|8");
  });

  it("keeps the system and code of a referenced outlet that is not on the list", () => {
    expect(directory.attributes("LEVERAGE|T1", "Unilever-Nairobi", "Invoice reference")).toMatchObject({ system: "Leverage", code: "T1", channel: "Not matched", match: "Invoice reference" });
  });
});

describe("the customer extract from lines", () => {
  const lines = [
    line({ docEntry: 1, itemCode: "MARS1", salesAmount: 8000, outletId: "PINE|1" }),
    line({ docEntry: 1, lineNum: 1, itemCode: "MARS2", salesAmount: 500, salesEmployee: "Brian" }),
    line({ docEntry: 2, principal: "Suntory-Nairobi", itemCode: "SUN1", salesAmount: 500, sfaName: "JEBBS  SUPERMARKET" }),
    line({ docType: "CREDIT_NOTE", docEntry: 9, itemCode: "MARS3", salesAmount: -1000, quantity: -12, inventoryQty: -12 }),
    line({ docEntry: 3, sfaName: null, customerName: "BELEA PHARMACY LTD", cardCode: "C-1", salesAmount: 1500 }),
    line({ docEntry: 4, sfaName: "Small Shop", salesAmount: 500 }),
  ];

  const built = () => {
    const builder = builderOf(100);
    builder.add(lines.slice(0, 3), true);
    builder.add(lines.slice(3), true);
    return builder.finish(scope, new Date("2026-11-26T06:00:00Z"));
  };

  it("ranks SFA customers across the selection with the tool's measures", () => {
    const ranking = sheet(built().sheets, "Customer Ranking");
    expect(ranking.rows.map((r) => r[1])).toEqual(["JEBBS SUPERMARKET", "BELEA PHARMACY LTD", "SMALL SHOP"]);
    expect(record(ranking, 0)).toMatchObject({ Rank: 1, "Sales Value": 8000, "SKUs Bought": 3, Invoices: 2, "Main Rep": "Amina", "Customer Code": "Van-09", "Customer Name": "Van 9 - PIGEON", "Customer Ref Remarks": "Original", "% Share": 80, "Cumulative %": 80, Class: "A", "Principals Bought": 2 });
    expect(record(ranking, 1)).toMatchObject({ "Customer Ref Remarks": "Prefilled", "Customer Name": "BELEA PHARMACY LTD", Class: "B" });
    expect(record(ranking, 2)).toMatchObject({ "Cumulative %": 100, Class: "C" });
  });

  it("ranks again within each principal, the biggest principal first", () => {
    const byPrincipal = sheet(built().sheets, "Customer Rank by Principal");
    expect(byPrincipal.rows.map((r) => [r[0], r[1], r[2]])).toEqual([["Mars-Nairobi", 1, "JEBBS SUPERMARKET"], ["Mars-Nairobi", 2, "BELEA PHARMACY LTD"], ["Mars-Nairobi", 3, "SMALL SHOP"], ["Suntory-Nairobi", 1, "JEBBS SUPERMARKET"]]);
  });

  it("carries every line as raw data and opens as a workbook", () => {
    const extract = built();
    expect(extract.rawRowCount).toBe(6);
    expect(sheet(extract.sheets, "Raw Data").rows).toHaveLength(6);
    const book = XLSX.read(extractToXlsxBuffer(extract.sheets), { type: "buffer" });
    expect(book.SheetNames).toEqual(["Summary", ...ANALYSIS_SHEETS, "Raw Data"]);
  });

  it("puts each customer's channel and territory beside the ranking and sums sales by them", () => {
    const extract = built();
    const ranking = sheet(extract.sheets, "Customer Ranking");
    expect(record(ranking, 0)).toMatchObject({ "Outlet System": "Pine", "Outlet Code": "1", Channel: "Retail", Segment: "Supermarkets", Territory: "Umoja", "Outlet Match": "Invoice reference", Outlets: 1, "SFA Contact": "0703655088", "Last Invoice": "2026-11-05" });
    expect(record(ranking, 1)).toMatchObject({ Channel: "Wholesale", "Outlet Match": "Name" });
    expect(record(ranking, 2)).toMatchObject({ Channel: "Not matched", "Outlet Match": "Not matched" });
    const channel = sheet(extract.sheets, "Sales by Channel");
    expect(channel.rows.map((r) => r[0])).toEqual(["Retail", "Wholesale", "Not matched"]);
    // The customer's lines without their own reference follow it, the credit note included.
    expect(record(channel, 0)).toMatchObject({ "Sales Value": 8000, "% Share": 80, Customers: 1, "Customers in Top 80%": 1, Invoices: 2, "Top Customer": "JEBBS SUPERMARKET", "Nov 2026": 8000 });
    expect(channel.rows.reduce((sum, r) => sum + Number(r[1]), 0)).toBe(10000);
    expect(sheet(extract.sheets, "Channel by Principal").columns).toEqual(["Principal", "Retail", "Wholesale", "Not matched", "Total"]);
    const raw = sheet(extract.sheets, "Raw Data");
    expect(record(raw, 2)).toMatchObject({ "Item Code": "SUN1", Channel: "Retail", "Outlet Match": "Same customer" });
  });

  it("lists the top customers, those making 80% of sales, and each principal's concentration", () => {
    const extract = built();
    expect(sheet(extract.sheets, "Top 50 Customers").rows).toHaveLength(3);
    expect(sheet(extract.sheets, "Top 80% Customers").rows.map((r) => r[1])).toEqual(["JEBBS SUPERMARKET"]);
    expect(record(sheet(extract.sheets, "Principal Concentration"), 0)).toMatchObject({ Principal: "Mars-Nairobi", "Sales Value": 9500, Customers: 3, "Customers Making 80%": 2, "Top Customer": "JEBBS SUPERMARKET", "Top Customer %": 78.9, "Top 10 Share %": 100 });
    expect(sheet(extract.sheets, "Top Customers by Principal").rows.map((r) => r[0])).toEqual(["Mars-Nairobi", "Mars-Nairobi", "Mars-Nairobi", "Suntory-Nairobi"]);
    const summary = Object.fromEntries(sheet(extract.sheets, "Summary").rows.map((r) => [r[0], r[1]]));
    expect(summary).toMatchObject({ "Customers making 80% of sales (class A)": 1, "Sales % with outlet: Invoice reference": 80, "Sales % with outlet: Name": 15, "Sales % with outlet: Not matched": 5 });
  });

  it("leaves the raw data to the CSV past the limit, but still ranks every line", () => {
    const builder = builderOf(3);
    builder.add(lines, false);
    const extract = builder.finish(scope, null);
    expect(extract.rawRowCount).toBe(0);
    expect(extract.sheets.map((s) => s.name)).toEqual(["Summary", ...ANALYSIS_SHEETS]);
    expect(sheet(extract.sheets, "Summary").rows.at(-1)?.[1]).toContain("Raw data (CSV)");
    expect(sheet(extract.sheets, "Customer Ranking").rows).toHaveLength(3);
  });

  it("leaves the full ranking by principal out when it would be too long, and says so", () => {
    const builder = createCustomerLineExtract({ rawRowLimit: 100, directory, principalRankRowLimit: 3 });
    builder.add(lines, true);
    const extract = builder.finish(scope, null);
    expect(extract.sheets.map((s) => s.name)).not.toContain("Customer Rank by Principal");
    expect(sheet(extract.sheets, "Top Customers by Principal").rows).toHaveLength(4);
    expect(sheet(extract.sheets, "Summary").rows.map((r) => r[0])).toContain("Customer Rank by Principal");
  });

  it("adds no empty 'Not included' note when a combined workbook is trimmed with nothing to drop", () => {
    const builder = builderOf(3);
    builder.add(lines, false);
    const customers = builder.finish(scope, null);
    const combined = combineExtracts(customers, { sheets: [], rawRowCount: 50 });
    const trimmed = trimLargeExtract(combined, 40);
    expect(sheet(trimmed.sheets, "Summary").rows.map((r) => r[0])).not.toContain("Not included");
  });
});

describe("the SAP read", () => {
  it("reads non-cancelled invoice and credit-note lines only", () => {
    expect(SALES_DETAIL_SQL.match(/T0\.CANCELED = 'N'/g)).toHaveLength(2);
    expect(SALES_DETAIL_SQL).toContain("T0.U_CustomerName AS SfaName");
    expect(SALES_DETAIL_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|EXEC)\b/i);
  });

  it("maps a SAP row to a stored line", () => {
    const mapped = toSalesDetailLine({
      DocType: "INVOICE", DocEntry: 5, LineNum: 0, DocNum: 77, DocDate: new Date("2026-11-02T00:00:00Z"), DocStatus: "C", Printed: "N", SeriesName: "A", CardCode: "C1", CardName: " Shop ", SfaName: "  ", Phone: null, NumAtCard: null, Comments: null,
      SalesEmployee: "Amina", ItemCode: "X1", ItemName: null, Quantity: 3, InventoryQty: 3, PackSize: 0, WhsCode: "01", WhsName: "Main", PriceBefDi: 10, Price: 10, DiscPrcnt: 0, VatSum: 4.8, SalesAmount: 30, PaidSum: 0, UnitCost: null, CreatedBy: null, CreateDate: null, OcrCode: "", OcrCode2: null, OcrCode3: null,
      PaymentTerm: " 14 Days ", PaymentTermDays: 14, DocDueDate: new Date("2026-11-16T00:00:00Z"),
    });
    expect(mapped).toMatchObject({ docNum: "77", docDate: "2026-11-02", printed: false, customerName: "Shop", sfaName: null, packSize: null, costCentre1: null, itemName: "(Unspecified product)" });
    expect(mapped).toMatchObject({ paymentTerm: "14 Days", paymentTermDays: 14, dueDate: "2026-11-16" });
  });

  it("reads each document's own payment term", () => {
    expect(SALES_DETAIL_SQL.match(/LEFT JOIN OCTG T10 ON T10\.GroupNum = T0\.GroupNum/g)).toHaveLength(2);
  });

  it("reads the months asked for", () => {
    const asOf = new Date("2026-01-15T00:00:00Z");
    expect(monthRange(["--months=2"], asOf)).toEqual([{ year: 2025, monthIndex: 11 }, { year: 2026, monthIndex: 0 }]);
    expect(monthRange(["--from=2025-11", "--to=2025-12"], asOf)).toHaveLength(2);
    expect(() => monthRange(["--from=2025-13"], asOf)).toThrow();
  });
});

const upload = (body: unknown, key = "k") => POST(new Request("http://x/api/sales/upload-sales-lines", { method: "POST", headers: { "x-upload-api-key": key }, body: JSON.stringify(body) }) as never);

describe("POST /api/sales/upload-sales-lines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.UPLOAD_API_KEY = "k";
  });

  it("needs the key and valid lines", async () => {
    expect((await upload({ mode: "chunk", syncToken: "t", lines: [line()] }, "wrong")).status).toBe(401);
    expect((await upload({ mode: "chunk", syncToken: "t", lines: [{ ...line(), salesAmount: "9" }] })).status).toBe(400);
    expect((await upload({ mode: "chunk", syncToken: "t", lines: [] })).status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    const executeRaw = vi.fn();
    prismaMock.$transaction.mockImplementation(async (run: (tx: unknown) => Promise<void>) => run({ $executeRaw: executeRaw }));
    expect((await upload({ mode: "chunk", syncToken: "run-token", lines: [line()] })).status).toBe(200);
    // Every line is stored under the run's token, which the finalize step counts.
    expect(JSON.stringify(executeRaw.mock.calls[0])).toContain("run-token");
  });

  it("sends the same statement with two values whatever the batch holds", async () => {
    const executeRaw = vi.fn();
    prismaMock.$transaction.mockImplementation(async (run: (tx: unknown) => Promise<void>) => run({ $executeRaw: executeRaw }));
    await upload({ mode: "chunk", syncToken: "t", lines: [line({ unitCost: null })] });
    await upload({ mode: "chunk", syncToken: "t", lines: [line(), line({ lineNum: 1, quantity: 1.5, sfaName: null }), line({ lineNum: 2 })] });
    const [first, second] = executeRaw.mock.calls.map(([strings, ...values]) => Prisma.sql(strings, ...values));
    expect(first.sql).toBe(second.sql);
    expect(second.values).toHaveLength(2);
    // Postgres reads each column from the JSON by name, with its own type.
    expect(second.sql).toContain('"unitCost" double precision');
    const sent = JSON.parse(second.values.find((value) => String(value).startsWith("[")) as string);
    expect(sent).toHaveLength(3);
    expect(sent[1]).toMatchObject({ lineNum: 1, quantity: 1.5, sfaName: null });
    expect(typeof sent[1].id).toBe("string");
  });

  it("marks a month held only when every line arrived, then prunes older lines", async () => {
    const finalize = { mode: "finalize", syncToken: "t", period: { year: "2026", monthIndex: 10 }, lineCount: 10 };
    prismaMock.salesLine.count.mockResolvedValue(9);
    expect((await upload(finalize)).status).toBe(409);
    expect(prismaMock.salesLine.deleteMany).not.toHaveBeenCalled();
    prismaMock.salesLine.count.mockResolvedValue(10);
    prismaMock.salesLine.deleteMany.mockResolvedValue({ count: 2 });
    const ok = await upload(finalize);
    expect(await ok.json()).toEqual({ pruned: 2 });
    expect(prismaMock.salesLineMonth.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/reports/customer-raw-lines", () => {
  const get = (query: string) => {
    const url = new URL(`http://x/api/reports/customer-raw-lines?${query}`);
    return rawCsv(Object.assign(new Request(url), { nextUrl: url }) as never);
  };
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { role: "ADMIN" } });
    prismaMock.salesRecord.findMany.mockResolvedValue([{ principal: "Mars-Nairobi" }, { principal: "Suntory-Nairobi" }]);
    prismaMock.outletUniverse.findMany.mockResolvedValue(outlets);
    prismaMock.$queryRaw.mockResolvedValue([{ ref: "OI-5", source: "PINE", outletKey: "1" }]);
  });

  it("is refused without access", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER", allowedPages: [] } });
    expect((await get("period=2026-11")).status).toBe(403);
  });

  it("says which months are not loaded", async () => {
    prismaMock.salesLineMonth.findMany.mockResolvedValue([]);
    const response = await get("period=2026-11");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("2026-11");
  });

  it("streams the header and every line of the selected principals", async () => {
    prismaMock.salesLineMonth.findMany.mockResolvedValue([{ year: "2026", monthIndex: 10, syncedAt: new Date() }]);
    prismaMock.salesLine.findMany.mockResolvedValue([{ ...line({ numAtCard: "oi-5" }), id: "a", docDate: new Date("2026-11-05T00:00:00Z"), creationDate: null, dueDate: new Date("2026-11-19T00:00:00Z") }]);
    const response = await get("period=2026-11&principal=mars");
    const text = await response.text();
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(text.split("\r\n")[0]).toContain("SFA Customer Name,SFA Contact,Customer Ref Remarks");
    expect(text).toContain("Jebbs Supermarket,0703655088,Original");
    expect(text).toContain("Pine,1,Jebbs Supermarket,Retail,Supermarkets,Nairobi East,Umoja,,Grace,Invoice reference");
    expect(prismaMock.salesLine.findMany.mock.calls[0][0].where.principal).toEqual({ in: ["Mars-Nairobi"] });
  });
});
