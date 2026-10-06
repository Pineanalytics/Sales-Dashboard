import { describe, expect, it } from "vitest";
import {
  DEFAULT_GP_MARGIN_TARGETS,
  GP_MARGIN_DEFAULT_KEY,
  buildGpTargetSummary,
  describeGpMarginTargets,
  mergeGpMarginTargets,
  splitGpTargetRows,
  daysCoverAtCost,
  describePeriod,
  gpMarginTargetPct,
  marginAchievementPct,
  periodElapsedDays,
  periodEndMonth,
  previousMonth,
  nairobiToday,
  runRateWindow,
  weeklyRunRateAtCost,
} from "../lib/financePresentation";
import { withGpMarginTargets } from "../lib/gpMarginTargets";

describe("GP margin targets", () => {
  it("uses the policy targets for the five main brands and 10% for everyone else", () => {
    expect(gpMarginTargetPct("Mars-Nairobi")).toBe(15);
    expect(gpMarginTargetPct("Mars")).toBe(15);
    expect(gpMarginTargetPct("EABL-Nyeri")).toBe(6);
    expect(gpMarginTargetPct("Eabl-Nyahururu")).toBe(6);
    expect(gpMarginTargetPct("Suntory-Nairobi")).toBe(7);
    expect(gpMarginTargetPct("Upfield-Nairobi")).toBe(10);
    expect(gpMarginTargetPct("Weetabix-Nairobi")).toBe(10);
    expect(gpMarginTargetPct("Unilever-Nyeri")).toBe(10);
    expect(gpMarginTargetPct("Tropikal-Nairobi")).toBe(10);
  });

  it("combines locations of a brand and orders the main brands first", () => {
    const summary = buildGpTargetSummary([
      { principal: "Tropikal-Nairobi", revenue: 100, target: 120, grossProfit: 8 },
      { principal: "EABL-Nyeri", revenue: 600, target: 700, grossProfit: 36 },
      { principal: "EABL-Nyahururu", revenue: 400, target: 300, grossProfit: 28 },
      { principal: "Mars-Nairobi", revenue: 1000, target: 1000, grossProfit: 140 },
    ]);
    expect(summary.rows.map((r) => r.label)).toEqual(["Mars", "EABL", "Tropikal"]);
    const eabl = summary.rows[1];
    expect(eabl).toMatchObject({ revenue: 1000, revenueTarget: 1000, marginTargetPct: 6, grossProfit: 64, marginPct: 6.4, variancePp: 0.4 });
    expect(eabl.gpTarget).toBeCloseTo(60);
    expect(eabl.gpAchievementPct).toBeCloseTo(106.7, 1);
    expect(eabl.achieved).toBe(true);
  });

  it("measures achievement against the principal's own target, not the actual margin", () => {
    const summary = buildGpTargetSummary([{ principal: "Mars-Nairobi", revenue: 1000, target: 1000, grossProfit: 100 }]);
    const mars = summary.rows[0];
    expect(mars.marginPct).toBe(10);
    expect(mars.marginTargetPct).toBe(15);
    expect(mars.variancePp).toBe(-5);
    expect(mars.gpTarget).toBeCloseTo(150);
    expect(mars.gpAchievementPct).toBeCloseTo(66.7, 1);
    expect(mars.achieved).toBe(false);
    expect(marginAchievementPct(10, 15)).toBe(66.7);
  });

  it("weights the company target margin by revenue targets", () => {
    const summary = buildGpTargetSummary([
      { principal: "Mars-Nairobi", revenue: 100, target: 100, grossProfit: 15 }, // 15% target
      { principal: "Suntory-Nairobi", revenue: 300, target: 300, grossProfit: 21 }, // 7% target
    ]);
    // (100*15% + 300*7%) / 400 = 9%
    expect(summary.total.marginTargetPct).toBe(9);
    expect(summary.total.marginPct).toBe(9);
    expect(summary.total.gpTarget).toBeCloseTo(36);
    expect(summary.total.gpAchievementPct).toBe(100);
    expect(summary.total.achieved).toBe(true);
  });

  it("falls back to the margin target when a principal has no revenue target", () => {
    const summary = buildGpTargetSummary([{ principal: "Bidco-Nairobi", revenue: 500, target: null, grossProfit: 40 }]);
    const row = summary.rows[0];
    expect(row.gpTarget).toBeNull();
    expect(row.gpAchievementPct).toBeNull();
    expect(row.variancePp).toBe(-2); // 8% against the 10% default
    expect(row.achieved).toBe(false);
    expect(summary.total.marginTargetPct).toBe(10); // revenue-weighted when no targets exist
  });

  it("judges the margin target on margin, not on how much of the revenue target is sold so far", () => {
    // Early in the period: a tenth of the revenue target sold, but at a margin above target.
    const summary = buildGpTargetSummary([{ principal: "Suntory-Nairobi", revenue: 100, target: 1000, grossProfit: 8 }]);
    const row = summary.rows[0];
    expect(row.gpAchievementPct).toBeCloseTo(11.4, 1); // 8 of a 70 GP target
    expect(row.variancePp).toBe(1); // 8% against the 7% target
    expect(row.achieved).toBe(true);
  });

  it("handles no revenue", () => {
    const summary = buildGpTargetSummary([{ principal: "Mars-Nairobi", revenue: 0, target: null, grossProfit: 0 }]);
    expect(summary.rows[0].marginPct).toBeNull();
    expect(summary.rows[0].achieved).toBeNull();
    expect(marginAchievementPct(null, 15)).toBeNull();
    expect(marginAchievementPct(8, 0)).toBeNull();
  });
});

describe("editable GP margin targets", () => {
  it("starts from the policy and lets a saved value win", () => {
    expect(mergeGpMarginTargets([])).toEqual(DEFAULT_GP_MARGIN_TARGETS);
    const merged = mergeGpMarginTargets([
      { brandKey: "mars", targetPct: 16.5 },
      { brandKey: "bidco", targetPct: 4 },
      { brandKey: GP_MARGIN_DEFAULT_KEY, targetPct: 8 },
    ]);
    expect(merged.byBrand.mars).toBe(16.5);
    expect(merged.byBrand.eabl).toBe(6); // untouched brands keep their default
    expect(merged.byBrand.bidco).toBe(4);
    expect(merged.defaultPct).toBe(8);
    expect(gpMarginTargetPct("Mars-Nairobi", merged)).toBe(16.5);
    expect(gpMarginTargetPct("Bidco-Nairobi", merged)).toBe(4);
    expect(gpMarginTargetPct("Tropikal-Nairobi", merged)).toBe(8);
  });

  it("ignores a saved row that is not a number and does not mutate the policy defaults", () => {
    const merged = mergeGpMarginTargets([{ brandKey: "mars", targetPct: Number.NaN }, { brandKey: "suntory", targetPct: 9 }]);
    expect(merged.byBrand.mars).toBe(15);
    expect(merged.byBrand.suntory).toBe(9);
    expect(DEFAULT_GP_MARGIN_TARGETS.byBrand.suntory).toBe(7);
  });

  it("feeds the achievement listing", () => {
    const targets = mergeGpMarginTargets([{ brandKey: "mars", targetPct: 10 }]);
    const summary = buildGpTargetSummary([{ principal: "Mars-Nairobi", revenue: 1000, target: 1000, grossProfit: 100 }], targets);
    expect(summary.rows[0]).toMatchObject({ marginTargetPct: 10, variancePp: 0, achieved: true });
    expect(summary.rows[0].gpTarget).toBeCloseTo(100);
  });

  it("describes the targets in force for a heading", () => {
    expect(describeGpMarginTargets(DEFAULT_GP_MARGIN_TARGETS)).toBe("Mars 15%, EABL 6%, Suntory 7%, Upfield 10%, Weetabix 10%, all others 10%");
    const edited = mergeGpMarginTargets([{ brandKey: "mars", targetPct: 14 }, { brandKey: "bidco", targetPct: 5 }, { brandKey: GP_MARGIN_DEFAULT_KEY, targetPct: 9 }]);
    expect(describeGpMarginTargets(edited)).toBe("Mars 14%, EABL 6%, Suntory 7%, Upfield 10%, Weetabix 10%, Bidco 5%, all others 9%");
  });
});

describe("GP vs target listing: five main brands, the rest compressed", () => {
  const principals = [
    { principal: "Mars-Nairobi", revenue: 1000, target: 1000, grossProfit: 150 },
    { principal: "Suntory-Nairobi", revenue: 500, target: 500, grossProfit: 35 },
    { principal: "Upfield-Nairobi", revenue: 400, target: 400, grossProfit: 40 },
    { principal: "EABL-Nyeri", revenue: 800, target: 800, grossProfit: 48 },
    { principal: "Weetabix-Nairobi", revenue: 300, target: 300, grossProfit: 30 },
    { principal: "Tropikal-Nairobi", revenue: 100, target: 100, grossProfit: 12 },
    { principal: "Unilever-Nairobi", revenue: 200, target: 400, grossProfit: 16 },
    { principal: "Unilever-Nyeri", revenue: 300, target: 400, grossProfit: 24 },
  ];

  it("lists the five main brands in the table's own order and folds everyone else into one row", () => {
    const { top, others } = splitGpTargetRows(buildGpTargetSummary(principals).rows, 3);
    expect(top.map((r) => r.label)).toEqual(["Mars", "Suntory", "Upfield", "EABL", "Weetabix"]);
    expect(others?.label).toBe("All Other Principals (3)");
    expect(others).toMatchObject({ revenue: 600, grossProfit: 52, revenueTarget: 900 });
    expect(others?.gpTarget).toBeCloseTo(90); // 900 x 10%
    expect(others?.marginTargetPct).toBe(10);
    expect(others?.marginPct).toBeCloseTo(8.7, 1);
    expect(others?.variancePp).toBeCloseTo(-1.3, 1);
    expect(others?.achieved).toBe(false);
  });

  it("weights the compressed target margin when the other brands carry different targets", () => {
    const targets = mergeGpMarginTargets([{ brandKey: "tropikal", targetPct: 20 }]);
    const { others } = splitGpTargetRows(
      buildGpTargetSummary(
        [
          { principal: "Tropikal-Nairobi", revenue: 100, target: 100, grossProfit: 12 }, // 20% target
          { principal: "Unilever-Nairobi", revenue: 300, target: 300, grossProfit: 24 }, // 10% target
        ],
        targets
      ).rows
    );
    // (100 x 20% + 300 x 10%) / 400 = 12.5%
    expect(others?.marginTargetPct).toBe(12.5);
  });

  it("has no compressed row when only the main brands sold", () => {
    const { top, others } = splitGpTargetRows(buildGpTargetSummary([{ principal: "Mars-Nairobi", revenue: 100, target: 100, grossProfit: 15 }]).rows);
    expect(top).toHaveLength(1);
    expect(others).toBeNull();
  });
});

describe("Financials tab margin targets", () => {
  it("swaps the flat stored margin for the target in force, keeping the revenue target weights", () => {
    const targets = mergeGpMarginTargets([{ brandKey: "mars", targetPct: 16 }]);
    const out = withGpMarginTargets(
      [
        { principal: "Mars-Nairobi", valueTarget: 100, grossProfitTarget: null, grossMarginTargetPct: 0.1 },
        { principal: "EABL-Nyeri", valueTarget: 200, grossProfitTarget: null, grossMarginTargetPct: 0.1 },
        { principal: "Tropikal-Nairobi", valueTarget: 50, grossProfitTarget: null, grossMarginTargetPct: null },
      ],
      targets
    );
    expect(out.map((g) => g.grossMarginTargetPct)).toEqual([0.16, 0.06, 0.1]);
    expect(out.map((g) => g.valueTarget)).toEqual([100, 200, 50]);
  });
});

describe("the period the slides follow", () => {
  it("finds the last month of the selected period and the one before", () => {
    expect(periodEndMonth({ kind: "MTD", year: "2026", month: "October" })).toEqual({ year: 2026, monthIndex: 9 });
    expect(periodEndMonth({ kind: "Q3", year: "2026" })).toEqual({ year: 2026, monthIndex: 8 });
    expect(periodEndMonth({ kind: "H1", year: "2026" })).toEqual({ year: 2026, monthIndex: 5 });
    expect(previousMonth({ year: 2026, monthIndex: 0 })).toEqual({ year: 2025, monthIndex: 11 });
    expect(previousMonth({ year: 2026, monthIndex: 9 })).toEqual({ year: 2026, monthIndex: 8 });
  });

  it("counts only the days that have happened", () => {
    const today = { year: 2026, monthIndex: 9, day: 6 };
    expect(periodElapsedDays({ kind: "MTD", year: "2026", month: "October" }, today)).toBe(6);
    expect(periodElapsedDays({ kind: "MONTH", year: "2026", month: "September" }, today)).toBe(30);
    expect(periodElapsedDays({ kind: "Q3", year: "2026" }, today)).toBe(92);
    // Q4: all of Oct..Dec, but only 6 days of October have elapsed.
    expect(periodElapsedDays({ kind: "Q4", year: "2026" }, today)).toBe(6);
  });

  it("reads today in Nairobi, which is ahead of UTC", () => {
    expect(nairobiToday(new Date("2026-10-05T22:30:00Z"))).toEqual({ year: 2026, monthIndex: 9, day: 6 });
    expect(nairobiToday(new Date("2026-12-31T21:30:00Z"))).toEqual({ year: 2027, monthIndex: 0, day: 1 });
  });

  it("describes the period", () => {
    expect(describePeriod({ kind: "MTD", year: "2026", month: "October" })).toBe("MTD October 2026");
    expect(describePeriod({ kind: "MONTH", year: "2026", month: "September" })).toBe("September 2026");
    expect(describePeriod({ kind: "Q3", year: "2026" })).toBe("Q3 2026");
    expect(describePeriod({ kind: "YTD", year: "2026", month: "September" })).toBe("YTD to September 2026");
  });
});

describe("cost-level run rate and days cover", () => {
  it("adds the previous month to the run-rate window early in a month", () => {
    expect(runRateWindow(6, { year: 2026, monthIndex: 9 })).toEqual({ usePrior: true, prior: { year: 2026, monthIndex: 8 }, priorDays: 30, windowDays: 36 });
    expect(runRateWindow(27, { year: 2026, monthIndex: 0 })).toMatchObject({ usePrior: true, prior: { year: 2025, monthIndex: 11 }, priorDays: 31, windowDays: 58 });
  });

  it("uses the period alone once four weeks have elapsed", () => {
    expect(runRateWindow(28, { year: 2026, monthIndex: 8 })).toMatchObject({ usePrior: false, windowDays: 28 });
    expect(runRateWindow(92, { year: 2026, monthIndex: 6 })).toMatchObject({ usePrior: false, windowDays: 92 });
  });

  it("spreads cost of sales over the elapsed weeks", () => {
    expect(weeklyRunRateAtCost(700, 14)).toBe(350);
    expect(weeklyRunRateAtCost(700, 0)).toBeNull();
  });

  it("covers stock at cost against the weekly cost run rate", () => {
    expect(daysCoverAtCost(1000, 350)).toBe(20);
    expect(daysCoverAtCost(1000, null)).toBeNull();
    expect(daysCoverAtCost(1000, 0)).toBeNull();
  });

  it("gives longer cover than selling-price run rate would for the same stock", () => {
    // Stock 1,000 at cost; weekly sales 500 at selling price = 450 at cost (10% margin).
    expect(daysCoverAtCost(1000, 450)).toBeGreaterThan(daysCoverAtCost(1000, 500) as number);
  });
});
