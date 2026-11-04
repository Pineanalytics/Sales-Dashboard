import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PurchasesPanel } from "../components/operations/PurchasesTab";
import { formatNumber } from "../lib/format";
import { buildPurchaseSummary, type ReceiptLine } from "../lib/purchaseReceipts/summary";

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

const lines: ReceiptLine[] = [
  line({}),
  line({ docEntry: 2, docType: "GOODS_RETURN", value: -50_000, cases: -10 }),
  line({ docEntry: 3, supplierCode: "S-0075", supplierName: "Kenya Breweries", principal: "EABL-Nyeri", warehouseCode: "NYR", location: "Nyeri", itemCode: "K1", itemName: "Guinness", value: 900_000, cases: 200 }),
  line({ docEntry: 4, supplierCode: "S-0075", supplierName: "Kenya Breweries", principal: "EABL-Nyahururu", warehouseCode: "NYH", location: "Nyahururu", itemCode: "K2", itemName: "Pilsner", value: 100_000, cases: 20 }),
  line({ docEntry: 5, supplierCode: "S-0075", supplierName: "Kenya Breweries", principal: "EABL-Nyahururu", warehouseCode: "WH031", location: "Nyahururu", stockClass: "EMPTIES", itemCode: "K9", itemName: "Crate", value: 40_000, cases: 4 }),
  line({ docEntry: 6, supplierCode: "S-0229", supplierName: "Trade Roots", principal: "Unallocated", principalSource: "UNALLOCATED", itemCode: "TR1", itemName: "Rice", value: 70_000, cases: 0, qty: 500 }),
  line({ docEntry: 7, year: 2026, monthIndex: 10, docDate: "2026-11-02", value: 80_000, cases: 8 }),
];

const render = (months: { year: number; monthIndex: number }[], extra: Partial<{ missingMonths: { year: number; monthIndex: number }[]; principal: string | null }> = {}) =>
  renderToStaticMarkup(
    createElement(PurchasesPanel, {
      data: { summary: buildPurchaseSummary(lines, months, extra.principal ?? null), missingMonths: extra.missingMonths ?? [], syncedAt: "2026-11-04T14:00:54.464Z" },
      periodLabel: "Oct 2026",
      principalLabel: extra.principal ?? null,
    })
  );

describe("the Stock page's Purchases tab", () => {
  const html = render([{ year: 2026, monthIndex: 9 }]);

  it("shows purchases per principal, grouped by brand, with value and volume", () => {
    expect(html).toContain("Purchases per principal");
    expect(html).toContain("Receipts (value)");
    expect(html).toContain("Net purchases (volume)");
    for (const brand of ["EABL", "Mars", "Unallocated"]) expect(html).toContain(`>${brand}<`);
    // EABL's two locations are one brand row: 900,000 + 100,000.
    expect(html).toContain(formatNumber(1_000_000));
    expect(html).not.toContain(">EABL-Nyeri<");
    // Mars: 500,000 receipts, -50,000 returns, 450,000 net.
    expect(html).toContain(formatNumber(450_000));
    expect(html).toContain(formatNumber(-50_000));
  });

  it("totals the table to the headline figures, leaving the empties out", () => {
    const total = 500_000 - 50_000 + 900_000 + 100_000 + 70_000;
    expect(html).toContain(formatNumber(total));
    expect(html).toContain("Returnable packaging (empties) is left out");
    expect(html).toContain(formatNumber(40_000));
  });

  it("says what is unallocated and which items have no pack size", () => {
    expect(html).toContain("is for items that are on no principal");
    expect(html).toContain("have no pack size");
  });

  it("warns about months with nothing loaded", () => {
    const warned = render([{ year: 2026, monthIndex: 9 }, { year: 2026, monthIndex: 11 }], { missingMonths: [{ year: 2026, monthIndex: 11 }] });
    expect(warned).toContain("No receipts are loaded for December 2026");
  });

  it("shows a month table only when the period spans months", () => {
    expect(html).not.toContain(">By month<");
    expect(render([{ year: 2026, monthIndex: 9 }, { year: 2026, monthIndex: 10 }])).toContain(">By month<");
  });

  it("says so, instead of showing zeros, when a period has no receipts", () => {
    const none = renderToStaticMarkup(
      createElement(PurchasesPanel, { data: { summary: buildPurchaseSummary([], [{ year: 2025, monthIndex: 5 }], null), missingMonths: [{ year: 2025, monthIndex: 5 }], syncedAt: null }, periodLabel: "Jun 2025", principalLabel: null })
    );
    expect(none).toContain("No receipts are stored for this period");
    expect(none).toContain("No receipts are loaded for June 2025");
  });

  it("names the principal when one is picked", () => {
    expect(render([{ year: 2026, monthIndex: 9 }], { principal: "Mars-Nairobi" })).toContain("for Mars-Nairobi");
  });
});
