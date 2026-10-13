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

  it("passes SAP's own Brand/Manufacturer field through to the dashboard item, and null when SAP has none", () => {
    const result = buildDirectStock(
      [
        { itemCode: "SKU-BRANDED", itemName: "Branded widget", itemGroup: null, brand: " Omo ", whsCode: "W1", whsName: "Nairobi", onhandQty: 10, avgPrice: 10, stockValue: 100 },
        { itemCode: "SKU-UNBRANDED", itemName: "Unbranded widget", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 10, avgPrice: 10, stockValue: 100 },
      ],
      [], [],
      [
        { itemNo: "SKU-BRANDED", packSize: 10, principal: "Mars", costPrice: null, classification: "", ssuConversion: null },
        { itemNo: "SKU-UNBRANDED", packSize: 10, principal: "Mars", costPrice: null, classification: "", ssuConversion: null },
      ],
      [{ warehouseCode: "W1", warehouseName: "Nairobi", location: "Nairobi", locationCode: "NBO" }],
      [{ key: "mars-nairobi", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "NBO", status: "Active", teamLeader: "" }],
      new Date("2026-01-07T00:00:00Z")
    );

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemCode: "SKU-BRANDED", brand: "Omo" }),
      expect.objectContaining({ itemCode: "SKU-UNBRANDED", brand: null }),
    ]));
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

  it("carries each item's all-history last sale date through, beyond the three-month dormancy window", () => {
    const result = buildDirectStock(
      [
        { itemCode: "SKU-OLD", itemName: "Old seller", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 5, avgPrice: 10, stockValue: 50 },
        { itemCode: "SKU-GONE", itemName: "Gone seller", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 0, avgPrice: null, stockValue: 0 },
        { itemCode: "SKU-NEVER", itemName: "Never sold", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 0, avgPrice: null, stockValue: 0 },
      ],
      [], [],
      [
        { itemNo: "SKU-OLD", packSize: 1, principal: "Mars", costPrice: null, classification: "", ssuConversion: null },
        { itemNo: "SKU-GONE", packSize: 1, principal: "Mars", costPrice: null, classification: "", ssuConversion: null },
        { itemNo: "SKU-NEVER", packSize: 1, principal: "Mars", costPrice: null, classification: "", ssuConversion: null },
      ],
      [{ warehouseCode: "W1", warehouseName: "Nairobi", location: "Nairobi", locationCode: "NBO" }],
      [{ key: "mars-nairobi", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "NBO", status: "Active", teamLeader: "" }],
      new Date("2026-10-07T00:00:00Z"),
      [{ itemCode: "SKU-OLD", lastSaleDate: new Date("2026-03-14T08:30:00Z") }, { itemCode: "SKU-GONE", lastSaleDate: new Date("2025-11-02T00:00:00Z") }]
    );
    // SKU-OLD still has stock but last sold in March, outside the three-month window: it is dormant (stock with no movement), not operational
    expect(result.items).toEqual([]);
    expect(result.dormantItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemCode: "SKU-OLD", openingPcs: 5, openingValue: 50, lastSaleDate: new Date("2026-03-14T00:00:00Z") }),
      expect.objectContaining({ itemCode: "SKU-GONE", lastSaleDate: new Date("2025-11-02T00:00:00Z") }),
      expect.objectContaining({ itemCode: "SKU-NEVER", lastSaleDate: null }),
    ]));
  });

  it("uses the SKU code when SAP has a stock row without an item name", () => {
    const result = buildDirectStock(
      [{ itemCode: "SKU-NAMELESS", itemName: "", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 0, avgPrice: null, stockValue: 0 }],
      [], [],
      [{ itemNo: "SKU-NAMELESS", packSize: 10, principal: "Mars", costPrice: null, classification: "", ssuConversion: null }],
      [{ warehouseCode: "W1", warehouseName: "Nairobi", location: "Nairobi", locationCode: "NBO" }],
      [{ key: "mars-nairobi", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "NBO", status: "Active", teamLeader: "" }],
      new Date("2026-08-13T00:00:00Z")
    );
    expect(result.dormantItems).toEqual([expect.objectContaining({ item: "SKU-NAMELESS" })]);
  });

  it("keeps zero-valued stock with physical pieces on hand in the operational list", () => {
    const result = buildDirectStock(
      [{ itemCode: "SKU-FREE", itemName: "Free stock", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 5, avgPrice: null, stockValue: 0 }],
      [], [],
      [{ itemNo: "SKU-FREE", packSize: 1, principal: "Mars", costPrice: null, classification: "", ssuConversion: null }],
      [{ warehouseCode: "W1", warehouseName: "Nairobi", location: "Nairobi", locationCode: "NBO" }],
      [{ key: "mars-nairobi", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "NBO", status: "Active", teamLeader: "" }],
      new Date("2026-08-13T00:00:00Z")
    );
    expect(result.items).toEqual([expect.objectContaining({ item: "Free stock", openingPcs: 5 })]);
    expect(result.dormantItems).toEqual([]);
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

  it("does not overstate matches when direct labels collapse to one dashboard item", () => {
    const comparison = compareDirectStockToExcel(
      [
        { principal: "Mars-Nairobi", item: "Widget", openingValue: 100 },
        { principal: "Mars-Mombasa", item: " widget ", openingValue: 0 },
      ],
      [{ principal: "Mars-Nairobi", key: "mars-nairobi", item: "Widget", openingVolume: 0, openingPcs: 0, openingValue: 100, rrWeekValue: 0, rrWeekVolume: 0, daysCover: 0, action: "âšª No Sales Data" }],
      "snapshot-1"
    );
    expect(comparison).toMatchObject({ excelRows: 1, matchedRows: 1, onlySapRows: 0, onlyExcelRows: 0, directStockValue: 100 });
  });
});

describe("dormant stock with pieces on hand, and the standard run rate", () => {
  const products = [
    { itemNo: "SKU-1", packSize: 1, principal: "Mars", costPrice: null, classification: "", ssuConversion: null },
    { itemNo: "SKU-NEW", packSize: 1, principal: "Mars", costPrice: null, classification: "", ssuConversion: null },
  ];
  const warehouses = [{ warehouseCode: "W1", warehouseName: "Nairobi", location: "Nairobi", locationCode: "NBO" }];
  const principals = [{ key: "mars-nairobi", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "NBO", status: "Active", teamLeader: "" }];
  const asOf = new Date("2026-10-07T00:00:00Z"); // a Wednesday

  it("keeps stock that has never sold operational (it may be new) and moves stock that sold before but not in three months to dormant", () => {
    const result = buildDirectStock(
      [
        { itemCode: "SKU-1", itemName: "Stagnant", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 10, avgPrice: 10, stockValue: 100 },
        { itemCode: "SKU-NEW", itemName: "New launch", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 10, avgPrice: 10, stockValue: 100 },
      ],
      [], [], products, warehouses, principals, asOf,
      [{ itemCode: "SKU-1", lastSaleDate: new Date("2026-02-01T00:00:00Z") }]
    );
    expect(result.dormantItems.map((row) => row.itemCode)).toEqual(["SKU-1"]);
    expect(result.items.map((row) => row.itemCode)).toEqual(["SKU-NEW"]);
  });

  it("sets the standard run rate to the median of the 4-week, 13-week and year-to-date rates", () => {
    const demand = [{ itemCode: "SKU-1", warehouseCode: "W1", itemName: "Widget", quantityUnits: 2700, sumQuantitySquared: 0, salesValue: 27_000, sellingDays: 100, firstSale: new Date("2026-01-01T00:00:00Z"), lastSale: new Date("2026-10-06T00:00:00Z") }];
    const recent = [{ itemCode: "SKU-1", warehouseCode: "W1", qty28: 0, value28: 0, qty91: 910, value91: 9_100 }];
    const result = buildDirectStock(
      [{ itemCode: "SKU-1", itemName: "Widget", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 100, avgPrice: 10, stockValue: 1000 }],
      demand,
      [{ itemCode: "SKU-1", warehouseCode: "W1", lastSaleDate: new Date("2026-10-06T00:00:00Z") }],
      products, warehouses, principals, asOf, [], recent
    );
    const [item] = result.items;
    // nothing sold in the last 4 weeks: that window is 0, so the median is the lower of the 13-week and year-to-date rates
    expect(item.rr4wValue).toBe(0);
    expect(item.rr13wValue).toBeGreaterThan(0);
    expect(item.stdRrWeekValue).toBeCloseTo(Math.min(item.rr13wValue as number, item.rrWeekValue), 6);
    expect(item.stdRrWeekValue as number).toBeLessThanOrEqual(item.rrWeekValue);
  });

  it("leaves the standard fields null when the recent windows were not read", () => {
    const result = buildDirectStock(
      [{ itemCode: "SKU-1", itemName: "Widget", itemGroup: null, brand: null, whsCode: "W1", whsName: "Nairobi", onhandQty: 100, avgPrice: 10, stockValue: 1000 }],
      [], [{ itemCode: "SKU-1", warehouseCode: "W1", lastSaleDate: new Date("2026-10-06T00:00:00Z") }],
      products, warehouses, principals, asOf
    );
    expect(result.items[0]).toMatchObject({ rr4wValue: null, rr13wValue: null, stdRrWeekValue: null, stdRrWeekPcs: null });
  });
});
