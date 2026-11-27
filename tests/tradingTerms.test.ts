import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const prismaMock = vi.hoisted(() => ({
  salesLineMonth: { findMany: vi.fn() },
  salesRecord: { findMany: vi.fn() },
  receivablesSyncRun: { findFirst: vi.fn() },
  customerCreditProfile: { findMany: vi.fn() },
  receivableOpenItem: { groupBy: vi.fn() },
  $queryRaw: vi.fn(),
}));
const authMock = vi.hoisted(() => vi.fn());
const scopeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/teamLeaderScope", () => ({ resolveScopeForSession: scopeMock }));

import { GET } from "@/app/api/receivables/trading-terms/route";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";
import { buildTradingTerms, termClass, termName, type TermAccount, type TermCustomerRow, type TermMonthRow, type TradingTermsScope } from "@/lib/tradingTerms";
import type { ExtractSheet } from "@/lib/brandCustomerExtract";

const row = (over: Partial<TermCustomerRow>): TermCustomerRow => ({
  principal: "Mars-Nairobi", sfaName: "Busbul Supermarket", customerName: "BUSBUL SUPERMARKET", cardCode: "C-1", paymentTerm: "14 Days", paymentTermDays: 14,
  sales: 100, invoices: 1, datedValue: 100, dayValue: 1400, lastInvoice: "2026-11-02", ...over,
});
const customerRows: TermCustomerRow[] = [
  // Busbul: 14 days with Mars (two branches), cash with Unilever, under two accounts and two spellings.
  row({ sales: 500, datedValue: 500, dayValue: 7000 }),
  row({ principal: "Mars-Nyeri", sfaName: "BUSBUL  supermarket (0700)", sales: 100, datedValue: 100, dayValue: 1400 }),
  row({ principal: "Unilever-Nairobi", cardCode: "C-2", paymentTerm: "- Cash Basic -", paymentTermDays: 0, sales: 200, datedValue: 200, dayValue: 0, lastInvoice: "2026-11-09" }),
  // A van account serving a shop with no credit.
  row({ sfaName: "Zuri Shop", customerName: "Van 9", cardCode: "Van-09", paymentTerm: "COD", paymentTermDays: 1, sales: 250 }),
  row({ sfaName: "Amani Kiosk", customerName: "Van 9", cardCode: "Van-09", paymentTerm: "- Cash Basic -", paymentTermDays: 0, sales: 40 }),
  row({ sfaName: null, customerName: "STOCK LOST BY STAFF", cardCode: "C-9", sales: 10 }),
];
const month = (principal: string, paymentTerm: string | null, sales: number, m = "2026-11"): TermMonthRow => ({ principal, month: m, paymentTerm, paymentTermDays: null, sales });
const monthRows = [
  month("Mars-Nairobi", "14 Days", 510),
  month("Mars-Nairobi", "COD", 250),
  month("Mars-Nairobi", "- Cash Basic -", 40),
  month("Mars-Nyeri", "14 Days", 100),
  month("Unilever-Nairobi", "- Cash Basic -", 200),
  month("Unilever-Nairobi", null, 50, "2026-10"),
];
const accounts = new Map<string, TermAccount>([["C-1", { term: "7 Days", creditLimit: 5000, outstanding: 900 }]]);
const scope: TradingTermsScope = { principalLabel: "All principals", periodLabel: "2026-01 to 2026-11", generatedAt: new Date("2026-11-27T08:00:00Z"), dataAsOf: null, receivablesAsOf: null, missingMonths: [] };
const sheet = (sheets: ExtractSheet[], name: string) => sheets.find((s) => s.name === name)!;
const records = (s: ExtractSheet) => s.rows.map((cells) => Object.fromEntries(s.columns.map((column, i) => [column, cells[i]])));

describe("cash or credit", () => {
  it("is cash only where the term says Cash or COD", () => {
    expect(["- Cash Basic -", "COD", "C.O.D", "Cash"].map(termClass)).toEqual(["Cash", "Cash", "Cash", "Cash"]);
    // SAP holds "60 Days" with no days against it: the name still makes it credit.
    expect(["1 Day", "60 Days", "5DAYS", "30Days"].map(termClass)).toEqual(["Credit", "Credit", "Credit", "Credit"]);
    expect([null, "  "].map(termClass)).toEqual(["Not recorded", "Not recorded"]);
    expect(["- Cash Basic -", " 14 Days ", null].map(termName)).toEqual(["Cash Basic", "14 Days", "Not recorded"]);
  });
});

describe("the trading terms report", () => {
  const report = buildTradingTerms(monthRows, customerRows, accounts);
  const sheets = report.sheets(scope);

  it("splits each principal's sales into cash and credit, counting branches together", () => {
    expect(report.summary.total).toEqual({ sales: 1150, cash: 490, credit: 610, unrecorded: 50 });
    expect(report.summary.principals).toEqual([
      { principal: "Mars", sales: 900, cash: 290, credit: 610, unrecorded: 0, customers: 3, cashCustomers: 2, creditCustomers: 1, topCustomers: 2 },
      { principal: "Unilever", sales: 250, cash: 200, credit: 0, unrecorded: 50, customers: 1, cashCustomers: 1, creditCustomers: 0, topCustomers: 1 },
    ]);
    expect(records(sheet(sheets, "Principal by Branch")).map((r) => r["Principal (Branch)"])).toEqual(["Mars-Nairobi", "Unilever-Nairobi", "Mars-Nyeri"]);
    const monthly = records(sheet(sheets, "Cash vs Credit by Month"));
    expect(monthly[1]).toMatchObject({ Principal: "Unilever", "Oct 2026 Cash %": 0, "Nov 2026 Cash %": 100, "Nov 2026 Credit %": 0 });
    expect(records(sheet(sheets, "Sales % by Term"))[0]).toMatchObject({ Principal: "Mars", "14 Days %": 67.8, "COD %": 27.8 });
  });

  it("ranks the customers making 80% of sales, with their terms and the account behind them", () => {
    expect(report.summary).toMatchObject({ customers: 3, topCustomers: 2, topSales: 1050 });
    const top = records(sheet(sheets, "Top 80% Customers"));
    expect(top.map((r) => r.Customer)).toEqual(["BUSBUL SUPERMARKET", "ZURI SHOP"]);
    expect(top[0]).toMatchObject({
      "% Share": 73.4, "Principals Bought": 2, "Different Terms by Principal": "Yes", "Terms by Principal": "Mars: 14 Days; Unilever: Cash Basic",
      "Main Term": "14 Days", "Cash or Credit": "Both", "All Terms Used": "14 Days 75%, Cash Basic 25%", "Net Sales": 800, "Credit %": 75, Invoices: 3, "Last Invoice": "2026-11-09",
      "Main Account Code": "C-1", "Accounts Used": 2, "Account Term Today": "7 Days", "Account Credit Limit": 5000, "Account Outstanding": 900, "Customers Sharing Account": 1,
      "Avg Days to Due Date": 10.5,
    });
    // The van account is shared by two shops, and has no receivables profile here.
    expect(top[1]).toMatchObject({ "Cash or Credit": "Cash", "Account Term Today": "", "Customers Sharing Account": 2, "Different Terms by Principal": "" });
  });

  it("lists the customers whose terms differ between principals, one row per principal", () => {
    expect(report.summary).toMatchObject({ differingCustomers: 1, differingSales: 800 });
    expect(records(sheet(sheets, "Different Terms")).map((r) => [r.Customer, r.Principal, r["Main Term"], r["Net Sales"]])).toEqual([
      ["BUSBUL SUPERMARKET", "Mars", "14 Days", 600],
      ["BUSBUL SUPERMARKET", "Unilever", "Cash Basic", 200],
    ]);
  });

  it("leaves accounts that are not customers out of the rankings, and says which", () => {
    expect(report.summary.leftOut).toEqual([{ customer: "STOCK LOST BY STAFF", sales: 10 }]);
    const note = sheet(sheets, "Summary").rows.find((r) => r[0] === "Left out of customer rankings")!;
    expect(note[1]).toContain("STOCK LOST BY STAFF");
  });

  it("keeps a shop's sale billed to a principal's account as the shop's, but leaves a stock loss out under any name", () => {
    const { summary, sheets: build } = buildTradingTerms(monthRows, [
      row({ sfaName: "Betterdeal Wholesalers", customerName: "BIDCO AFRICA LIMITED.", cardCode: "C-7" }),
      row({ sfaName: "John (driver)", customerName: "Stock Lost by Staff", cardCode: "C-9", sales: 20 }),
      row({ sfaName: null, customerName: "BIDCO AFRICA LIMITED.", cardCode: "C-7", sales: 0 }),
    ], accounts);
    expect(records(sheet(build(scope), "Top 80% Customers")).map((r) => r.Customer)).toEqual(["BETTERDEAL WHOLESALERS"]);
    // A name left out with nothing against it is not listed.
    expect(summary.leftOut).toEqual([{ customer: "STOCK LOST BY STAFF", sales: 20 }]);
  });

  it("gives the same answer whatever order sales that cancel out are added in", () => {
    // 0.1 + 0.2 - 0.3 leaves a remainder above zero; 0.1 - 0.3 + 0.2 leaves none.
    const returned = [0.1, 0.2, -0.3].map((sales) => row({ principal: "Unilever-Nairobi", paymentTerm: "COD", sales }));
    for (const order of [returned, [returned[0], returned[2], returned[1]]]) {
      const { summary } = buildTradingTerms(monthRows, [row({ sales: 500 }), ...order], accounts);
      expect(summary.differingCustomers).toBe(0);
      expect(summary.principals.find((p) => p.principal === "Unilever")).toMatchObject({ cashCustomers: 0, topCustomers: 0 });
    }
  });

  it("writes every customer's terms with every principal as CSV", () => {
    const lines = [...report.csv()];
    expect(lines[0].startsWith("Customer,Customer Rank,In Top 80%")).toBe(true);
    expect(lines).toHaveLength(1 + 4);
    expect(lines[1]).toContain("BUSBUL SUPERMARKET,1,Yes,Yes,Mars,14 Days,14,Credit");
  });

  it("makes a workbook with a sheet for each view", () => {
    const workbook = XLSX.read(extractToXlsxBuffer(sheets), { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Summary", "Cash vs Credit by Principal", "Cash vs Credit by Month", "Principal by Branch", "Sales % by Term", "Top 80% Customers", "Top 80% by Principal", "Different Terms"]);
  });
});

describe("GET /api/receivables/trading-terms", () => {
  const get = (query = "") => GET({ nextUrl: new URL(`http://x/api/receivables/trading-terms${query}`) } as never);
  /** The values a $queryRaw call was given: start, end and the principals. */
  const queried = () => prismaMock.$queryRaw.mock.calls[0].slice(1);

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { role: "VIEWER", allowedPages: ["receivables"], allowedPrincipals: [] } });
    scopeMock.mockResolvedValue(null);
    prismaMock.salesRecord.findMany.mockResolvedValue([{ principal: "Mars-Nairobi" }, { principal: "Mars-Nyeri" }, { principal: "Unilever-Nairobi" }]);
    prismaMock.salesLineMonth.findMany.mockResolvedValue([{ year: "2026", monthIndex: 10, syncedAt: new Date("2026-11-27T00:00:00Z") }]);
    prismaMock.receivablesSyncRun.findFirst.mockResolvedValue(null);
    prismaMock.customerCreditProfile.findMany.mockResolvedValue([]);
    prismaMock.receivableOpenItem.groupBy.mockResolvedValue([]);
    prismaMock.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => (strings.join("").includes(`"cardCode"`) ? customerRows : monthRows));
  });

  it("needs the Receivables report", async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    authMock.mockResolvedValue({ user: { role: "VIEWER", allowedPages: ["profitability"] } });
    expect((await get()).status).toBe(403);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("refuses months out of order or too far apart", async () => {
    expect((await get("?from=2026-11&to=2026-01")).status).toBe(400);
    expect((await get("?from=2023-01&to=2026-01")).status).toBe(400);
    expect((await get("?from=2026-13&to=2026-13")).status).toBe(400);
  });

  it("summarises the months asked for and names those not loaded or without terms", async () => {
    const response = await get("?from=2026-10&to=2026-11");
    const body = await response.json();
    expect(body.availablePrincipals).toEqual(["Mars", "Unilever"]);
    expect(body.missingMonths).toEqual(["2026-10"]);
    expect(body.monthsWithoutTerms).toEqual(["2026-10"]);
    expect(body.summary.topCustomers).toBe(2);
    expect(queried()).toEqual(["2026-10-01", "2026-12-01", ["Mars-Nairobi", "Mars-Nyeri", "Unilever-Nairobi"]]);
  });

  it("keeps to the viewer's own principals and the ones chosen", async () => {
    scopeMock.mockResolvedValue({ principals: ["Mars-Nairobi"] });
    await get("?from=2026-11&to=2026-11&principal=Mars&principal=Unilever");
    expect(queried()[2]).toEqual(["Mars-Nairobi", "Mars-Nyeri"]);
  });

  it("downloads the workbook and the CSV", async () => {
    const excel = await get("?from=2026-11&to=2026-11&format=xlsx&principal=Mars");
    expect(excel.headers.get("Content-Disposition")).toContain("trading-terms-mars-2026-11-to-2026-11.xlsx");
    const csv = await get("?from=2026-11&to=2026-11&format=csv");
    const text = await csv.text();
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(5);
    expect(text).toContain("ZURI SHOP");
  });
});
