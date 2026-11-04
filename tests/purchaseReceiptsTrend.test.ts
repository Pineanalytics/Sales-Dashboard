import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildPurchaseSummary, type ReceiptLine } from "../lib/purchaseReceipts/summary";
import { activeMonthCount, buildTrend, primaryShareOfSecondary, type SecondaryMonthRow } from "../lib/purchaseReceipts/trend";
import { buildPurchaseWorkbook } from "../lib/purchaseReceipts/workbook";

const line = (over: Partial<ReceiptLine>): ReceiptLine => ({
  year: 2026,
  monthIndex: 0,
  docDate: "2026-01-05",
  docType: "GOODS_RECEIPT_PO",
  docEntry: 1,
  docNum: "1",
  supplierCode: "S-1",
  supplierName: "Mars Wrigley",
  itemCode: "M1",
  itemName: "Snickers",
  warehouseCode: "NRB",
  location: "Nairobi",
  principal: "Mars-Nairobi",
  principalSource: "PRODUCT",
  stockClass: "GOODS",
  qty: 1200,
  cases: 100,
  value: 500_000,
  ...over,
});

const sale = (over: Partial<SecondaryMonthRow>): SecondaryMonthRow => ({ year: 2026, monthIndex: 0, principal: "Mars-Nairobi", cases: 80, value: 600_000, ...over });

const months = [0, 1, 2].map((monthIndex) => ({ year: 2026, monthIndex }));
const lines: ReceiptLine[] = [
  line({}),
  line({ docEntry: 2, docType: "GOODS_RETURN", cases: -10, value: -50_000 }),
  line({ docEntry: 3, monthIndex: 1, docDate: "2026-02-03", cases: 60, value: 300_000 }),
  line({ docEntry: 4, principal: "EABL-Nyeri", supplierCode: "S-2", itemCode: "K1", cases: 200, value: 900_000 }),
  line({ docEntry: 5, principal: "EABL-Nyahururu", stockClass: "EMPTIES", itemCode: "K9", cases: 5, value: 40_000 }),
  line({ docEntry: 6, monthIndex: 5, docDate: "2026-06-01", value: 999 }),
];
const sales: SecondaryMonthRow[] = [
  sale({}),
  sale({ monthIndex: 1, cases: 90, value: 650_000 }),
  sale({ principal: "EABL-Nyeri", cases: 150, value: 1_000_000 }),
  sale({ principal: "EABL-Nyahururu", cases: 20, value: 100_000 }),
  sale({ monthIndex: 5, value: 1 }),
];

describe("the primary vs secondary trend", () => {
  const trend = buildTrend(lines, sales, months, null);

  it("lays primary and secondary out by month across the period, leaving other months and empties out", () => {
    expect(trend.total.primaryValue).toEqual([500_000 - 50_000 + 900_000, 300_000, 0]);
    expect(trend.total.primaryCases).toEqual([100 - 10 + 200, 60, 0]);
    expect(trend.total.secondaryValue).toEqual([600_000 + 1_000_000 + 100_000, 650_000, 0]);
    expect(trend.total.secondaryCases).toEqual([80 + 150 + 20, 90, 0]);
  });

  it("breaks the same figures down by brand, largest first, with locations of a brand together", () => {
    // Ranked by the larger of primary or secondary across the period: Mars (1.25m sales) ahead of EABL (1.1m).
    expect(trend.byBrand.map((b) => b.label)).toEqual(["Mars", "EABL"]);
    const eabl = trend.byBrand[1];
    expect(eabl.primaryValue[0]).toBe(900_000);
    expect(eabl.secondaryValue[0]).toBe(1_100_000);
    expect(trend.byBrand.reduce((s, b) => s + b.primaryValue[0], 0)).toBe(trend.total.primaryValue[0]);
  });

  it("narrows both sides to the principal picked, the same way", () => {
    const mars = buildTrend(lines, sales, months, "Mars-Nairobi");
    expect(mars.total.primaryValue).toEqual([450_000, 300_000, 0]);
    expect(mars.total.secondaryValue).toEqual([600_000, 650_000, 0]);
    const eablBrand = buildTrend(lines, sales, months, "eabl");
    expect(eablBrand.total.primaryValue[0]).toBe(900_000);
    expect(eablBrand.total.secondaryValue[0]).toBe(1_100_000);
  });

  it("compares primary with secondary, and has nothing to compare when there are no sales", () => {
    expect(primaryShareOfSecondary(450, 900)).toBe(50);
    expect(primaryShareOfSecondary(450, 0)).toBeNull();
  });

  it("averages across the months that have activity", () => {
    expect(activeMonthCount(trend.total)).toBe(2);
  });
});

describe("the Primary vs Secondary sheet", () => {
  async function sheet(): Promise<ExcelJS.Worksheet> {
    const summary = buildPurchaseSummary(lines, months, null);
    const buffer = await buildPurchaseWorkbook({ summary, trend: buildTrend(lines, sales, months, null), lines, missingMonths: [], syncedAt: null, periodLabel: "Q1 2026", principalLabel: "All principals", generatedAt: new Date("2026-11-04T12:00:00Z") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb.getWorksheet("Primary vs Secondary")!;
  }
  const rowOf = (ws: ExcelJS.Worksheet, group: string, measure: string): ExcelJS.Row => {
    let found: ExcelJS.Row | undefined;
    let current = "";
    ws.eachRow((row) => {
      const a = row.getCell(1).value;
      if (typeof a === "string" && a) current = a;
      if (!found && current === group && row.getCell(2).value === measure) found = row;
    });
    if (!found) throw new Error(`no row ${group} / ${measure}`);
    return found;
  };

  it("has months across with Totals, Average and Primary % of Secondary columns", async () => {
    const ws = await sheet();
    const header = ws.getRow(5).values as unknown[];
    expect(header.slice(3)).toEqual(["January", "February", "March", "Totals", "Average", "Primary % of Secondary"]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 5 });
  });

  it("writes Primary and Secondary, cases and value, with the total and the average over active months", async () => {
    const ws = await sheet();
    const primaryValue = rowOf(ws, "Primary", "Value");
    expect([3, 4, 5].map((c) => primaryValue.getCell(c).value)).toEqual([1_350_000, 300_000, 0]);
    expect(primaryValue.getCell(6).value).toBe(1_650_000);
    expect(primaryValue.getCell(7).value).toBe(825_000);
    expect(primaryValue.getCell(3).numFmt).toContain("#,##0");
    const secondaryCases = rowOf(ws, "Secondary", "Cases");
    expect(secondaryCases.getCell(6).value).toBe(250 + 90);
  });

  it("adds the Primary % of Secondary column on the primary rows and a comparison block", async () => {
    const ws = await sheet();
    const primaryValue = rowOf(ws, "Primary", "Value");
    expect(Number(primaryValue.getCell(8).value)).toBeCloseTo(1_650_000 / 2_350_000, 6);
    expect(primaryValue.getCell(8).numFmt).toBe("0.0%");
    const share = rowOf(ws, "Primary vs Secondary", "Value: primary % of secondary");
    expect(Number(share.getCell(3).value)).toBeCloseTo(1_350_000 / 1_700_000, 6);
    expect(share.getCell(5).value).toBeNull();
    const gap = rowOf(ws, "Primary vs Secondary", "Value: primary less secondary");
    expect(gap.getCell(3).value).toBe(1_350_000 - 1_700_000);
  });

  it("repeats a compact set for each brand beneath the total", async () => {
    const ws = await sheet();
    const text = ws.getSheetValues().flat().map(String).join("|");
    expect(text).toContain("By brand");
    expect(text).toContain("EABL");
    expect(text).toContain("Mars");
  });
});
