import { describe, expect, it } from "vitest";
import { buildUnmappedProductSales } from "@/scripts/db-bridge/transform/buildUnmappedProductSales";
import type { YtdRawRow } from "@/scripts/db-bridge/queries/ytdRaw";
import type { ProductRow } from "@/scripts/db-bridge/reference/loadFromDb";

function raw(overrides: Partial<YtdRawRow> = {}): YtdRawRow {
  return {
    period: "YTD", year: 2026, monthNo: 9, month: "September", itemCode: "NEW-01", brand: "New product", whsCode: "NRB",
    sapName: "SAP Rep", customerName: "Customer", isFreeSale: false, qtySold: 10, packSize: 12, salesAmount: 100, grossProfit: 0,
    grossSales: 120, cogs: 60, grossMargin: 60, ...overrides,
  };
}

const mapped: ProductRow = { itemNo: "MAPPED-01", packSize: 12, principal: "Mars", costPrice: null, classification: "", ssuConversion: null };

describe("buildUnmappedProductSales", () => {
  it("keeps only SAP product codes absent from Product Master and aggregates their sales", () => {
    const result = buildUnmappedProductSales([
      raw(), raw({ qtySold: 2, salesAmount: 20, grossMargin: 12 }), raw({ itemCode: "MAPPED-01", salesAmount: 999 }),
    ], [mapped]);

    expect(result).toEqual([{
      year: "2026", month: "September", monthIndex: 8, itemNo: "NEW-01", itemDescription: "New product", warehouseCode: "NRB",
      packSize: 12, costPrice: null, packDetail: null, quantity: 12, revenue: 120, grossMargin: 72,
    }]);
  });

  it("retains separate warehouse coverage for an otherwise identical product-month", () => {
    const result = buildUnmappedProductSales([raw(), raw({ whsCode: "NYR" })], []);

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.warehouseCode).sort()).toEqual(["NRB", "NYR"]);
  });

  it("keeps a Product Master item without a principal in the review worklist", () => {
    expect(buildUnmappedProductSales([raw({ itemCode: "MAPPED-01" })], [{ ...mapped, principal: "" }])).toHaveLength(1);
  });

  it("retains SAP product-reference fields for review-form prefills", () => {
    const [result] = buildUnmappedProductSales([raw({ packSize: 20, costPrice: 1096.39, packDetail: "20-Pack" })], []);
    expect(result).toMatchObject({ packSize: 20, costPrice: 1096.39, packDetail: "20-Pack" });
  });
});
