import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { aggregateStockByPrincipal, classifyDormantPrincipals, dormantBrandKeysFromPrincipals, stockPrincipalStatuses, sumStockRollups } from "../lib/stock";
import { REPORT_DEFINITIONS } from "../lib/reports/definitions";
import { normalizePrincipalKey } from "../lib/normalize";
import { reportToExcelBlob } from "../lib/reports/toExcel";
import { STOCK_EXTRACT_ITEM_COLUMNS } from "../lib/stockExtract";
import type { Dataset, StockItem } from "../lib/types";

function item(principal: string, name: string, value: number, rr: number, action = "🟢 OK"): StockItem {
  return {
    principal,
    key: normalizePrincipalKey(principal),
    item: name,
    openingVolume: value / 100,
    openingPcs: value / 10,
    openingValue: value,
    rrWeekValue: rr,
    rrWeekVolume: rr / 100,
    daysCover: rr > 0 ? Math.round((value / rr) * 7) : 0,
    action,
  };
}

// Mars sells and holds stock. Signify stopped but still shows recent sales while it sells down what is left.
// Promasidor is Active in the Principal table and had sales this quarter. DKT has no sales at all.
function dataset(over: Partial<Dataset> = {}): Dataset {
  const stockItems = [
    item("Mars-Nairobi", "Galaxy", 1_000_000, 500_000),
    item("Mars-Nairobi", "Snickers", 400_000, 0, "🔴 Out of Stock - To Order"),
    item("Signify-Nairobi", "Bulb 9W", 250_000, 20_000),
    item("Promasidor-Nairobi", "Cowbell", 0, 100_000, "🔴 Out of Stock - To Order"),
    item("DKT-Nairobi", "Condom", 5_000, 0),
  ];
  const sale = (principal: string, revenue: number) => ({ year: "2026", month: "September", monthIndex: 8, principal, principalKey: normalizePrincipalKey(principal), revenue }) as unknown as Dataset["monthlySales"][number];
  return {
    monthlySales: [sale("Mars-Nairobi", 5_000_000), sale("Signify-Nairobi", 80_000), sale("Promasidor-Nairobi", 30_000)],
    monthlyCoverage: [],
    monthlyBrandCustomer: [],
    monthlyPL: [],
    stockItems,
    stockTotal: sumStockRollups(aggregateStockByPrincipal({ stockItems } as Dataset)),
    reportMeta: { title: "t", sheet: "s" },
    uploadedAt: "2026-10-07T00:00:00Z",
    ...over,
  } as Dataset;
}

describe("dormantBrandKeysFromPrincipals", () => {
  it("flags a brand only when every one of its principal rows is flagged", () => {
    const keys = dormantBrandKeysFromPrincipals([
      { principal: "Signify-Nairobi", stockDormant: true },
      { principal: "Weetabix-Nairobi", stockDormant: false },
      { principal: "Weetabix-Machakos", stockDormant: true }, // one location of a live brand
      { principal: "EABL-Nyeri", stockDormant: true },
      { principal: "EABL-Nyahururu", stockDormant: true },
      { principal: "Mars-Nairobi", stockDormant: false },
    ]);
    expect(keys).toEqual(["eabl", "signify"]);
  });
});

describe("classifyDormantPrincipals with flagged principals", () => {
  const keys = ["mars", "signify", "promasidor", "dkt"];

  it("treats a flagged principal as dormant even though it still has recent sales", () => {
    const result = classifyDormantPrincipals(dataset({ dormantPrincipalKeys: ["signify", "promasidor"] }), keys);
    expect([...result.dormantKeys].sort()).toEqual(["dkt", "promasidor", "signify"]);
    expect([...result.flaggedKeys].sort()).toEqual(["promasidor", "signify"]);
    expect([...result.activeKeys]).toEqual(["mars"]);
  });

  it("still applies the three-month no-sales rule to principals that are not flagged", () => {
    const result = classifyDormantPrincipals(dataset(), keys);
    expect(result.dormantKeys.has("dkt")).toBe(true); // no revenue
    expect(result.flaggedKeys.size).toBe(0);
    expect(result.activeKeys.has("signify")).toBe(true); // sales alone cannot tell, hence the flag
  });

  it("lets a flag outrank the emerging-principal exemption", () => {
    const result = classifyDormantPrincipals(dataset({ dormantPrincipalKeys: ["bennet"] }), ["bennet"]);
    expect(result.dormantKeys.has("bennet")).toBe(true);
  });
});

describe("stock rollups with dormant principals set aside", () => {
  it("leaves flagged principals out of the active total but keeps them in the all-stock total", () => {
    const ds = dataset({ dormantPrincipalKeys: ["signify", "promasidor"] });
    const rollups = aggregateStockByPrincipal(ds);
    const { dormantKeys } = classifyDormantPrincipals(ds, rollups.map((r) => r.key));
    const active = sumStockRollups(rollups.filter((r) => !dormantKeys.has(r.key)));
    expect(active.value).toBe(1_400_000); // Mars only
    expect(sumStockRollups(rollups).value).toBe(1_655_000);
  });

  it("marks every stock principal Active or Inactive", () => {
    const statuses = stockPrincipalStatuses(dataset({ dormantPrincipalKeys: ["signify", "promasidor"] }));
    expect(Object.fromEntries(statuses)).toEqual({ mars: "Active", signify: "Inactive", promasidor: "Inactive", dkt: "Inactive" });
  });
});

describe("Stock Balance extract", () => {
  const stockReport = REPORT_DEFINITIONS.find((r) => r.key === "stock")!;
  const build = (ds: Dataset, principalKey: string | null = null) =>
    stockReport.build({ dataset: ds, period: { kind: "YTD", year: "2026", month: "September" }, principalKey, repFilter: null, periodLabel: "YTD 2026" });

  it("lists all stock held, with a Principal Status column", async () => {
    const report = await build(dataset({ dormantPrincipalKeys: ["signify", "promasidor"] }));
    const items = report.sections[0];
    expect(items.columns).toEqual(STOCK_EXTRACT_ITEM_COLUMNS);
    expect(items.columns.slice(0, 4)).toEqual(["Principal", "Principal Status", "Principal Dormancy Period", "Principal Last Sale"]);
    expect(items.rows).toHaveLength(5); // nothing is left out
    const status = Object.fromEntries(items.rows.map((row) => [row[0], row[1]]));
    expect(status).toEqual({ "Mars-Nairobi": "Active", "Signify-Nairobi": "Inactive", "Promasidor-Nairobi": "Inactive", "DKT-Nairobi": "Inactive" });
  });

  it("splits the totals between active and inactive principals", async () => {
    const report = await build(dataset({ dormantPrincipalKeys: ["signify", "promasidor"] }));
    const summary = Object.fromEntries((report.summary ?? []).map((s) => [s.label, s.value]));
    expect(summary["Total Value (all stock held)"]).toBe((1_655_000).toLocaleString());
    expect(summary["Active Principals — Value"]).toBe((1_400_000).toLocaleString());
    expect(summary["Inactive Principals — Value"]).toBe((255_000).toLocaleString());
    expect(summary["Out of Stock (active principals)"]).toBe("1"); // Promasidor's out-of-stock line is not counted
  });

  it("writes the status column into the Excel file itself", async () => {
    const report = await build(dataset({ dormantPrincipalKeys: ["signify", "promasidor"] }));
    const workbook = XLSX.read(await reportToExcelBlob(report).arrayBuffer(), { type: "array" });
    expect(workbook.SheetNames).toEqual(["Stock Items", "By Principal"]);
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Stock Items"], { header: 1, blankrows: false });
    const header = rows.find((row) => row[0] === "Principal")!;
    expect(header[1]).toBe("Principal Status");
    const signify = rows.find((row) => row[0] === "Signify-Nairobi")!;
    expect(signify[1]).toBe("Inactive");
    expect(rows.find((row) => row[0] === "Mars-Nairobi")![1]).toBe("Active");
  });

  it("adds a by-principal sheet carrying the same status", async () => {
    const report = await build(dataset({ dormantPrincipalKeys: ["signify"] }));
    const byPrincipal = report.sections[1];
    expect(byPrincipal.title).toBe("By Principal");
    expect(byPrincipal.rows.map((row) => [row[0], row[1]])).toEqual(expect.arrayContaining([["Signify", "Inactive"], ["Mars", "Active"]]));
  });

  it("filters to one principal and still says whether it is active", async () => {
    const report = await build(dataset({ dormantPrincipalKeys: ["signify"] }), "Signify-Nairobi");
    expect(report.sections[0].rows).toHaveLength(1);
    expect(report.sections[0].rows[0][1]).toBe("Inactive");
  });
});
