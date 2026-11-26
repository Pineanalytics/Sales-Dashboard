import { describe, expect, it } from "vitest";
import { powerQueryScript, UNILEVER_PRODUCT_COLUMNS, UNILEVER_PRODUCTS_FEED } from "@/lib/dataFeedScript";
import { unileverProductCsv, unileverProductStatus, unileverSalesWindow, type UnileverProductData, type UnileverProductRow } from "@/lib/unileverProductList";

const row = (over: Partial<UnileverProductRow>): UnileverProductRow => ({
  sku: "67543210", skuDesc: "Royco Mchuzi Mix 75g", category: "Foods", brand: "Royco", piecesPerCase: 24, listPricePerCase: 2400, assortmentActive: true,
  branches: ["18058585", "18048241"], firstSold: new Date("2026-03-01T00:00:00Z"), lastSold: new Date("2026-11-21T00:00:00Z"), pieces90: 72, sales90: 7200, returns90: 600, outlets90: 2, ...over,
});

describe("the Unilever product list's 90-day window", () => {
  it("ends today in Nairobi and starts 89 days earlier", () => {
    // 22:30 UTC on 25 Nov is already 26 Nov in Nairobi.
    const w = unileverSalesWindow(new Date("2026-11-25T22:30:00Z"));
    expect(w.asOf).toBe("2026-11-26");
    expect(w.start.toISOString().slice(0, 10)).toBe("2026-08-29");
  });

  it("calls a SKU active, lapsed or never sold", () => {
    const start = new Date("2026-08-29T00:00:00Z");
    expect(unileverProductStatus(row({}), start)).toBe("Active");
    expect(unileverProductStatus(row({ lastSold: new Date("2026-05-05T00:00:00Z") }), start)).toBe("Not sold in 90 days");
    expect(unileverProductStatus(row({ lastSold: null }), start)).toBe("Never sold");
  });
});

describe("the Unilever product list CSV", () => {
  const data: UnileverProductData = {
    rows: [row({}), row({ sku: "99990001", skuDesc: "Sunlight, 1kg", category: null, brand: null, piecesPerCase: null, listPricePerCase: null, assortmentActive: false, branches: [], firstSold: null, lastSold: null, pieces90: 0, sales90: 0, returns90: 0, outlets90: 0 })],
    asOf: "2026-11-26",
    windowStart: new Date("2026-08-29T00:00:00Z"),
  };

  it("writes every column: price per piece, branch names, net of returns, assortment flag", () => {
    const [header, royco, sunlight] = unileverProductCsv(data, UNILEVER_PRODUCT_COLUMNS).split("\r\n");
    expect(header).toBe(UNILEVER_PRODUCT_COLUMNS.join(","));
    expect(royco).toBe('67543210,Royco Mchuzi Mix 75g,Foods,Royco,24,2400,100,Y,Active,"Nairobi, Nyeri",2026-03-01,2026-11-21,72,6600,2');
    expect(sunlight).toBe('99990001,"Sunlight, 1kg",,,,,,N (inactive),Never sold,,,,0,0,0');
  });

  it("keeps only known columns, in the order asked", () => {
    expect(unileverProductCsv(data, ["Brand", "Nope", "SKU Code"]).split("\r\n")[0]).toBe("Brand,SKU Code");
  });

  it("gets a script with no period and typed number and date columns", () => {
    const script = powerQueryScript({ baseUrl: "https://pinefrostdb.com", feed: UNILEVER_PRODUCTS_FEED, key: "pfk_x" });
    expect(script).toContain('RelativePath = "api/feeds/unilever-products",');
    expect(script).not.toContain("Period");
    expect(script).not.toContain("SupplierCodes");
    expect(script).toContain('{"List Price per Case", type number}');
    expect(script).toContain('{"Last Sold", type date}');
    expect(script).toContain('{"SKU Code", type text}');
  });
});
