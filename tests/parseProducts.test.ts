import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseProductsWorkbook, ProductsParseError } from "../lib/parseProducts";

function workbook(rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Products");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseProductsWorkbook", () => {
  it("reads the full product-master shape and preserves identifiers as text", () => {
    const rows = parseProductsWorkbook(workbook([
      ["#", "Item No.", "Item Description", "Series", "Size", "Pack size", "Principal", "Cost Price", "Classification", "SSU Conversion"],
      [0, "000123", "Sample product", 0, "24-Pack", 24, "New Principal", "1,250.50", "General", 1.5],
    ]));

    expect(rows).toEqual([{
      itemNo: "000123",
      itemDescription: "Sample product",
      series: "0",
      size: "24-Pack",
      packSize: 24,
      principal: "New Principal",
      costPrice: 1250.5,
      classification: "General",
      ssuConversion: 1.5,
    }]);
  });

  it("rejects duplicate item numbers", () => {
    expect(() => parseProductsWorkbook(workbook([
      ["Item No.", "Principal"],
      ["SKU-1", "Mars"],
      ["SKU-1", "Upfield"],
    ]))).toThrowError(ProductsParseError);
  });

  it("rejects missing required columns", () => {
    expect(() => parseProductsWorkbook(workbook([["Item", "Supplier"], ["SKU-1", "Mars"]]))).toThrow(/Item No\. and Principal/);
  });
});
