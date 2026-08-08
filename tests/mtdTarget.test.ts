import { describe, it, expect } from "vitest";
import { countWorkingDaysInMonth, countElapsedWorkingDays, computeMtdTargetByTeamLeader, type MtdTargetInputs } from "../lib/mtdTarget";

// August 2026: 1st is a Saturday, 31st is a Monday - 21 Mon-Fri working days.
describe("countWorkingDaysInMonth", () => {
  it("counts only Mon-Fri for a known month", () => {
    expect(countWorkingDaysInMonth(2026, 7)).toBe(21); // August = monthIndex 7
  });

  it("excludes both Saturday and Sunday", () => {
    // February 2026: 1 Sun, 28 Sat - 20 working days.
    expect(countWorkingDaysInMonth(2026, 1)).toBe(20);
  });
});

describe("countElapsedWorkingDays", () => {
  it("counts Mon-Fri from the 1st through today inclusive, mid-month", () => {
    // Aug 8 2026 is a Saturday - elapsed working days = Mon Aug 3 - Fri Aug 7 = 5.
    const today = new Date(Date.UTC(2026, 7, 8));
    expect(countElapsedWorkingDays(2026, 7, today)).toBe(5);
  });

  it("returns 0 when today is before the month starts", () => {
    const today = new Date(Date.UTC(2026, 6, 15)); // July, month is August
    expect(countElapsedWorkingDays(2026, 7, today)).toBe(0);
  });

  it("returns every working day in the month when today is after it ends", () => {
    const today = new Date(Date.UTC(2026, 8, 15)); // September, month is August
    expect(countElapsedWorkingDays(2026, 7, today)).toBe(countWorkingDaysInMonth(2026, 7));
  });

  it("a weekend 'today' still only counts the working days already passed, not the weekend day itself", () => {
    const friday = new Date(Date.UTC(2026, 7, 7));
    const saturday = new Date(Date.UTC(2026, 7, 8));
    expect(countElapsedWorkingDays(2026, 7, saturday)).toBe(countElapsedWorkingDays(2026, 7, friday));
  });
});

describe("computeMtdTargetByTeamLeader", () => {
  const baseInputs = (overrides: Partial<MtdTargetInputs> = {}): MtdTargetInputs => ({
    principalTargets: [{ principal: "Mars-Nairobi", valueTarget: 90_000_000 }],
    assignments: [],
    contributions: [],
    ...overrides,
  });

  it("splits a principal's monthly target across a Team Leader's reps by RepContribution share, then prorates by working days", () => {
    const inputs = baseInputs({
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: null },
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "2", contributionPct: null },
      ],
      contributions: [
        { principal: "Mars-Nairobi", employeeCode: "1", sharePct: 0.3 },
        { principal: "Mars-Nairobi", employeeCode: "2", sharePct: 0.7 },
      ],
    });
    // Full month target for tl-a = 90M. Half the month elapsed -> 45M.
    const result = computeMtdTargetByTeamLeader(inputs, 10, 20);
    expect(result).toHaveLength(1);
    expect(result[0].teamLeaderId).toBe("tl-a");
    expect(result[0].targetValue).toBeCloseTo(45_000_000);
  });

  it("prefers a rep's declared contributionPct over their computed RepContribution.sharePct", () => {
    const inputs = baseInputs({
      assignments: [{ teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 0.5 }],
      contributions: [{ principal: "Mars-Nairobi", employeeCode: "1", sharePct: 0.1 }],
    });
    const result = computeMtdTargetByTeamLeader(inputs, 20, 20); // full month, no proration
    expect(result[0].targetValue).toBeCloseTo(45_000_000); // 90M * 0.5, not 0.1
  });

  it("falls back to an even split across the group when a rep has neither a declared nor a computed share", () => {
    const inputs = baseInputs({
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: null },
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "2", contributionPct: null },
      ],
      contributions: [],
    });
    const result = computeMtdTargetByTeamLeader(inputs, 20, 20);
    expect(result[0].targetValue).toBeCloseTo(90_000_000); // both reps under the same TL - full target regardless of split
  });

  it("gives a principal with no Target row yet a target of 0, not undefined/NaN", () => {
    const inputs: MtdTargetInputs = {
      principalTargets: [],
      assignments: [{ teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 1 }],
      contributions: [],
    };
    const result = computeMtdTargetByTeamLeader(inputs, 10, 20);
    expect(result).toHaveLength(0); // zero-target principals are skipped entirely, same as a principal with no reps
  });

  it("never surfaces a Team Leader with zero currently-active Primary assignments - no legacy-identity special-casing needed", () => {
    const inputs = baseInputs({ assignments: [] });
    const result = computeMtdTargetByTeamLeader(inputs, 10, 20);
    expect(result).toHaveLength(0);
  });

  it("counts a matrix-assigned rep once per Team Leader they're actively assigned under for the same principal", () => {
    const inputs = baseInputs({
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 0.4 },
        { teamLeaderId: "tl-b", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 0.4 },
      ],
    });
    const result = computeMtdTargetByTeamLeader(inputs, 20, 20);
    const byTl = new Map(result.map((r) => [r.teamLeaderId, r.targetValue]));
    expect(byTl.get("tl-a")).toBeCloseTo(36_000_000); // 90M * 0.4, counted independently per Team Leader
    expect(byTl.get("tl-b")).toBeCloseTo(36_000_000);
  });

  it("rolls up every Team Leader across multiple principals independently", () => {
    const inputs: MtdTargetInputs = {
      principalTargets: [
        { principal: "Mars-Nairobi", valueTarget: 90_000_000 },
        { principal: "EABL-Nyeri", valueTarget: 87_400_000 },
      ],
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 1 },
        { teamLeaderId: "tl-a", principal: "EABL-Nyeri", employeeCode: "1", contributionPct: 1 },
      ],
      contributions: [],
    };
    const result = computeMtdTargetByTeamLeader(inputs, 20, 20);
    expect(result).toHaveLength(1);
    expect(result[0].targetValue).toBeCloseTo(90_000_000 + 87_400_000);
  });

  it("returns 0 for every row when workingDaysInMonth is 0, without dividing by zero", () => {
    const inputs = baseInputs({
      assignments: [{ teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 1 }],
    });
    const result = computeMtdTargetByTeamLeader(inputs, 0, 0);
    expect(result[0].targetValue).toBe(0);
  });
});
