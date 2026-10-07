import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aggregatePerformance } from "../lib/performanceAnalysis/aggregate";
import { GP_DEFINITION_NOTE, buildFindings, itemCaption, periodText } from "../lib/performanceAnalysis/narrative";
import type { PerfLine, PerformancePayload } from "../lib/performanceAnalysis/types";
import { CustomersSection } from "../components/performanceAnalysis/CustomersSection";
import { GrowthSection } from "../components/performanceAnalysis/GrowthSection";
import { ItemsSection } from "../components/performanceAnalysis/ItemsSection";
import { MonthlySection } from "../components/performanceAnalysis/MonthlySection";
import { OperationsSection } from "../components/performanceAnalysis/OperationsSection";
import { PerformanceAnalysisView } from "../components/performanceAnalysis/PerformanceAnalysisView";
import { PrincipalsSection } from "../components/performanceAnalysis/PrincipalsSection";
import { SummarySection } from "../components/performanceAnalysis/SummarySection";

// Deterministic pseudo-random lines across ten months and several principals, so the
// narrative and the sections are exercised on data with the variety of a real year.
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
      });
    }
  }
  return lines;
}

const lines = sampleLines();
const asOf = "2026-10-06";
const scopes: Record<string, string[]> = {
  "year to date": ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
  "a full quarter": ["2026-07", "2026-08", "2026-09"],
  "a single month": ["2026-09"],
  "the month in progress": ["2026-10"],
  "the first month of the year": ["2026-01"],
};
const reports = Object.fromEntries(Object.entries(scopes).map(([name, scopeMonths]) => [name, aggregatePerformance(lines, { asOf, scopeMonths })])) as Record<string, PerformancePayload>;

describe("performance analysis narrative", () => {
  it.each(Object.keys(scopes))("writes findings from the data for %s, with no placeholder values", (name) => {
    const p = reports[name];
    const findings = buildFindings(p);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings[0]).toContain("Net sales of **KES");
    for (const text of findings) expect(text).not.toMatch(/undefined|NaN|null|Infinity/);
  });

  it("describes the selected period in words", () => {
    expect(periodText(reports["year to date"])).toBe("1 Jan – 6 Oct 2026");
    expect(periodText(reports["a full quarter"])).toBe("1 Jul – 30 Sep 2026");
    expect(periodText(reports["a single month"])).toBe("September 2026");
    expect(periodText(reports["the month in progress"])).toBe("1 Oct – 6 Oct 2026");
  });

  it("words every item view without placeholders, including when there is nothing to compare", () => {
    for (const p of Object.values(reports)) {
      for (const view of ["top10", "top10gp", "gainers", "decliners", "belowCost"] as const) {
        expect(itemCaption(p, view)).not.toMatch(/undefined|NaN/);
      }
    }
    expect(itemCaption(reports["the month in progress"], "gainers")).toMatch(/complete earlier period/);
  });

  it("explains what gross profit means on the page", () => {
    expect(GP_DEFINITION_NOTE).toMatch(/Sales Performance and Financials/);
  });
});

describe("performance analysis sections", () => {
  it.each(Object.keys(scopes))("render every section for %s", (name) => {
    const p = reports[name];
    const html = [SummarySection, PrincipalsSection, MonthlySection, ItemsSection, CustomersSection, GrowthSection, OperationsSection].map((Section) => renderToString(createElement(Section, { p }))).join("");
    expect(html).toContain("What the numbers say");
    expect(html).toContain("1. Trended performance per principal");
    expect(html).toContain("2. Month-on-month performance");
    expect(html).toContain("3. Top 10 item performance");
    expect(html).toContain("4. Customer ranking and contribution");
    expect(html).toContain("5. Growth, gross profit and margin");
    expect(html).toContain("6. Branches, sales reps and returns");
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("shows tabs and no intro or period text on the page itself", () => {
    const html = renderToString(createElement(PerformanceAnalysisView));
    for (const tab of ["Summary", "Principals", "Month on month", "Top items", "Customers", "Growth &amp; GP", "Branches, reps &amp; returns"]) expect(html).toContain(tab);
    expect(html).not.toContain("SAP recorded GP");
    expect(html).not.toContain("Gross profit basis");
    expect(html).not.toContain("secondary sales across all principals");
    expect(html).not.toContain("net of credit notes, in Kenyan shillings");
    expect(html).not.toMatch(/Built .* \(Nairobi\)/);
    expect(html).not.toMatch(/full months? \+/);
  });
});
