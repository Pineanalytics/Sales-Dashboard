import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildPurchaseReceipts } from "../scripts/db-bridge/transform/buildPurchaseReceipts";
import type { PurchaseReceiptSapRow } from "../scripts/db-bridge/queries/purchaseReceipts";
import type { ProductRow } from "../scripts/db-bridge/reference/loadFromDb";
import type { WarehouseRow } from "../scripts/db-bridge/transform/buildMonthlySales";
import { buildPurchaseSummary, type ReceiptLine } from "../lib/purchaseReceipts/summary";
import { buildTrend } from "../lib/purchaseReceipts/trend";
import { buildPurchaseWorkbook } from "../lib/purchaseReceipts/workbook";

const product = (itemNo: string, principal: string, packSize: number | null): ProductRow => ({ itemNo, packSize, principal, costPrice: null, classification: "", ssuConversion: null });
const products = [product("M1", "Mars", 12), product("K1", "EABL", 24), product("NOPACK", "Mars", null)];
const warehouse = (warehouseCode: string, warehouseName: string, location: string): WarehouseRow => ({ warehouseCode, warehouseName, location, locationCode: location.slice(0, 3).toUpperCase() });
const warehouses = [warehouse("NRB", "Nairobi Main Warehouse", "Nairobi"), warehouse("NYR", "Nyeri Main Warehouse", "Nyeri"), warehouse("WH031", "EMPTIES- NYAHURURU", "Nyahururu")];

const sap = (over: Partial<PurchaseReceiptSapRow>): PurchaseReceiptSapRow => ({
  transType: 20,
  docEntry: 100,
  docNum: "100",
  docDate: new Date("2026-10-05T00:00:00Z"),
  supplierCode: "S-1",
  supplierName: "Supplier One",
  itemCode: "M1",
  itemName: "Snickers 50g",
  whsCode: "NRB",
  qty: 1200,
  value: 500_000,
  ...over,
});

describe("building receipt lines from the stock ledger", () => {
  it("attributes a line the way sales do: Product master principal plus the warehouse's location", () => {
    const { rows } = buildPurchaseReceipts([sap({}), sap({ docEntry: 101, itemCode: "K1", whsCode: "NYR", qty: 2400, value: 900_000 })], products, warehouses);
    expect(rows.map((r) => [r.itemCode, r.principal, r.principalSource, r.location])).toEqual([
      ["M1", "Mars-Nairobi", "PRODUCT", "Nairobi"],
      ["K1", "EABL-Nyeri", "PRODUCT", "Nyeri"],
    ]);
  });

  it("converts pieces to cases with the pack size, and reads 0 cases when the item has none", () => {
    const { rows } = buildPurchaseReceipts([sap({}), sap({ docEntry: 102, itemCode: "NOPACK", qty: 600, value: 10_000 })], products, warehouses);
    expect(rows[0].cases).toBe(100);
    expect(rows[1].cases).toBe(0);
  });

  it("keeps an item with no principal as Unallocated and counts its value rather than dropping it", () => {
    const { rows, stats } = buildPurchaseReceipts([sap({ docEntry: 103, itemCode: "ZZ999", itemName: "Mystery", value: 42_000, qty: 10 })], products, warehouses);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ principal: "Unallocated", principalSource: "UNALLOCATED" });
    expect(stats.valueBySource.UNALLOCATED).toBe(42_000);
    expect(stats.unallocatedItems).toEqual([{ itemCode: "ZZ999", itemName: "Mystery", value: 42_000 }]);
  });

  it("drops a document and its cancellation that net to nothing, and keeps real returns negative", () => {
    const { rows, stats } = buildPurchaseReceipts([sap({ docEntry: 104, qty: 0, value: 0 }), sap({ docEntry: 105, transType: 21, qty: -120, value: -50_000 })], products, warehouses);
    expect(stats.droppedRows).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ docType: "GOODS_RETURN", qty: -120, value: -50_000, cases: -10 });
  });

  it("marks stock in an empties warehouse as empties", () => {
    const { rows } = buildPurchaseReceipts([sap({ docEntry: 106, whsCode: "WH031" })], products, warehouses);
    expect(rows[0].stockClass).toBe("EMPTIES");
    expect(buildPurchaseReceipts([sap({})], products, warehouses).rows[0].stockClass).toBe("GOODS");
  });

  it("ignores movement types that are not purchases", () => {
    expect(buildPurchaseReceipts([sap({ transType: 67 })], products, warehouses).rows).toHaveLength(0);
  });
});

describe("the Purchases workbook", () => {
  const lines: ReceiptLine[] = buildPurchaseReceipts(
    [
      sap({}),
      sap({ docEntry: 101, itemCode: "K1", whsCode: "NYR", supplierCode: "S-2", supplierName: "Brewer", qty: 2400, value: 900_000 }),
      sap({ docEntry: 105, transType: 21, qty: -120, value: -50_000 }),
      sap({ docEntry: 106, whsCode: "WH031", value: 7_000 }),
    ],
    products,
    warehouses
  ).rows.map((r) => ({ ...r, year: 2026, monthIndex: 9 }));
  const months = [{ year: 2026, monthIndex: 9 }];

  async function open(register = true): Promise<ExcelJS.Workbook> {
    const summary = buildPurchaseSummary(lines, months, null);
    const buffer = await buildPurchaseWorkbook({ summary, trend: buildTrend(lines, [], months, null), lines: register ? lines : null, missingMonths: [], syncedAt: "2026-11-04T10:00:00.000Z", periodLabel: "Oct 2026", principalLabel: "All principals", generatedAt: new Date("2026-11-04T12:00:00Z") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  }

  it("has a sheet for each roll-up, the month views, the items, the register and the notes", async () => {
    const wb = await open();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Primary vs Secondary", "By Principal", "By Brand", "By Supplier", "By Warehouse", "Month on Month", "Totals by Month", "Top Items", "Receipt Register", "Notes"]);
  });

  it("leaves the register out when the selection is too large to list", async () => {
    const wb = await open(false);
    expect(wb.getWorksheet("Receipt Register")).toBeUndefined();
  });

  it("writes net receipts as whole-shilling money, with returns negative and empties kept out", async () => {
    const wb = await open();
    const sheet = wb.getWorksheet("By Principal")!;
    const header = sheet.getRow(5).values as unknown[];
    const net = header.indexOf("Net receipts");
    const names = [6, 7].map((r) => String(sheet.getRow(r).getCell(1).value));
    expect(names).toEqual(["EABL-Nyeri", "Mars-Nairobi"]);
    expect(sheet.getRow(6).getCell(net).value).toBe(900_000);
    expect(sheet.getRow(7).getCell(net).value).toBe(450_000);
    expect(sheet.getRow(7).getCell(net).numFmt).toContain("#,##0");
    expect(sheet.getRow(8).getCell(net).value).toBe(1_350_000);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
  });

  it("states the filters, the sync time and the empties on the Summary", async () => {
    const wb = await open();
    const text = wb.getWorksheet("Summary")!.getSheetValues().flat().map(String).join("|");
    expect(text).toContain("Oct 2026");
    expect(text).toContain("All principals");
    expect(text).toContain("2026-11-04 10:00 UTC");
    expect(text).toContain("Empties");
  });
});
