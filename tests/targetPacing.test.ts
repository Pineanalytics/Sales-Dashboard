import { describe, expect, it } from "vitest";
import { buildTargetPacingPlan, nairobiDateKey } from "../lib/targetPacing";

function rounded(values: number[]) {
  return values.map((value) => Number(value.toFixed(6)));
}

describe("buildTargetPacingPlan", () => {
  it("splits every non-live month evenly over its real calendar weeks and ties to the full-month target", () => {
    // April 2026 has five Sunday-to-Saturday blocks touching the month.
    const plan = buildTargetPacingPlan({
      year: 2026,
      monthIndex: 3,
      monthlyTarget: 500,
      actuals: [],
      asOf: new Date("2026-06-01T12:00:00Z"),
    });

    expect(plan.isRebalanced).toBe(false);
    expect(plan.weeklyTargets).toHaveLength(5);
    expect(rounded(plan.weeklyTargets.map((target) => target.targetValue))).toEqual([100, 100, 100, 100, 100]);
    expect(plan.dailyTargets.reduce((sum, target) => sum + target.targetValue, 0)).toBeCloseTo(500);
  });

  it("carries a closed week's miss into the current and remaining weeks", () => {
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
    expect(plan.weeklyTargets[0].targetValue).toBe(100);
    expect(rounded(plan.weeklyTargets.slice(1).map((target) => target.targetValue))).toEqual([115, 115, 115, 115]);
    // The closed week's actual plus the target required in open weeks still equals the monthly mission.
    expect(40 + plan.weeklyTargets.slice(1).reduce((sum, target) => sum + target.targetValue, 0)).toBeCloseTo(500);
  });

  it("carries a current week's closed-day gap across the days still open", () => {
    const plan = buildTargetPacingPlan({
      year: 2026,
      monthIndex: 3,
      monthlyTarget: 500,
      actuals: [{ date: "2026-04-02", revenue: 40 }, { date: "2026-04-05", revenue: 5 }],
      asOf: new Date("2026-04-06T09:00:00Z"),
    });

    const weekTwo = plan.weeklyTargets[1];
    expect(weekTwo.targetValue).toBe(115);
    // Apr 5 is closed at 5; its missed amount is re-spread across Apr 6-11.
    const openWeekTwoDays = plan.dailyTargets.filter((target) => target.date.toISOString().slice(0, 10) >= "2026-04-06" && target.date.toISOString().slice(0, 10) <= "2026-04-11");
    expect(rounded(openWeekTwoDays.map((target) => target.targetValue))).toEqual([18.333333, 18.333333, 18.333333, 18.333333, 18.333333, 18.333333]);
  });
});

describe("nairobiDateKey", () => {
  it("uses Nairobi's calendar date around a UTC day boundary", () => {
    expect(nairobiDateKey(new Date("2026-04-01T21:30:00Z"))).toBe("2026-04-02");
  });
});
