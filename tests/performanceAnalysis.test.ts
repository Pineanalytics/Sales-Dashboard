import { describe, expect, it } from "vitest";
import { aggregatePerformance, comparisonWindows } from "../lib/performanceAnalysis/aggregate";
import type { PerfLine } from "../lib/performanceAnalysis/types";

function line(month: string, over: Partial<PerfLine>): PerfLine {
  const sales = over.sales ?? 0;
  return {
    month,
    doc: "invoice",
    customerCode: "C1",
    customerName: "Alpha Wines",
    rep: "Rep One",
    principal: "A",
    itemCode: "I1",
    itemName: "Item One",
    warehouse: "Main",
    cases: 10,
    sales,
    gp: sales * 0.1,
    gpRecorded: sales * 0.05,
    ...over,
  };
}

// Principal A sells to a trade customer, principal B only to a route van (an internal account).
//   Q2 (Apr-Jun): A 1.0M/month, B 0.5M/month                   -> 4.5M
//   Q3 (Jul-Sep): A 1.5M/month (Aug has a 0.1M credit note), B 0.5M/month -> 5.9M
//   Oct: A 0.2M (month to date)
function fixture(): PerfLine[] {
  const lines: PerfLine[] = [];
  const bLine = (month: string) => line(month, { principal: "B", itemCode: "I2", itemName: "Item Two", customerCode: "C2", customerName: "Route 5 van", sales: 500_000, gp: -25_000, gpRecorded: 0 });
  for (const month of ["2026-04", "2026-05", "2026-06"]) {
    lines.push(line(month, { sales: 1_000_000 }), bLine(month));
  }
  for (const month of ["2026-07", "2026-08", "2026-09"]) {
    lines.push(line(month, { sales: 1_500_000 }), bLine(month));
  }
  lines.push(line("2026-08", { doc: "credit", sales: -100_000, cases: -1 }));
  lines.push(line("2026-10", { sales: 200_000 }));
  return lines;
}

describe("aggregatePerformance", () => {
  const p = aggregatePerformance(fixture(), { basis: "dashboard", asOf: "2026-10-06" });

  it("detects the month-to-date month and the comparison periods", () => {
    expect(p.mtd).toBe(true);
    expect(p.labels).toEqual({ cq: "Q3", pq: "Q2", cm: "Sep", pm: "Aug" });
    expect(p.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("totals sales, credit notes and the quarter comparison", () => {
    expect(p.kpi.sales).toBe(10_600_000);
    expect(p.kpi.gross).toBe(10_700_000);
    expect(p.kpi.cn).toBe(-100_000);
    expect(p.kpi.cnPct).toBe(0.9);
    expect(p.kpi.pqSales).toBe(4_500_000);
    expect(p.kpi.cqSales).toBe(5_900_000);
    expect(p.kpi.cqSalesGrowth).toBe(31.1);
    expect(p.kpi.mtdSales).toBe(200_000);
    expect(p.kpi.cmSales).toBe(2_000_000);
    expect(p.kpi.pmSales).toBe(1_900_000);
  });

  it("leaves the month-to-date month out of month-on-month growth", () => {
    const sep = p.monthly.find((row) => row.m === "2026-09")!;
    const oct = p.monthly.find((row) => row.m === "2026-10")!;
    expect(sep.mom).toBe(5.26);
    expect(oct.mom).toBeNull();
    expect(oct.gpMom).toBeNull();
  });

  it("ranks principals and computes their growth, margin and returns", () => {
    expect(p.principals.map((row) => row.p)).toEqual(["A", "B"]);
    const a = p.principals[0];
    expect(a.sales).toBe(7_600_000);
    expect(a.gpm).toBe(10);
    expect(a.cqSales).toBe(4_400_000);
    expect(a.cqGrowth).toBe(46.7);
    expect(a.cnPct).toBe(1.3);
    expect(p.bridge.find((row) => row.p === "A")).toEqual({ p: "A", ds: 1_400_000, dg: 140_000 });
  });

  it("treats route / van accounts as internal and keeps them out of the trade view", () => {
    expect(p.concentration.internalCount).toBe(1);
    expect(p.concentration.tActive).toBe(1);
    expect(p.concentration.internalShare).toBe(28.3);
    expect(p.topTrade).toHaveLength(1);
    expect(p.topTrade[0].code).toBe("C1");
    expect(p.topCustomers).toHaveLength(2);
    expect(p.topCustomers.find((row) => row.code === "C2")!.internal).toBe(true);
    expect(p.monthly.find((row) => row.m === "2026-09")!.trade).toBe(1_500_000);
  });

  it("flags items that sell below cost and counts the SKUs behind 80% of sales", () => {
    expect(p.belowCost.map((row) => row.code)).toEqual(["I2"]);
    expect(p.belowCost[0].gp).toBe(-150_000);
    expect(p.sku80).toBe(2);
    expect(p.skuActive).toBe(2);
    expect(p.top10Share).toBe(100);
  });

  it("builds the customer movement counts from trade accounts only", () => {
    expect(p.movement[0]).toMatchObject({ m: "2026-04", active: 1, retained: 0, new: 1, lost: 0 });
    expect(p.movement[1]).toMatchObject({ m: "2026-05", active: 1, retained: 1, new: 0 });
  });

  it("builds the same lines on the SAP-recorded gross profit when asked", () => {
    const recorded = aggregatePerformance(fixture(), { basis: "recorded", asOf: "2026-10-06" });
    expect(recorded.basis).toBe("recorded");
    expect(recorded.kpi.sales).toBe(p.kpi.sales);
    expect(recorded.kpi.gp).toBe(380_000);
    expect(recorded.kpi.gp).not.toBe(p.kpi.gp);
    expect(p.kpi.gp).toBe(610_000);
  });

  it("hides growth where the comparison base is too small to mean anything", () => {
    const lines = [...fixture(), line("2026-06", { principal: "C", itemCode: "I3", itemName: "Tiny", customerCode: "C3", customerName: "Beta", sales: 20_000 }), line("2026-09", { principal: "C", itemCode: "I3", itemName: "Tiny", customerCode: "C3", customerName: "Beta", sales: 90_000 })];
    const tiny = aggregatePerformance(lines, { basis: "dashboard", asOf: "2026-10-06" }).principals.find((row) => row.p === "C")!;
    expect(tiny.pqSales).toBe(20_000);
    expect(tiny.cqGrowth).toBeNull();
    expect(tiny.cqGpGrowth).toBeNull();
  });
});

describe("aggregatePerformance for a selected period", () => {
  const asOf = "2026-10-06";
  const forScope = (scopeMonths: string[]) => aggregatePerformance(fixture(), { basis: "dashboard", asOf, scopeMonths });

  it("cuts totals, rankings and shares to a single month and compares it with the month before", () => {
    const p = forScope(["2026-09"]);
    expect(p.scope).toEqual(["2026-09"]);
    expect(p.mtd).toBe(false);
    expect(p.kpi.sales).toBe(2_000_000);
    expect(p.kpi.lines).toBe(2);
    expect(p.labels).toMatchObject({ cq: "Sep", pq: "Aug", cm: "Sep", pm: "Aug" });
    expect(p.kpi.cqSales).toBe(2_000_000);
    expect(p.kpi.pqSales).toBe(1_900_000);
    expect(p.kpi.cqSalesGrowth).toBe(5.3);
    expect(p.principals.map((row) => [row.p, row.sales, row.share])).toEqual([
      ["A", 1_500_000, 75],
      ["B", 500_000, 25],
    ]);
    expect(p.topCustomers).toHaveLength(2);
    expect(p.concentration.internalCount).toBe(1);
  });

  it("keeps earlier months for context but flags which belong to the period", () => {
    const p = forScope(["2026-09"]);
    expect(p.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(p.monthly.filter((row) => row.inScope).map((row) => row.m)).toEqual(["2026-09"]);
    expect(p.principals[0].m).toHaveLength(6);
  });

  it("compares a full quarter with the quarter before it", () => {
    const p = forScope(["2026-07", "2026-08", "2026-09"]);
    expect(p.labels).toMatchObject({ cq: "Q3", pq: "Q2" });
    expect(p.kpi.sales).toBe(5_900_000);
    expect(p.kpi.cqSalesGrowth).toBe(31.1);
    expect(p.principals[0].cqGrowth).toBe(46.7);
  });

  it("compares a two-month period with the two months before it", () => {
    const p = forScope(["2026-07", "2026-08"]);
    expect(p.labels).toMatchObject({ cq: "Jul–Aug", pq: "May–Jun" });
    expect(p.kpi.cqSales).toBe(3_900_000);
    expect(p.kpi.pqSales).toBe(3_000_000);
  });

  it("uses the latest complete quarter inside a longer period", () => {
    const p = forScope(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(p.labels).toMatchObject({ cq: "Q3", pq: "Q2" });
    expect(p.mtd).toBe(true);
  });

  it("offers no comparison for a month still in progress, and none before the data starts", () => {
    const mtd = forScope(["2026-10"]);
    expect(mtd.mtd).toBe(true);
    expect(mtd.kpi.sales).toBe(200_000);
    expect(mtd.labels.cq).toBeNull();
    expect(mtd.kpi.cqSalesGrowth).toBeNull();
    expect(mtd.gainers).toEqual([]);
    expect(mtd.bridge).toEqual([]);
    const earliest = forScope(["2026-04"]);
    expect(earliest.labels.cq).toBeNull();
    expect(earliest.kpi.sales).toBe(1_500_000);
  });

  it("still lists a principal that stopped selling when it sold in the comparison window", () => {
    const lines = [...fixture(), line("2026-08", { principal: "C", itemCode: "I3", itemName: "Old line", customerCode: "C3", customerName: "Beta", sales: 400_000 })];
    const p = aggregatePerformance(lines, { basis: "dashboard", asOf, scopeMonths: ["2026-09"] });
    const stopped = p.principals.find((row) => row.p === "C")!;
    expect(stopped.sales).toBe(0);
    expect(stopped.pqSales).toBe(400_000);
    expect(stopped.cqGrowth).toBe(-100);
    expect(p.decliners[0].code).toBe("I3");
    // ...but it is not counted as a customer or SKU of the period
    expect(p.kpi.skus).toBe(2);
    expect(p.topCustomers.some((row) => row.code === "C3")).toBe(false);
  });
});

describe("comparisonWindows", () => {
  const has = (months: string[]) => (month: string) => months.includes(month);
  const year = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

  it("takes the latest complete quarter of a long period", () => {
    expect(comparisonWindows(year, true, has(year))).toEqual({ current: ["2026-07", "2026-08", "2026-09"], prior: ["2026-04", "2026-05", "2026-06"] });
  });

  it("takes a short period's own full months", () => {
    expect(comparisonWindows(["2026-09"], false, has(year))).toEqual({ current: ["2026-09"], prior: ["2026-08"] });
  });

  it("returns nothing when the earlier window has no data or the only month is in progress", () => {
    expect(comparisonWindows(["2026-01"], false, has(year))).toEqual({ current: [], prior: [] });
    expect(comparisonWindows(["2026-10"], true, has(year))).toEqual({ current: [], prior: [] });
  });
});

describe("aggregatePerformance with little data", () => {
  it("returns blank comparisons rather than failing before a quarter has closed", () => {
    const lines = [line("2026-01", { sales: 100_000 }), line("2026-02", { sales: 120_000 })];
    const p = aggregatePerformance(lines, { basis: "dashboard", asOf: "2026-03-02" });
    expect(p.mtd).toBe(false);
    expect(p.labels.cq).toBeNull();
    expect(p.labels.pq).toBeNull();
    expect(p.kpi.cqSales).toBeNull();
    expect(p.kpi.cqSalesGrowth).toBeNull();
    expect(p.bridge).toEqual([]);
    expect(p.gainers).toEqual([]);
    expect(p.kpi.avgMonth).toBe(110_000);
  });

  it("handles a month still in progress as the only month", () => {
    const p = aggregatePerformance([line("2026-01", { sales: 50_000 })], { basis: "dashboard", asOf: "2026-01-09" });
    expect(p.mtd).toBe(true);
    expect(p.kpi.avgMonth).toBeNull();
    expect(p.kpi.mtdSales).toBe(50_000);
    expect(p.labels.cm).toBeNull();
  });

  it("returns an empty report for no lines", () => {
    const p = aggregatePerformance([], { basis: "dashboard", asOf: "2026-01-09" });
    expect(p.months).toEqual([]);
    expect(p.kpi.sales).toBe(0);
    expect(p.principals).toEqual([]);
    expect(p.pareto).toEqual([]);
  });
});
