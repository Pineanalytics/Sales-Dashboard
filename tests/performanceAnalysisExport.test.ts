import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { aggregatePerformance } from "../lib/performanceAnalysis/aggregate";
import { buildPerformanceDetail } from "../lib/performanceAnalysis/detail";
import { buildPerformanceWorkbook } from "../lib/performanceAnalysis/workbook";
import type { PerfLine, PerformanceMeta } from "../lib/performanceAnalysis/types";

const line = (over: Partial<PerfLine>): PerfLine => ({
  month: "2026-07",
  doc: "invoice",
  customerCode: "C1",
  customerName: "Gitero Shop",
  rep: "Jane",
  principal: "Mars",
  itemCode: "I1",
  itemName: "Bar 50g",
  warehouse: "Nairobi",
  cases: 10,
  sales: 100_000,
  gp: 10_000,
  ...over,
});

const lines: PerfLine[] = [
  line({ month: "2026-04", sales: 80_000, gp: 8_000 }),
  line({ month: "2026-05", sales: 90_000, gp: 9_000 }),
  line({ month: "2026-06", sales: 95_000, gp: 9_500 }),
  line({ month: "2026-07", sales: 100_000, gp: 10_000 }),
  line({ month: "2026-08", sales: 120_000, gp: 12_000 }),
  line({ month: "2026-09", sales: 130_000, gp: 13_000 }),
  line({ month: "2026-07", customerCode: "C2", customerName: "VAN SALES 1", itemCode: "I2", itemName: "Gum", principal: "EABL", rep: "Joe", warehouse: "Nyeri", sales: 60_000, gp: -3_000, cases: 4 }),
  line({ month: "2026-08", customerCode: "C2", customerName: "VAN SALES 1", itemCode: "I2", itemName: "Gum", principal: "EABL", rep: "Joe", warehouse: "Nyeri", doc: "credit", sales: -5_000, gp: -500, cases: -1 }),
];
const scope = ["2026-07", "2026-08", "2026-09"];
const meta: PerformanceMeta = { year: 2026, generatedAt: "2026-10-01T03:00:00.000Z", asOf: "2026-10-01", lineCount: lines.length, excludedSales: 1_234, excludedLines: 3 };

describe("the Performance Analysis detail lists", () => {
  const detail = buildPerformanceDetail(lines, scope);

  it("keeps only the period's months and totals them", () => {
    expect(detail.scope).toEqual(scope);
    const inScope = lines.filter((l) => scope.includes(l.month)).reduce((s, l) => s + l.sales, 0);
    expect(detail.totalSales).toBe(inScope);
    expect(detail.items.reduce((s, i) => s + i.sales, 0)).toBe(inScope);
    expect(detail.customers.reduce((s, c) => s + c.sales, 0)).toBe(inScope);
  });

  it("ranks by sales, lines up the months, and flags internal accounts", () => {
    expect(detail.customers.map((c) => c.code)).toEqual(["C1", "C2"]);
    expect(detail.customers[0].m).toEqual([100_000, 120_000, 130_000]);
    expect(detail.customers[1]).toMatchObject({ internal: true, rep: "Joe", warehouse: "Nyeri", principals: "EABL", months: 2, items: 1 });
    expect(detail.customers[0].internal).toBe(false);
  });

  it("lists every rep and branch with its own totals", () => {
    expect(detail.reps.map((r) => [r.name, r.sales])).toEqual([["Jane", 350_000], ["Joe", 55_000]]);
    expect(detail.warehouses.map((w) => w.name)).toEqual(["Nairobi", "Nyeri"]);
  });
});

describe("the Performance Analysis workbook", () => {
  async function open(): Promise<ExcelJS.Workbook> {
    const payload = aggregatePerformance(lines, { asOf: "2026-10-01", scopeMonths: scope });
    const detail = buildPerformanceDetail(lines, scope);
    const buffer = await buildPerformanceWorkbook({ payload, detail, meta, periodLabel: "Q3 2026", principalLabel: "Mars, EABL", generatedAt: new Date("2026-10-02T08:00:00Z") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  }

  it("has a sheet for every section of the page and for the full lists", async () => {
    const wb = await open();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Principals", "Month on Month", "Top Items", "All Items", "Customers", "All Customers", "Growth & GP", "Branches", "Reps", "Notes"]);
  });

  it("states the filters on the Summary and the Notes", async () => {
    const wb = await open();
    const summary = wb.getWorksheet("Summary")!;
    const text = (sheet: ExcelJS.Worksheet) => sheet.getSheetValues().flat().map(String).join("|");
    expect(text(summary)).toContain("Q3 2026");
    expect(text(summary)).toContain("Mars, EABL");
    expect(text(wb.getWorksheet("Notes")!)).toContain("1,234");
  });

  it("writes real percentages, signed growth and whole-shilling money", async () => {
    const wb = await open();
    const principals = wb.getWorksheet("Principals")!;
    const header = principals.getRow(5).values as unknown[];
    const col = (name: string) => header.indexOf(name);
    const mars = principals.getRow(6);
    expect(mars.getCell(col("Principal")).value).toBe("Mars");
    expect(mars.getCell(col("Net Sales")).numFmt).toContain("#,##0");
    expect(mars.getCell(col("GP %")).numFmt).toBe("0.0%");
    // GP % is stored as a fraction (10% -> 0.1) so Excel's percent format shows it right.
    expect(Number(mars.getCell(col("GP %")).value)).toBeCloseTo(0.1, 2);
    expect(principals.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(principals.autoFilter).toBeTruthy();
  });

  it("totals the all-customers sheet to the period's sales", async () => {
    const wb = await open();
    const sheet = wb.getWorksheet("All Customers")!;
    const header = sheet.getRow(5).values as unknown[];
    const net = header.indexOf("Net Sales");
    expect(sheet.getRow(6).getCell(header.indexOf("Customer")).value).toBe("Gitero Shop");
    const total = sheet.getRow(6 + 2).getCell(net).value;
    expect(total).toBe(405_000);
  });
});
