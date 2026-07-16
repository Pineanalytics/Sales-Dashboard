import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { reportToExcelBlob } from "../lib/reports/toExcel";
import { reportToPdfBlob } from "../lib/reports/toPdf";
import type { ReportContent } from "../lib/reports/types";
import { REPORT_DEFINITIONS, type ReportContext } from "../lib/reports/definitions";
import { summarizeSalesForPeriod, resolvePeriodMonths } from "../lib/timeIntelligence";
import type { Dataset } from "../lib/types";

const SAMPLE_REPORT: ReportContent = {
  title: "Sample Report",
  generatedAt: new Date("2026-07-15T00:00:00.000Z"),
  summary: [
    { label: "Revenue", value: "1,000,000" },
    { label: "Target", value: "900,000" },
  ],
  sections: [
    { title: "By Principal", columns: ["Principal", "Revenue"], rows: [["Bic-Nairobi", 500000], ["Mars-Nairobi", 500000]] },
    { title: "By Account", columns: ["Account", "Amount"], rows: [["4000", 1000000]] },
  ],
};

describe("reportToExcelBlob", () => {
  it("produces one sheet per section, named after the section", async () => {
    const blob = reportToExcelBlob(SAMPLE_REPORT);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames).toEqual(["By Principal", "By Account"]);
  });

  it("writes the title, generated timestamp, and summary rows onto the first sheet", async () => {
    const blob = reportToExcelBlob(SAMPLE_REPORT);
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets["By Principal"];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];

    expect(aoa[0]).toEqual(["Sample Report"]);
    expect(aoa.some((row) => row[0] === "Revenue" && row[1] === "1,000,000")).toBe(true);
    expect(aoa.some((row) => row[0] === "Principal" && row[1] === "Revenue")).toBe(true);
    expect(aoa.some((row) => row[0] === "Bic-Nairobi" && row[1] === 500000)).toBe(true);
  });

  it("handles a report with no sections without throwing", async () => {
    const blob = reportToExcelBlob({ title: "Empty", generatedAt: new Date(), sections: [] });
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames).toEqual(["Report"]);
  });

  it("truncates sheet names to Excel's 31-character limit", async () => {
    const longTitleReport: ReportContent = {
      title: "Long",
      generatedAt: new Date(),
      sections: [{ title: "A Very Long Section Title That Exceeds The Limit", columns: ["X"], rows: [[1]] }],
    };
    const blob = reportToExcelBlob(longTitleReport);
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31);
  });
});

describe("reportToPdfBlob", () => {
  it("produces a non-empty PDF blob", () => {
    const blob = reportToPdfBlob(SAMPLE_REPORT);
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("handles a report with no sections without throwing", () => {
    const blob = reportToPdfBlob({ title: "Empty", generatedAt: new Date(), sections: [] });
    expect(blob.size).toBeGreaterThan(0);
  });

  it("handles a report with many rows across a page break without throwing", () => {
    const bigReport: ReportContent = {
      title: "Big Report",
      generatedAt: new Date(),
      sections: [{ title: "Rows", columns: ["A", "B"], rows: Array.from({ length: 100 }, (_, i) => [i, i * 2]) }],
    };
    const blob = reportToPdfBlob(bigReport);
    expect(blob.size).toBeGreaterThan(0);
  });
});

function salesRow(overrides: Partial<Dataset["monthlySales"][number]>): Dataset["monthlySales"][number] {
  return {
    year: "2026",
    month: "July",
    monthIndex: 6,
    location: "Nairobi",
    principal: "Bic-Nairobi",
    principalKey: "bic",
    revenue: 100000,
    target: 90000,
    cogs: 60000,
    grossProfit: 40000,
    grossMarginPct: 40,
    ...overrides,
  };
}

function emptyDataset(overrides: Partial<Dataset>): Dataset {
  return {
    monthlySales: [],
    monthlyCoverage: [],
    monthlyBrandCustomer: [],
    monthlyPL: [],
    weeklyProjection: [],
    stockTotal: {
      volume: 0, pcs: 0, value: 0, rrWeekValue: 0, rrWeekVolume: 0, daysStock: 0,
      itemCount: 0, outOfStockCount: 0, runningOutCount: 0, okCount: 0, noDataCount: 0, action: "",
    },
    stockItems: [],
    reportMeta: { title: "Test", sheet: "Test" },
    uploadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("report definitions reuse the same selectors the live views call", () => {
  it("sales report's summary matches summarizeSalesForPeriod directly", async () => {
    const dataset = emptyDataset({
      monthlySales: [salesRow({ principal: "Bic-Nairobi", revenue: 100000, target: 90000 }), salesRow({ principal: "Mars-Nairobi", revenue: 200000, target: 150000 })],
    });
    const salesDef = REPORT_DEFINITIONS.find((d) => d.key === "sales")!;
    const period = { kind: "MONTH" as const, year: "2026", month: "July" };
    const ctx: ReportContext = { dataset, period, principalKey: null, repFilter: null, periodLabel: "July 2026" };

    const content = await salesDef.build(ctx);
    const expected = summarizeSalesForPeriod(dataset, period, null);

    expect(content.summary?.find((s) => s.label === "Revenue")?.value).toBe(expected.revenue.toLocaleString());
    expect(content.sections[0].rows).toHaveLength(2);
  });

  it("stock report exposes stockTotal and every stockItem row", async () => {
    const dataset = emptyDataset({
      stockTotal: { volume: 100, pcs: 50, value: 5000, rrWeekValue: 200, rrWeekVolume: 10, daysStock: 14, itemCount: 2, outOfStockCount: 1, runningOutCount: 0, okCount: 1, noDataCount: 0, action: "OK" },
      stockItems: [
        { principal: "Bic", key: "bic-1", item: "Item A", openingVolume: 10, openingPcs: 5, openingValue: 1000, rrWeekValue: 100, rrWeekVolume: 5, daysCover: 7, action: "OK" },
        { principal: "Mars", key: "mars-1", item: "Item B", openingVolume: 20, openingPcs: 10, openingValue: 4000, rrWeekValue: 100, rrWeekVolume: 5, daysCover: 0, action: "Out of Stock" },
      ],
    });
    const stockDef = REPORT_DEFINITIONS.find((d) => d.key === "stock")!;
    const ctx: ReportContext = { dataset, period: { kind: "YTD", year: "2026", month: "July" }, principalKey: null, repFilter: null, periodLabel: "YTD 2026" };

    const content = await stockDef.build(ctx);
    expect(content.summary?.find((s) => s.label === "Item Count")?.value).toBe("2");
    expect(content.sections[0].rows).toHaveLength(2);
    expect(content.sections[0].rows[0][1]).toBe("Item A");
  });

  it("dataset-backed reports return an empty-but-valid report when dataset is null", async () => {
    const salesDef = REPORT_DEFINITIONS.find((d) => d.key === "sales")!;
    const content = await salesDef.build({ dataset: null, period: { kind: "YTD", year: "2026", month: "July" }, principalKey: null, repFilter: null, periodLabel: "YTD 2026" });
    expect(content.sections).toEqual([]);
  });

  it("every report definition maps to a distinct key and page", () => {
    const keys = REPORT_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stock report respects principalKey, rolling up by normalized brand key", async () => {
    const dataset = emptyDataset({
      stockItems: [
        { principal: "Bic-Nairobi", key: "bic", item: "Item A", openingVolume: 10, openingPcs: 5, openingValue: 1000, rrWeekValue: 100, rrWeekVolume: 5, daysCover: 7, action: "OK" },
        { principal: "Mars-Nairobi", key: "mars", item: "Item B", openingVolume: 20, openingPcs: 10, openingValue: 4000, rrWeekValue: 100, rrWeekVolume: 5, daysCover: 0, action: "Out of Stock" },
      ],
    });
    const stockDef = REPORT_DEFINITIONS.find((d) => d.key === "stock")!;
    const ctx: ReportContext = { dataset, period: { kind: "YTD", year: "2026", month: "July" }, principalKey: "Bic-Nairobi", repFilter: null, periodLabel: "YTD 2026" };

    const content = await stockDef.build(ctx);
    expect(content.sections[0].rows).toHaveLength(1);
    expect(content.sections[0].rows[0][1]).toBe("Item A");
  });

  it("coverage report respects repFilter (case-insensitive substring)", async () => {
    const dataset = emptyDataset({
      monthlyCoverage: [
        { year: "2026", month: "July", monthIndex: 6, principal: "Bic-Nairobi", principalKey: "bic", employeeName: "John Doe", salesRole: "Primary Sales", coverage: 100, productiveCalls: 80, productivityPct: 80 },
        { year: "2026", month: "July", monthIndex: 6, principal: "Bic-Nairobi", principalKey: "bic", employeeName: "Jane Smith", salesRole: "Primary Sales", coverage: 50, productiveCalls: 40, productivityPct: 80 },
      ],
    });
    const coverageDef = REPORT_DEFINITIONS.find((d) => d.key === "coverage")!;
    const ctx: ReportContext = { dataset, period: { kind: "MONTH", year: "2026", month: "July" }, principalKey: null, repFilter: "john", periodLabel: "July 2026" };

    const content = await coverageDef.build(ctx);
    expect(content.sections[0].rows).toHaveLength(1);
    expect(content.sections[0].rows[0][0]).toBe("John Doe");
  });

  it("time intelligence report scopes to the selected range, not the full dataset", async () => {
    const dataset = emptyDataset({
      monthlySales: [
        salesRow({ year: "2025", month: "December", monthIndex: 11, revenue: 100000 }),
        salesRow({ year: "2026", month: "January", monthIndex: 0, revenue: 200000 }),
        salesRow({ year: "2026", month: "July", monthIndex: 6, revenue: 300000 }),
      ],
    });
    const def = REPORT_DEFINITIONS.find((d) => d.key === "time-intelligence")!;
    const ctx: ReportContext = {
      dataset,
      period: { kind: "CUSTOM", year: "2026", month: "January", toYear: "2026", toMonth: "July" },
      principalKey: null,
      repFilter: null,
      periodLabel: "Custom",
    };

    const content = await def.build(ctx);
    expect(content.sections[0].rows).toHaveLength(2);
    expect(content.sections[0].rows.some((r) => r[1] === "December")).toBe(false);
  });
});

describe("resolvePeriodMonths CUSTOM range", () => {
  it("resolves a same-year span inclusive of both ends", () => {
    const months = resolvePeriodMonths({ kind: "CUSTOM", year: "2026", month: "March", toYear: "2026", toMonth: "June" });
    expect(months).toEqual([
      { year: "2026", monthIndex: 2 },
      { year: "2026", monthIndex: 3 },
      { year: "2026", monthIndex: 4 },
      { year: "2026", monthIndex: 5 },
    ]);
  });

  it("resolves a year-rollover span", () => {
    const months = resolvePeriodMonths({ kind: "CUSTOM", year: "2025", month: "November", toYear: "2026", toMonth: "February" });
    expect(months).toEqual([
      { year: "2025", monthIndex: 10 },
      { year: "2025", monthIndex: 11 },
      { year: "2026", monthIndex: 0 },
      { year: "2026", monthIndex: 1 },
    ]);
  });

  it("resolves a degenerate from===to span to a single month", () => {
    const months = resolvePeriodMonths({ kind: "CUSTOM", year: "2026", month: "July", toYear: "2026", toMonth: "July" });
    expect(months).toEqual([{ year: "2026", monthIndex: 6 }]);
  });

  it("returns an empty array when the to-anchor is missing", () => {
    const months = resolvePeriodMonths({ kind: "CUSTOM", year: "2026", month: "July" });
    expect(months).toEqual([]);
  });
});
