import { describe, expect, it } from "vitest";
import { firstWordBrand, isEmptiesItem, isPlaceholderBrand, mapSkuBrand, type BrandRule } from "../lib/brandMapping";
import { withDormantHeldStock } from "../lib/datasetFilters";
import type { DormantStockItem, StockItem, StockTotal } from "../lib/types";

describe("isPlaceholderBrand", () => {
  it("recognises SAP's placeholder and blanks, and nothing real", () => {
    expect(isPlaceholderBrand("-Select Manufacturer-")).toBe(true);
    expect(isPlaceholderBrand(" - select manufacturer - ")).toBe(true);
    expect(isPlaceholderBrand("")).toBe(true);
    expect(isPlaceholderBrand(null)).toBe(true);
    expect(isPlaceholderBrand("UPFIEL Kenya Limited")).toBe(false);
  });
});

describe("isEmptiesItem", () => {
  it("picks out returnable empties by name", () => {
    expect(isEmptiesItem("EMPTIES")).toBe(true);
    expect(isEmptiesItem("Empties - Tusker 500ml crate")).toBe(true);
    expect(isEmptiesItem("Empty bottles 250ml")).toBe(true);
  });

  it("leaves ordinary products alone", () => {
    expect(isEmptiesItem("Tusker Lager 500ml-25")).toBe(false);
    expect(isEmptiesItem("Tempest tea")).toBe(false);
    expect(isEmptiesItem(null)).toBe(false);
  });
});

describe("firstWordBrand", () => {
  it("takes the first real word, title-cased, skipping sizes and symbols", () => {
    expect(firstWordBrand("SUNLIGHT 1kg")).toBe("Sunlight");
    expect(firstWordBrand("250g Digestive")).toBe("Digestive");
    expect(firstWordBrand("- Royco cubes")).toBe("Royco");
    expect(firstWordBrand("12 x 8")).toBeNull();
  });
});

describe("mapSkuBrand", () => {
  it("uses the built-in rules for abbreviations and multi-word brands", () => {
    expect(mapSkuBrand("eabl", "JW Black 1L 12Y 12*1")).toEqual({ brand: "Johnnie Walker", source: "rule" });
    expect(mapSkuBrand("eabl", "SMIR RED 750ml")).toEqual({ brand: "Smirnoff", source: "rule" });
    expect(mapSkuBrand("upfield", "Blue Band Original-250g")).toEqual({ brand: "Blue Band", source: "rule" });
    expect(mapSkuBrand("mars", "P.K Peppermint (1.2gx4P)x50x36")).toEqual({ brand: "PK", source: "rule" });
    expect(mapSkuBrand("millyfruits", "RTD Picana Mango 500ml")).toEqual({ brand: "Picana", source: "rule" });
  });

  it("falls back to the first word when no rule applies, and says so", () => {
    expect(mapSkuBrand("unilever", "ROYCO CHILLI CUBE STRINGPACK 20*36*4G")).toEqual({ brand: "Royco", source: "auto" });
    expect(mapSkuBrand("unilever", "")).toEqual({ brand: "Unspecified", source: "none" });
  });

  it("applies a rule only to its own principal", () => {
    expect(mapSkuBrand("unilever", "JW something").source).toBe("auto");
  });

  it("lets an admin rule beat a built-in rule of the same length, and a longer keyword beat a shorter one", () => {
    const admin: BrandRule[] = [{ principalKey: "upfield", keyword: "blue", brand: "Blue Band Spreads", mode: "PREFIX" }];
    expect(mapSkuBrand("upfield", "Blue Band Original-250g", admin).brand).toBe("Blue Band"); // "blue band" is longer than "blue"
    expect(mapSkuBrand("upfield", "Blue Something", admin).brand).toBe("Blue Band Spreads"); // admin beats the built-in "blue"
  });

  it("supports contains rules", () => {
    const admin: BrandRule[] = [{ principalKey: "bennet", keyword: "nose spray", brand: "Saline", mode: "CONTAINS" }];
    expect(mapSkuBrand("bennet", "Saline Nose Spray 30ml + Aspirator", admin).brand).toBe("Saline");
    expect(mapSkuBrand("bennet", "Baby Bum Crème 150g", admin)).toEqual({ brand: "Baby", source: "auto" });
  });
});

describe("all stock held keeps the empties in the total", () => {
  const total = { value: 1000, pcs: 100, itemCount: 10 } as unknown as StockTotal;
  const dormant = [{ openingPcs: 5, openingValue: 50 }, { openingPcs: 0, openingValue: 0 }] as unknown as DormantStockItem[];
  const empties = [{ openingPcs: 20, openingValue: 400 }] as unknown as StockItem[];

  it("adds dormant stock on hand and empties to value, pieces and item count", () => {
    expect(withDormantHeldStock(total, dormant, empties)).toMatchObject({ value: 1450, pcs: 125, itemCount: 12 });
  });

  it("leaves the total alone when there is nothing outside the operational stock", () => {
    expect(withDormantHeldStock(total, [], [])).toBe(total);
  });
});
