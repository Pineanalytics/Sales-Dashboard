import { describe, expect, it } from "vitest";
import { buildPurchaseSummary, monthsWithoutData, type ReceiptLine } from "../lib/purchaseReceipts/summary";

const line = (over: Partial<ReceiptLine>): ReceiptLine => ({
  year: 2026,
  monthIndex: 9,
  docDate: "2026-10-05",
  docType: "GOODS_RECEIPT_PO",
  docEntry: 1,
  docNum: "1",
  supplierCode: "S-0124",
  supplierName: "Mars Wrigley",
  itemCode: "M1",
  itemName: "Snickers 50g",
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

const OCT = [{ year: 2026, monthIndex: 9 }];
const Q4 = [{ year: 2026, monthIndex: 9 }, { year: 2026, monthIndex: 10 }];

const lines: ReceiptLine[] = [
  line({}),
  line({ docEntry: 2, itemCode: "M2", itemName: "Twix", value: 300_000, cases: 60 }),
  line({ docEntry: 3, docType: "GOODS_RETURN", value: -50_000, cases: -10, qty: -120 }),
  line({ docEntry: 4, docType: "AP_CREDIT", value: -5_000, cases: 0, qty: 0 }),
  line({ docEntry: 5, docType: "LANDED_COST", value: 20_000, cases: 0, qty: 0 }),
  line({ docEntry: 6, supplierCode: "S-0075", supplierName: "Kenya Breweries", principal: "EABL-Nyeri", warehouseCode: "EABL-NYR", location: "Nyeri", itemCode: "K1", itemName: "Guinness", value: 900_000, cases: 200 }),
  line({ docEntry: 7, supplierCode: "S-0075", supplierName: "Kenya Breweries", principal: "EABL-Nyahururu", warehouseCode: "NYH", location: "Nyahururu", itemCode: "K2", itemName: "Pilsner", value: 100_000, cases: 20 }),
  line({ docEntry: 8, supplierCode: "S-0075", supplierName: "Kenya Breweries", principal: "EABL-Nyahururu", warehouseCode: "WH031", location: "Nyahururu", stockClass: "EMPTIES", itemCode: "K9", itemName: "Crate", value: 40_000, cases: 4 }),
  line({ docEntry: 9, supplierCode: "S-0229", supplierName: "Trade Roots", principal: "Unallocated", principalSource: "UNALLOCATED", itemCode: "TR1", itemName: "Rice", value: 70_000, cases: 0, qty: 500 }),
  line({ docEntry: 10, year: 2026, monthIndex: 10, docDate: "2026-11-02", value: 80_000, cases: 8 }),
  line({ docEntry: 11, year: 2026, monthIndex: 8, docDate: "2026-09-02", value: 999_999 }),
];

describe("the Purchases summary", () => {
  const summary = buildPurchaseSummary(lines, OCT, null);

  it("keeps only the months of the period", () => {
    expect(summary.byMonth).toHaveLength(1);
    expect(summary.totals.net).toBe(500_000 + 300_000 - 50_000 - 5_000 + 20_000 + 900_000 + 100_000 + 70_000);
  });

  it("splits receipts from returns & credits and other adjustments, with returns negative and net their sum", () => {
    expect(summary.totals.receipts).toBe(500_000 + 300_000 + 900_000 + 100_000 + 70_000);
    expect(summary.totals.returns).toBe(-55_000);
    expect(summary.totals.other).toBe(20_000);
    expect(summary.totals.net).toBe(summary.totals.receipts + summary.totals.returns + summary.totals.other);
    expect(summary.totals.netCases).toBe(100 + 60 - 10 + 200 + 20);
  });

  it("keeps empties out of every headline figure and reports them on their own", () => {
    expect(summary.empties).toMatchObject({ lines: 1, receipts: 40_000, net: 40_000 });
    expect(summary.byWarehouse.map((w) => w.key)).not.toContain("WH031");
    expect(summary.byPrincipal.find((p) => p.key === "EABL-Nyahururu")?.net).toBe(100_000);
  });

  it("ranks principals by net value and rolls locations of a brand together", () => {
    expect(summary.byPrincipal.map((p) => p.key)).toEqual(["EABL-Nyeri", "Mars-Nairobi", "EABL-Nyahururu", "Unallocated"]);
    const eabl = summary.byBrand.find((b) => b.label === "EABL");
    expect(eabl?.net).toBe(1_000_000);
    expect(summary.byBrand.map((b) => b.label)).toEqual(["EABL", "Mars", "Unallocated"]);
  });

  it("counts a document once however many lines it has, and the suppliers behind the period", () => {
    const withSecondLine = buildPurchaseSummary([...lines, line({ docEntry: 1, itemCode: "M3", value: 1, cases: 0, qty: 1 })], OCT, null);
    expect(withSecondLine.byPrincipal.find((p) => p.key === "Mars-Nairobi")?.docs).toBe(summary.byPrincipal.find((p) => p.key === "Mars-Nairobi")?.docs);
    expect(summary.totals.suppliers).toBe(3);
  });

  it("filters by the dashboard's brand key", () => {
    const eabl = buildPurchaseSummary(lines, OCT, "eabl");
    expect(eabl.totals.net).toBe(1_000_000);
    expect(eabl.byPrincipal.map((p) => p.key)).toEqual(["EABL-Nyeri", "EABL-Nyahururu"]);
  });

  it("lays net value out by principal and month, in the order of the months", () => {
    const q4 = buildPurchaseSummary(lines, Q4, "mars");
    const mars = q4.monthlyByPrincipal.find((p) => p.principal === "Mars-Nairobi");
    expect(mars?.months).toEqual([500_000 + 300_000 - 50_000 - 5_000 + 20_000, 80_000]);
    expect(mars?.total).toBe(mars!.months[0] + mars!.months[1]);
  });

  it("flags unallocated value and lines with no pack size instead of dropping them", () => {
    expect(summary.unallocated).toEqual({ lines: 1, value: 70_000 });
    expect(summary.noPackSize).toEqual({ lines: 1, items: 1 });
    expect(summary.byPrincipal.find((p) => p.key === "Unallocated")?.net).toBe(70_000);
  });

  it("lists which months of the period have no data at all", () => {
    expect(monthsWithoutData(lines, [...Q4, { year: 2026, monthIndex: 11 }])).toEqual([{ year: 2026, monthIndex: 11 }]);
  });
});
