import { describe, expect, it } from "vitest";
import {
  buildGpTargetSummary,
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

  it("handles no revenue", () => {
    const summary = buildGpTargetSummary([{ principal: "Mars-Nairobi", revenue: 0, target: null, grossProfit: 0 }]);
    expect(summary.rows[0].marginPct).toBeNull();
    expect(summary.rows[0].achieved).toBeNull();
    expect(marginAchievementPct(null, 15)).toBeNull();
    expect(marginAchievementPct(8, 0)).toBeNull();
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
