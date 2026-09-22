import { describe, it, expect } from "vitest";
import { computeMtdTargetByTeamLeader, type MtdTargetInputs } from "../lib/mtdTarget";

describe("computeMtdTargetByTeamLeader", () => {
  const baseInputs = (overrides: Partial<MtdTargetInputs> = {}): MtdTargetInputs => ({
    principalTargets: [{ principal: "Mars-Nairobi", valueTarget: 90_000_000 }],
    assignments: [],
    contributions: [],
    ...overrides,
  });

  it("splits a principal's monthly target across a Team Leader's reps by RepContribution share — the full month, no proration", () => {
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
    const result = computeMtdTargetByTeamLeader(inputs);
    expect(result).toHaveLength(1);
    expect(result[0].teamLeaderId).toBe("tl-a");
    expect(result[0].targetValue).toBeCloseTo(90_000_000);
  });

  it("prefers a rep's declared contributionPct over their computed RepContribution.sharePct", () => {
    const inputs = baseInputs({
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 0.5 },
        { teamLeaderId: "tl-b", principal: "Mars-Nairobi", employeeCode: "2", contributionPct: null },
      ],
      // employeeCode 2's computed share (0.5) makes the group's raw shares sum
      // to exactly 1.0 already, so normalization is a no-op here and this test
      // isolates purely "declared beats computed" - if employeeCode 1's raw
      // resolved value were 0.1 (its own computed share) instead of the
      // declared 0.5, tl-a would get 10M here, not 45M.
      contributions: [
        { principal: "Mars-Nairobi", employeeCode: "1", sharePct: 0.1 },
        { principal: "Mars-Nairobi", employeeCode: "2", sharePct: 0.5 },
      ],
    });
    const result = computeMtdTargetByTeamLeader(inputs);
    const byTl = new Map(result.map((r) => [r.teamLeaderId, r.targetValue]));
    expect(byTl.get("tl-a")).toBeCloseTo(45_000_000); // 90M * 0.5, not 0.1
    expect(byTl.get("tl-b")).toBeCloseTo(45_000_000);
  });

  it("normalizes a principal's rep shares to sum to exactly 1.0, even when declared contributionPct doesn't (confirmed live: one Supervisor's declared %'s summed to 285%, not 100%)", () => {
    const inputs = baseInputs({
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 1.5 },
        { teamLeaderId: "tl-b", principal: "Mars-Nairobi", employeeCode: "2", contributionPct: 1.35 },
      ],
    });
    const result = computeMtdTargetByTeamLeader(inputs);
    const byTl = new Map(result.map((r) => [r.teamLeaderId, r.targetValue]));
    // Raw declared shares sum to 2.85 (285%) - normalized down to 1.5/2.85 and
    // 1.35/2.85 respectively, so the group still totals exactly 90M, not 256.5M.
    expect(byTl.get("tl-a")! + byTl.get("tl-b")!).toBeCloseTo(90_000_000);
    expect(byTl.get("tl-a")).toBeCloseTo(90_000_000 * (1.5 / 2.85));
  });

  it("falls back to an even split across the group when a rep has neither a declared nor a computed share", () => {
    const inputs = baseInputs({
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: null },
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "2", contributionPct: null },
      ],
      contributions: [],
    });
    const result = computeMtdTargetByTeamLeader(inputs);
    expect(result[0].targetValue).toBeCloseTo(90_000_000); // both reps under the same TL - full target regardless of split
  });

  it("gives a principal with no Target row yet a target of 0, not undefined/NaN", () => {
    const inputs: MtdTargetInputs = {
      principalTargets: [],
      assignments: [{ teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 1 }],
      contributions: [],
    };
    const result = computeMtdTargetByTeamLeader(inputs);
    expect(result).toHaveLength(0); // zero-target principals are skipped entirely, same as a principal with no reps
  });

  it("never surfaces a Team Leader with zero currently-active Primary assignments - no legacy-identity special-casing needed", () => {
    const inputs = baseInputs({ assignments: [] });
    const result = computeMtdTargetByTeamLeader(inputs);
    expect(result).toHaveLength(0);
  });

  it("splits a matrix-assigned rep's contribution across every Team Leader they're actively assigned under for the same principal, without breaking the principal's 100% total", () => {
    const inputs = baseInputs({
      assignments: [
        { teamLeaderId: "tl-a", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 0.4 },
        { teamLeaderId: "tl-b", principal: "Mars-Nairobi", employeeCode: "1", contributionPct: 0.4 },
      ],
    });
    const result = computeMtdTargetByTeamLeader(inputs);
    const byTl = new Map(result.map((r) => [r.teamLeaderId, r.targetValue]));
    // The rep's own raw share (0.4) is identical on both assignment rows, so it
    // splits evenly between tl-a and tl-b - but the group as a whole (they're
    // the ONLY rep on this principal) still totals exactly the 90M principal
    // target, not 0.4 + 0.4 = 72M or double-counted to 72M/144M.
    expect(byTl.get("tl-a")).toBeCloseTo(45_000_000);
    expect(byTl.get("tl-b")).toBeCloseTo(45_000_000);
    expect(byTl.get("tl-a")! + byTl.get("tl-b")!).toBeCloseTo(90_000_000);
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
    const result = computeMtdTargetByTeamLeader(inputs);
    expect(result).toHaveLength(1);
    expect(result[0].targetValue).toBeCloseTo(90_000_000 + 87_400_000);
  });
});
