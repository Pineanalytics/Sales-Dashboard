import { describe, expect, it } from "vitest";
import { buildDirectStock } from "@/scripts/db-bridge/transform/buildDirectStock";
import { compareDirectStockToExcel } from "@/lib/stockSync";

describe("direct SAP stock transform", () => {
  it("combines physical inventory and YTD demand into dashboard week and cover fields", () => {
    const result = buildDirectStock(
      [{ itemCode: "SKU-1", itemName: "Widget", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 20, avgPrice: 70, stockValue: 1400 }],
      [{ itemCode: "SKU-1", warehouseCode: "W1", itemName: "Widget", quantityUnits: 60, sumQuantitySquared: 0, salesValue: 600, sellingDays: 3, firstSale: new Date("2026-01-01T00:00:00Z"), lastSale: new Date("2026-01-07T00:00:00Z") }],
      [{ itemCode: "SKU-1", warehouseCode: "W1", lastSaleDate: new Date("2026-01-07T00:00:00Z") }],
      [{ itemNo: "SKU-1", packSize: 10, principal: "Mars", costPrice: null, classification: "" , ssuConversion: null }],
      [{ warehouseCode: "W1", warehouseName: "Nairobi", location: "Nairobi", locationCode: "NBO" }],
      [{ key: "mars-nairobi", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "NBO", status: "Active", teamLeader: "" }],
      new Date("2026-01-07T00:00:00Z")
    );

    expect(result.matchedDemandRows).toBe(1);
    expect(result.items).toEqual([expect.objectContaining({
      itemCode: "SKU-1",
      principal: "Mars-Nairobi",
      openingVolume: 2,
      openingPcs: 20,
      openingValue: 1400,
      rrWeekValue: 700,
      rrWeekVolume: 7,
      daysCover: 14,
      action: "🟢 OK",
    })]);
  });

  it("moves zero-value items with no invoice in three months to the dormant overview", () => {
    const result = buildDirectStock(
      [{ itemCode: "SKU-2", itemName: "Dormant widget", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 0, avgPrice: null, stockValue: 0 }],
      [], [],
      [{ itemNo: "SKU-2", packSize: 10, principal: "Mars", costPrice: null, classification: "", ssuConversion: null }],
      [{ warehouseCode: "W1", warehouseName: "Nairobi", location: "Nairobi", locationCode: "NBO" }],
      [{ key: "mars-nairobi", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "NBO", status: "Active", teamLeader: "" }],
      new Date("2026-08-13T00:00:00Z")
    );
    expect(result.items).toEqual([]);
    expect(result.dormantItems).toEqual([expect.objectContaining({ principal: "Mars-Nairobi", item: "Dormant widget", openingValue: 0, lastSaleDate: null })]);
  });

  it("compares direct rows to the Excel stock snapshot at principal-item grain", () => {
    const comparison = compareDirectStockToExcel(
      [
        { principal: "Mars-Nairobi", item: "Widget", openingValue: 110 },
        { principal: "Mars-Nairobi", item: "SAP only", openingValue: 50 },
      ],
      [
        { principal: "Mars-Nairobi", key: "mars-nairobi", item: "Widget", openingVolume: 0, openingPcs: 0, openingValue: 100, rrWeekValue: 0, rrWeekVolume: 0, daysCover: 0, action: "⚪ No Sales Data" },
        { principal: "Mars-Nairobi", key: "mars-nairobi", item: "Excel only", openingVolume: 0, openingPcs: 0, openingValue: 100, rrWeekValue: 0, rrWeekVolume: 0, daysCover: 0, action: "⚪ No Sales Data" },
      ],
      "snapshot-1"
    );
    expect(comparison).toMatchObject({ excelRows: 2, matchedRows: 1, onlySapRows: 1, onlyExcelRows: 1, excelStockValue: 200, directStockValue: 160, stockValueVariancePct: -20 });
  });
});
