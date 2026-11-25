import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aggregateCreditNotes } from "../lib/creditNotes/aggregate";
import type { PerfLine } from "../lib/performanceAnalysis/types";
import { CreditNotesView } from "../components/creditNotes/CreditNotesView";
import { EntitySections } from "../components/creditNotes/EntitySections";
import { OverviewSection } from "../components/creditNotes/OverviewSection";

// Deterministic lines over six months, several principals, reps and branches, with credit notes on about one line in eight.
function sampleLines(): PerfLine[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const principals = ["EABL", "Mars", "Unilever", "Suntory"];
  const lines: PerfLine[] = [];
  for (let m = 5; m <= 10; m += 1) {
    for (let i = 0; i < 120; i += 1) {
      const principal = principals[Math.floor(next() * principals.length)];
      const credit = next() < 0.125;
      const customer = Math.floor(next() * 12);
      const item = Math.floor(next() * 20);
      const sales = Math.round((10_000 + next() * 300_000) * (credit ? -0.6 : 1));
      lines.push({
        month: `2026-${String(m).padStart(2, "0")}`,
        doc: credit ? "credit" : "invoice",
        customerCode: `C${customer}`,
        customerName: `Customer ${customer}`,
        rep: `Rep ${Math.floor(next() * 4)}`,
        principal,
        itemCode: `${principal}-${item}`,
        itemName: `${principal} item ${item}`,
        warehouse: ["Nairobi", "Nyeri", "Van 1"][Math.floor(next() * 3)],
        cases: credit ? -3 : 12,
        sales,
        gp: Math.round(sales * 0.12),
      });
    }
  }
  return lines;
}

const report = aggregateCreditNotes(sampleLines(), { asOf: "2026-10-20", scopeMonths: ["2026-09", "2026-10"] });

describe("the Credit Notes & Returns page", () => {
  it("builds a report from the sample lines", () => {
    expect(report.kpi.credit).toBeGreaterThan(0);
    expect(report.priorScope).toEqual(["2026-07", "2026-08"]);
    expect(report.insights.length).toBeGreaterThan(1);
  });

  it("renders the overview with its figures, insights and tables", () => {
    const html = renderToString(createElement(OverviewSection, { report, onOpen: () => undefined }));
    expect(html).toContain("Credit notes");
    expect(html).toContain("% of invoiced");
    expect(html).toContain("What stands out");
    expect(html).toContain("By principal");
    expect(html).toContain("Largest customers");
  });

  it.each(["principals", "items", "customers", "reps", "branches", "lines"] as const)("renders the %s tab", (tab) => {
    const html = renderToString(createElement(EntitySections, { tab, report, onFilter: () => undefined }));
    expect(html.length).toBeGreaterThan(500);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("names the principals, customers and reps it ranks", () => {
    const principals = renderToString(createElement(EntitySections, { tab: "principals", report, onFilter: () => undefined }));
    for (const row of report.principals) expect(principals).toContain(row.p);
    const customers = renderToString(createElement(EntitySections, { tab: "customers", report, onFilter: () => undefined }));
    expect(customers).toContain(report.customers[0].name);
    const reps = renderToString(createElement(EntitySections, { tab: "reps", report, onFilter: () => undefined }));
    expect(reps).toContain(report.reps[0].n);
  });

  it("renders the page shell, with a loading state before the report arrives", () => {
    const html = renderToString(createElement(CreditNotesView));
    expect(html).toContain("Credit notes &amp; returns");
    expect(html).toContain("Distributor returns");
    expect(html).toContain("Largest credit lines");
  });
});
