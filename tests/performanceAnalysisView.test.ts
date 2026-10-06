import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aggregatePerformance } from "../lib/performanceAnalysis/aggregate";
import { buildFindings, gpBasisNote, itemCaption, periodDetail, periodText } from "../lib/performanceAnalysis/narrative";
import { isPerformanceSnapshotPayload } from "../lib/performanceAnalysis/store";
import type { PerfLine, PerformanceSnapshotPayload } from "../lib/performanceAnalysis/types";
import { PerformanceAnalysisView } from "../components/performanceAnalysis/PerformanceAnalysisView";

// Deterministic pseudo-random lines across ten months and several principals, so the
// narrative and the page are exercised on data with the variety of a real year.
function sampleLines(): PerfLine[] {
  let seed = 11;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const principals = ["EABL", "Mars", "Unilever", "Upfield", "Suntory", "Weetabix", "Tropikal", "Promasidor"];
  const customers = ["Tetu Wines", "Kiambu Wholesalers", "EABL Nyahururu CBD van", "cash customer UKL", "Mwea Supermarket", "Nyeri Liquor Hub", "Karatina Stores", "Embu Mart"];
  const lines: PerfLine[] = [];
  for (let m = 1; m <= 10; m += 1) {
    const month = `2026-${String(m).padStart(2, "0")}`;
    const count = m === 10 ? 30 : 160;
    for (let i = 0; i < count; i += 1) {
      const principal = principals[Math.floor(next() ** 1.5 * principals.length)];
      if (principal === "Promasidor" && m >= 7) continue;
      const itemNo = Math.floor(next() * 40);
      const customerIndex = Math.floor(next() * customers.length);
      const credit = next() < 0.1;
      const sales = Math.round((20_000 + next() * 400_000) * (credit ? -0.8 : 1));
      lines.push({
        month,
        doc: credit ? "credit" : "invoice",
        customerCode: `C${customerIndex}`,
        customerName: customers[customerIndex],
        rep: `Rep ${Math.floor(next() * 5)}`,
        principal,
        itemCode: `${principal}-${itemNo}`,
        itemName: `${principal} product ${itemNo}`,
        warehouse: ["Nairobi Main Warehouse", "Nyeri Warehouse", "Nyahururu Van"][Math.floor(next() * 3)],
        cases: credit ? -5 : 20,
        sales,
        gp: Math.round(sales * (next() * 0.16 - 0.03)),
        gpRecorded: Math.round(sales * (next() * 0.1)),
      });
    }
  }
  return lines;
}

function snapshot(): PerformanceSnapshotPayload {
  const lines = sampleLines();
  return {
    version: 1,
    generatedAt: "2026-10-06T10:00:00.000Z",
    asOf: "2026-10-06",
    lineCount: lines.length,
    excludedSales: 1_250_000,
    excludedLines: 12,
    dashboard: aggregatePerformance(lines, { basis: "dashboard", asOf: "2026-10-06" }),
    recorded: aggregatePerformance(lines, { basis: "recorded", asOf: "2026-10-06" }),
  };
}

describe("performance analysis narrative", () => {
  const p = snapshot().dashboard;

  it("writes findings from the data, with no placeholder values", () => {
    const findings = buildFindings(p);
    expect(findings.length).toBeGreaterThanOrEqual(5);
    expect(findings[0]).toContain("Net sales of **KES");
    for (const text of findings) {
      expect(text).not.toMatch(/undefined|NaN|null|Infinity/);
    }
  });

  it("describes the period and each item view", () => {
    expect(periodText(p)).toBe("1 Jan – 6 Oct 2026");
    expect(periodDetail(p)).toBe("9 full months + Oct MTD (6 days)");
    for (const view of ["top10", "top10gp", "gainers", "decliners", "belowCost"] as const) {
      expect(itemCaption(p, view)).not.toMatch(/undefined|NaN/);
    }
  });

  it("explains which gross profit measure is on screen", () => {
    expect(gpBasisNote("dashboard")).toMatch(/Sales Performance/);
    expect(gpBasisNote("recorded")).toMatch(/moving-average/);
  });
});

describe("PerformanceAnalysisView", () => {
  it("renders every section of the report", () => {
    const html = renderToString(createElement(PerformanceAnalysisView, { snapshot: snapshot() }));
    for (const heading of [
      "What the numbers say",
      "1. Trended performance per principal",
      "2. Month-on-month performance",
      "3. Top 10 item performance",
      "4. Customer ranking and contribution",
      "5. Growth, gross profit and margin",
      "6. Branches, sales reps and returns",
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("Dashboard GP");
    expect(html).toContain("SAP recorded GP");
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("accepts a stored snapshot only when it has the expected shape", () => {
    expect(isPerformanceSnapshotPayload(snapshot())).toBe(true);
    expect(isPerformanceSnapshotPayload({ version: 1 })).toBe(false);
    expect(isPerformanceSnapshotPayload(null)).toBe(false);
    expect(isPerformanceSnapshotPayload({ ...snapshot(), recorded: undefined })).toBe(false);
  });
});
