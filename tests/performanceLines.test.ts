import { describe, expect, it } from "vitest";
import { buildPerformanceLines, holdClosedMonthGp, principalBrand, storedTotalsKey } from "../scripts/db-bridge/transform/buildPerformanceLines";
import type { PerformanceLineRow } from "../scripts/db-bridge/queries/performanceLines";
import type { ProductRow } from "../scripts/db-bridge/reference/loadFromDb";
import type { PrincipalRow, WarehouseRow } from "../scripts/db-bridge/transform/buildMonthlySales";

const products: ProductRow[] = [
  { itemNo: "M1", packSize: 12, principal: "Mars", costPrice: 10, classification: "", ssuConversion: null },
  { itemNo: "E1", packSize: 24, principal: "Eabl", costPrice: 10, classification: "", ssuConversion: null },
  { itemNo: "O1", packSize: 6, principal: "Nestle", costPrice: 10, classification: "", ssuConversion: null },
];
const warehouses: WarehouseRow[] = [
  { warehouseCode: "NBI", warehouseName: "Nairobi Main Warehouse", location: "Nairobi", locationCode: "N" },
  { warehouseCode: "NYR", warehouseName: "Nyeri Warehouse", location: "Nyeri", locationCode: "Y" },
];
const principals: PrincipalRow[] = [
  { key: "1", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "N", status: "Active", teamLeader: "" },
  { key: "2", principal: "Eabl-Nyeri", mainPrincipal: "Eabl", location: "Nyeri", locationCode: "Y", status: "Active", teamLeader: "" },
  { key: "3", principal: "Nestle-Nairobi", mainPrincipal: "Nestle", location: "Nairobi", locationCode: "N", status: "Past", teamLeader: "" },
];

function row(over: Partial<PerformanceLineRow>): PerformanceLineRow {
  return {
    year: 2026,
    monthNo: 3,
    docType: "Invoice",
    customerCode: "C1",
    customerName: "Alpha Wines",
    itemCode: "M1",
    itemName: "Mars Bar",
    whsCode: "NBI",
    sapName: "Rep One",
    qtySold: 120,
    packSize: 12,
    salesAmount: 1000,
    recordedGp: 50,
    grossMargin: 100,
    ...over,
  };
}

describe("buildPerformanceLines", () => {
  it("maps an item to its brand-level principal and converts quantity to cases", () => {
    const { lines, salesRecordKeys } = buildPerformanceLines([row({})], products, warehouses, principals);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ month: "2026-03", doc: "invoice", principal: "Mars", cases: 10, sales: 1000, gp: 100, gpRecorded: 50, warehouse: "Nairobi Main Warehouse" });
    expect(salesRecordKeys).toEqual(["Mars-Nairobi"]);
  });

  it("unifies the spelling of EABL and keeps credit notes as credit lines", () => {
    const { lines } = buildPerformanceLines([row({ itemCode: "E1", whsCode: "NYR", docType: "Credit Note", salesAmount: -200, qtySold: -48, packSize: 24 })], products, warehouses, principals);
    expect(lines[0]).toMatchObject({ doc: "credit", principal: "EABL", cases: -2, sales: -200 });
    expect(principalBrand("Eabl")).toBe("EABL");
    expect(principalBrand("Mars")).toBe("Mars");
  });

  it("leaves out items with no active principal and reports what it left out", () => {
    const built = buildPerformanceLines([row({}), row({ itemCode: "O1", salesAmount: 700 }), row({ itemCode: "UNKNOWN", salesAmount: 300 })], products, warehouses, principals);
    expect(built.lines).toHaveLength(1);
    expect(built.excludedLines).toBe(2);
    expect(built.excludedSales).toBe(1000);
  });

  it("falls back to the warehouse code, and to Nairobi when the warehouse is unknown", () => {
    const { lines } = buildPerformanceLines([row({ whsCode: "ZZZ" })], products, warehouses, principals);
    expect(lines[0].warehouse).toBe("ZZZ");
    expect(lines[0].principal).toBe("Mars");
  });
});

describe("holdClosedMonthGp", () => {
  const twoLines = () => {
    const built = buildPerformanceLines([row({ salesAmount: 100, grossMargin: 10 }), row({ itemCode: "M1", customerCode: "C2", salesAmount: 300, grossMargin: 30 })], products, warehouses, principals);
    return built;
  };

  it("moves a closed month's GP to the stored margin while keeping the lines' relative spread and the total tie", () => {
    const built = twoLines();
    const stored = new Map([[storedTotalsKey("2026-03", "Mars-Nairobi"), { revenue: 1000, grossProfit: 50 }]]); // 5% stored margin
    const adjusted = holdClosedMonthGp(built, stored, "2026-10");
    expect(adjusted).toBe(1);
    const total = built.lines.reduce((sum, l) => sum + l.gp, 0);
    expect(total).toBeCloseTo(20, 6); // 400 revenue x 5%
    expect(built.lines[0].gp).toBeCloseTo(5, 6);
    expect(built.lines[1].gp).toBeCloseTo(15, 6);
  });

  it("never touches the SAP recorded GP", () => {
    const built = twoLines();
    holdClosedMonthGp(built, new Map([[storedTotalsKey("2026-03", "Mars-Nairobi"), { revenue: 1000, grossProfit: 50 }]]), "2026-10");
    expect(built.lines.map((l) => l.gpRecorded)).toEqual([50, 50]);
  });

  it("leaves the current month and unstored groups alone", () => {
    const built = twoLines();
    expect(holdClosedMonthGp(built, new Map([[storedTotalsKey("2026-03", "Mars-Nairobi"), { revenue: 1000, grossProfit: 50 }]]), "2026-03")).toBe(0);
    expect(built.lines.map((l) => l.gp)).toEqual([10, 30]);
    expect(holdClosedMonthGp(built, new Map(), "2026-10")).toBe(0);
    expect(built.lines.map((l) => l.gp)).toEqual([10, 30]);
  });

  it("skips a stored month with no revenue to take a margin from", () => {
    const built = twoLines();
    expect(holdClosedMonthGp(built, new Map([[storedTotalsKey("2026-03", "Mars-Nairobi"), { revenue: 0, grossProfit: 0 }]]), "2026-10")).toBe(0);
    expect(built.lines.map((l) => l.gp)).toEqual([10, 30]);
  });
});
