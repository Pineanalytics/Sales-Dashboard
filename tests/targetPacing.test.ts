import { describe, expect, it } from "vitest";
import { buildTargetPacingPlan, nairobiDateKey } from "../lib/targetPacing";

function rounded(values: number[]) {
  return values.map((value) => Number(value.toFixed(6)));
}

describe("buildTargetPacingPlan", () => {
  it("splits every non-live month across active working days and ties to the full-month target", () => {
    // April 2026 has 22 Mon-Fri working days across five Sunday-to-Saturday blocks.
    const plan = buildTargetPacingPlan({
      year: 2026,
      monthIndex: 3,
      monthlyTarget: 500,
      actuals: [],
      asOf: new Date("2026-06-01T12:00:00Z"),
    });

    expect(plan.isRebalanced).toBe(false);
    expect(plan.weeklyTargets).toHaveLength(5);
    expect(plan.metrics.totalWorkingDays).toBe(22);
    expect(rounded(plan.weeklyTargets.map((target) => target.targetValue))).toEqual([68.181818, 113.636364, 113.636364, 113.636364, 90.909091]);
    expect(plan.dailyTargets.reduce((sum, target) => sum + target.targetValue, 0)).toBeCloseTo(500);
  });

  it("carries a closed week's actual into the remaining active working days", () => {
    const plan = buildTargetPacingPlan({
      year: 2026,
      monthIndex: 3,
      monthlyTarget: 500,
      // Week 1 (Apr 1-4) achieved 40 against its original 100 target.
      actuals: [{ date: "2026-04-02", revenue: 40 }],
      // Apr 5 is the opening day of Week 2 in the configured convention.
      asOf: new Date("2026-04-05T09:00:00Z"),
    });

    expect(plan.isRebalanced).toBe(true);
    expect(plan.metrics.remainingWorkingDays).toBe(19);
    expect(plan.metrics.dailyRunRate).toBeCloseTo(460 / 19);
    expect(plan.weeklyTargets[0].targetValue).toBe(40);
    // Elapsed actuals plus open weekly targets reconcile to the full-month mission.
    expect(plan.weeklyTargets.reduce((sum, target) => sum + target.targetValue, 0)).toBeCloseTo(500);
  });

  it("uses the remaining working days to calculate the live daily run rate", () => {
    const plan = buildTargetPacingPlan({
      year: 2026,
      monthIndex: 3,
      monthlyTarget: 500,
      actuals: [{ date: "2026-04-02", revenue: 40 }, { date: "2026-04-05", revenue: 5 }],
      asOf: new Date("2026-04-06T09:00:00Z"),
    });

    expect(plan.metrics.dailyRunRate).toBeCloseTo(455 / 19);
    expect(plan.metrics.fullMonthBalance).toBe(455);
    expect(plan.metrics.rateOfSale).toBeCloseTo(45 / 4);
    expect(plan.metrics.projection).toBeCloseTo((45 / 4) * 22);
    const weekTwo = plan.weeklyTargets[1];
    expect(weekTwo.expectedRunRate).toBeCloseTo(455 / 19 * 5);
    const openWeekTwoDays = plan.dailyTargets.filter((target) => target.date.toISOString().slice(0, 10) >= "2026-04-06" && target.date.toISOString().slice(0, 10) <= "2026-04-11");
    expect(openWeekTwoDays).toHaveLength(6);
    expect(rounded(openWeekTwoDays.map((target) => target.targetValue))).toEqual([23.947368, 23.947368, 23.947368, 23.947368, 23.947368, 0]);
  });
});

describe("nairobiDateKey", () => {
  it("uses Nairobi's calendar date around a UTC day boundary", () => {
    expect(nairobiDateKey(new Date("2026-04-01T21:30:00Z"))).toBe("2026-04-02");
  });
});
