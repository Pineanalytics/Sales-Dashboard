import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildStockExtract, daysBetween, formatExtractDate, inactivityPeriod, activeSaleCutoff, STOCK_EXTRACT_ITEM_COLUMNS, STOCK_EXTRACT_PRINCIPAL_COLUMNS } from "../lib/stockExtract";
import { dormantSinceByBrandKey } from "../lib/stock";
import { filterDatasetToPrincipals } from "../lib/datasetFilters";
import { REPORT_DEFINITIONS } from "../lib/reports/definitions";
import { reportToExcelBlob } from "../lib/reports/toExcel";
import { normalizePrincipalKey } from "../lib/normalize";
import type { Dataset, DormantStockItem, StockItem } from "../lib/types";

const ASOF = "2026-10-07";
const col = (name: string) => STOCK_EXTRACT_ITEM_COLUMNS.indexOf(name);
const pcol = (name: string) => STOCK_EXTRACT_PRINCIPAL_COLUMNS.indexOf(name);

function stock(principal: string, item: string, value: number, rr: number, lastSaleDate: string | null | undefined, itemCode = item): StockItem {
  return { principal, key: normalizePrincipalKey(principal), item, itemCode, lastSaleDate, openingVolume: value / 100, openingPcs: value / 10, openingValue: value, rrWeekValue: rr, rrWeekVolume: rr / 100, daysCover: rr > 0 ? Math.round((value / rr) * 7) : 0, action: rr > 0 ? "🟢 OK" : "⚪ No Sales Data" };
}
function dormant(principal: string, item: string, lastSaleDate: string | null): DormantStockItem {
  return { principal, key: normalizePrincipalKey(principal), item, itemCode: item, openingPcs: 0, openingValue: 0, lastSaleDate };
}
const sale = (principal: string, revenue: number) => ({ year: "2026", month: "September", monthIndex: 8, principal, principalKey: normalizePrincipalKey(principal), revenue }) as unknown as Dataset["monthlySales"][number];

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    monthlySales: [sale("Mars-Nairobi", 5_000_000), sale("Signify-Nairobi", 80_000)],
    monthlyCoverage: [],
    monthlyBrandCustomer: [],
    monthlyPL: [],
    stockItems: [
      stock("Mars-Nairobi", "Galaxy", 1_000_000, 500_000, "2026-10-05"), // sold this week
      stock("Mars-Nairobi", "Old Bar", 200_000, 0, "2026-03-14"), // stock but no sale for ~7 months
      stock("Mars-Nairobi", "Brand New", 50_000, 0, null), // never invoiced
      stock("Signify-Nairobi", "Bulb 9W", 250_000, 20_000, "2026-10-01"),
      stock("Godrej-Nairobi", "Soap", 10_000, 0, "2026-01-20"),
    ],
    dormantStockItems: [dormant("Mars-Nairobi", "Retired Bar", "2025-11-02"), dormant("Mars-Nairobi", "Never Bar", null), dormant("Nestle-Nairobi", "Milk", "2024-05-30")],
    dormantPrincipalKeys: ["signify"],
    dormantPrincipalSince: { signify: "2026-06-01" },
    stockTotal: undefined as unknown as Dataset["stockTotal"],
    stockSource: { kind: "sap-direct", sourceDate: `${ASOF}T00:00:00.000Z`, itemCount: 5 },
    reportMeta: { title: "t", sheet: "s" },
    uploadedAt: `${ASOF}T00:00:00Z`,
    ...over,
  } as Dataset;
}

describe("date helpers", () => {
  it("formats dates and counts days", () => {
    expect(formatExtractDate("2026-03-14")).toBe("14 Mar 2026");
    expect(daysBetween("2026-03-14", "2026-10-07")).toBe(207);
    expect(daysBetween("2026-10-08", "2026-10-07")).toBe(0);
  });

  it("spells the inactivity period from the day after the last sale", () => {
    expect(inactivityPeriod("2026-03-14", "2026-10-07")).toBe("15 Mar 2026 – 7 Oct 2026 (207 days)");
    expect(inactivityPeriod("2026-10-06", "2026-10-07")).toBe("7 Oct 2026 – 7 Oct 2026 (1 day)");
  });

  it("uses the same three-month window as the stock sync", () => {
    expect(activeSaleCutoff("2026-10-07")).toBe("2026-07-07");
    expect(activeSaleCutoff("2026-01-31")).toBe("2025-10-31");
  });
});

describe("buildStockExtract: every SKU, with SKU status and inactivity", () => {
  const extract = buildStockExtract(dataset());
  const row = (item: string) => extract.itemRows.find((r) => r[col("Item")] === item)!;

  it("lists SKUs with stock and the zero-stock dormant SKUs together", () => {
    expect(extract.itemRows).toHaveLength(8);
    expect(extract.skuCounts).toEqual({ total: 8, active: 2, dormant: 6 });
    expect(extract.asOf).toBe(ASOF);
    expect(extract.itemRows.every((r) => r.length === STOCK_EXTRACT_ITEM_COLUMNS.length)).toBe(true);
  });

  it("marks a SKU sold within three months Active and gives no inactivity period", () => {
    const galaxy = row("Galaxy");
    expect(galaxy[col("SKU Status")]).toBe("Active");
    expect(galaxy[col("Last Sale Date")]).toBe("5 Oct 2026");
    expect(galaxy[col("Days Since Last Sale")]).toBe(2);
    expect(galaxy[col("SKU Inactivity Period")]).toBe("");
  });

  it("marks stocked SKUs with no recent sale Dormant, with the range of inactivity", () => {
    const old = row("Old Bar");
    expect(old[col("SKU Status")]).toBe("Dormant");
    expect(old[col("Last Sale Date")]).toBe("14 Mar 2026");
    expect(old[col("Days Since Last Sale")]).toBe(207);
    expect(old[col("SKU Inactivity Period")]).toBe("15 Mar 2026 – 7 Oct 2026 (207 days)");
    expect(old[col("Opening Value")]).toBe(200_000);
  });

  it("says Never sold for a SKU with no invoice on record", () => {
    for (const name of ["Brand New", "Never Bar"]) {
      const r = row(name);
      expect(r[col("SKU Status")]).toBe("Dormant");
      expect(r[col("Last Sale Date")]).toBe("");
      expect(r[col("Days Since Last Sale")]).toBe("");
      expect(r[col("SKU Inactivity Period")]).toBe("Never sold (no invoice on record)");
    }
  });

  it("includes the hidden zero-stock SKUs with their real last sale and a dormant action", () => {
    const retired = row("Retired Bar");
    expect(retired[col("SKU Status")]).toBe("Dormant");
    expect(retired[col("Opening Pcs")]).toBe(0);
    expect(retired[col("Days Cover")]).toBe("");
    expect(retired[col("SKU Inactivity Period")]).toBe("3 Nov 2025 – 7 Oct 2026 (339 days)");
    expect(retired[col("Action")]).toBe("Out of stock – no pieces on hand");
  });

  it("does not contradict an Active SKU with a no-sale action when it sold recently from another warehouse", () => {
    const sold = buildStockExtract(dataset({ dormantStockItems: [dormant("Mars-Nairobi", "Sold Elsewhere", "2026-09-20")] }));
    const r = sold.itemRows.find((x) => x[col("Item")] === "Sold Elsewhere")!;
    expect(r[col("SKU Status")]).toBe("Active");
    expect(r[col("SKU Inactivity Period")]).toBe("");
    expect(String(r[col("Action")])).not.toMatch(/no sale in 3 months/);
  });

  it("leaves status blank when the stock source carries no sale dates at all", () => {
    const legacy = buildStockExtract(dataset({ stockItems: [stock("Mars-Nairobi", "Legacy", 100, 10, undefined)], dormantStockItems: [] }));
    expect(legacy.itemRows[0][col("SKU Status")]).toBe("");
    expect(legacy.itemRows[0][col("SKU Inactivity Period")]).toBe("");
    expect(legacy.skuCounts).toEqual({ total: 1, active: 0, dormant: 0 });
  });
});

describe("buildStockExtract: principal status and dormancy period", () => {
  const extract = buildStockExtract(dataset());
  const principalOf = (item: string) => extract.itemRows.find((r) => r[col("Item")] === item)!;

  it("gives a flagged principal the period recorded by the admin, even though it still sells", () => {
    const bulb = principalOf("Bulb 9W");
    expect(bulb[col("Principal Status")]).toBe("Inactive");
    expect(bulb[col("Principal Dormancy Period")]).toBe("1 Jun 2026 – 7 Oct 2026 (128 days)");
    expect(bulb[col("Principal Last Sale")]).toBe("1 Oct 2026");
  });

  it("says when a flagged principal has no recorded start date", () => {
    const e = buildStockExtract(dataset({ dormantPrincipalSince: {} }));
    expect(e.itemRows.find((r) => r[col("Item")] === "Bulb 9W")![col("Principal Dormancy Period")]).toBe("Marked dormant (start date not recorded)");
  });

  it("derives the period of a principal that is dormant only because it stopped selling", () => {
    const soap = principalOf("Soap"); // Godrej: no revenue in the dataset, last sold 20 Jan
    expect(soap[col("Principal Status")]).toBe("Inactive");
    expect(soap[col("Principal Dormancy Period")]).toBe("21 Jan 2026 – 7 Oct 2026 (260 days)");
  });

  it("covers a principal that has only zero-stock SKUs, and one never sold", () => {
    const milk = principalOf("Milk");
    expect(milk[col("Principal Status")]).toBe("Inactive");
    expect(milk[col("Principal Dormancy Period")]).toBe("31 May 2024 – 7 Oct 2026 (860 days)");
    const none = buildStockExtract(dataset({ stockItems: [], dormantStockItems: [dormant("Rigavo-Nairobi", "X", null)], dormantPrincipalKeys: [] })).itemRows[0];
    expect(none[col("Principal Dormancy Period")]).toBe("No sales on record");
  });

  it("leaves the dormancy columns empty for an active principal", () => {
    const galaxy = principalOf("Galaxy");
    expect(galaxy[col("Principal Status")]).toBe("Active");
    expect(galaxy[col("Principal Dormancy Period")]).toBe("");
    expect(galaxy[col("Principal Last Sale")]).toBe("5 Oct 2026");
  });

  it("lists active principals first, then by principal, then active SKUs before dormant ones", () => {
    const order = extract.itemRows.map((r) => `${r[col("Principal")]}|${r[col("SKU Status")]}|${r[col("Item")]}`);
    expect(order.slice(0, 5)).toEqual(["Mars-Nairobi|Active|Galaxy", "Mars-Nairobi|Dormant|Old Bar", "Mars-Nairobi|Dormant|Brand New", "Mars-Nairobi|Dormant|Never Bar", "Mars-Nairobi|Dormant|Retired Bar"]);
    expect(extract.itemRows.slice(5).every((r) => r[col("Principal Status")] === "Inactive")).toBe(true);
  });
});

describe("buildStockExtract: by-principal summary and filtering", () => {
  it("counts active and dormant SKUs per principal and carries its dormancy period", () => {
    const { principalRows } = buildStockExtract(dataset());
    const mars = principalRows.find((r) => r[pcol("Principal")] === "Mars")!;
    expect(mars[pcol("SKUs")]).toBe(5);
    expect(mars[pcol("Active SKUs")]).toBe(1);
    expect(mars[pcol("Dormant SKUs")]).toBe(4);
    expect(mars[pcol("Opening Value")]).toBe(1_250_000);
    const signify = principalRows.find((r) => r[pcol("Principal")] === "Signify")!;
    expect(signify[pcol("Principal Status")]).toBe("Inactive");
    expect(signify[pcol("Principal Dormancy Period")]).toBe("1 Jun 2026 – 7 Oct 2026 (128 days)");
    expect(principalRows[0][pcol("Principal")]).toBe("Mars"); // active first
  });

  it("filters to one principal", () => {
    const e = buildStockExtract(dataset(), { brandKey: "mars" });
    expect(e.itemRows.every((r) => r[col("Principal")] === "Mars-Nairobi")).toBe(true);
    expect(e.skuCounts.total).toBe(5);
  });
});

describe("scoping and the dormant-since map", () => {
  it("takes the earliest recorded date among a dormant brand's rows, and ignores brands that are not wholly dormant", () => {
    const since = dormantSinceByBrandKey([
      { principal: "Signify-Nairobi", stockDormant: true, stockDormantSince: new Date("2026-06-01T00:00:00Z") },
      { principal: "EABL-Nyeri", stockDormant: true, stockDormantSince: new Date("2026-05-01T00:00:00Z") },
      { principal: "EABL-Nyahururu", stockDormant: true, stockDormantSince: new Date("2026-04-15T00:00:00Z") },
      { principal: "Weetabix-Nairobi", stockDormant: false, stockDormantSince: null },
      { principal: "Weetabix-Machakos", stockDormant: true, stockDormantSince: new Date("2026-01-01T00:00:00Z") },
      { principal: "Movit-Nairobi", stockDormant: true, stockDormantSince: null },
    ]);
    expect(since).toEqual({ signify: "2026-06-01", eabl: "2026-04-15" });
  });

  it("limits the zero-stock SKUs to the principals a restricted user may see", () => {
    const scoped = filterDatasetToPrincipals(dataset(), new Set(["signify"]));
    expect(scoped.dormantStockItems).toEqual([]);
    expect(scoped.stockItems.map((i) => i.item)).toEqual(["Bulb 9W"]);
  });
});

describe("the Excel file", () => {
  it("carries the new columns, every SKU and the summary lines", async () => {
    const stockReport = REPORT_DEFINITIONS.find((r) => r.key === "stock")!;
    const report = await stockReport.build({ dataset: dataset(), period: { kind: "YTD", year: "2026", month: "September" }, principalKey: null, repFilter: null, periodLabel: "YTD 2026" });
    const workbook = XLSX.read(await reportToExcelBlob(report).arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Stock Items"], { header: 1, blankrows: false });
    const header = rows.find((r) => r[0] === "Principal")!;
    expect(header).toEqual(STOCK_EXTRACT_ITEM_COLUMNS);
    const never = rows.find((r) => r[col("Item")] === "Never Bar")!;
    expect(never[col("SKU Inactivity Period")]).toBe("Never sold (no invoice on record)");
    const labels = rows.map((r) => String(r[0]));
    expect(labels).toEqual(expect.arrayContaining(["Stock as at", "SKUs listed (all)", "Active SKUs (sold in last 3 months)", "Dormant SKUs (no sale in 3 months)"]));
    expect(rows.find((r) => r[0] === "SKUs listed (all)")![1]).toBe("8");
    expect(workbook.SheetNames).toEqual(["Stock Items", "By Principal"]);
  });
});
