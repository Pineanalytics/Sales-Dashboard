import { describe, it, expect } from "vitest";
import { computeSharePcts, computeWeekdayWeights, resolveRepSharePct, validateContributionTotals } from "../lib/repContribution";

// Primary-only filtering itself (recomputeRepContribution/recomputeDailyTargets's
// `salesRole: "PRIMARY"` where clause) lives in DB-backed async functions this
// suite doesn't mock a Prisma client for — covered instead by the deploy
// verification's row-count sanity check. These tests cover the pure math those
// functions build on, previously entirely untested despite driving every rep's
// Weekly->Daily target split.

describe("computeSharePcts", () => {
  it("splits proportional to revenue when the group has positive revenue", () => {
    const shares = computeSharePcts(new Map([["a", 300], ["b", 700]]));
    expect(shares.get("a")).toBeCloseTo(0.3);
    expect(shares.get("b")).toBeCloseTo(0.7);
  });

  it("falls back to an even split when every rep is at zero revenue", () => {
    const shares = computeSharePcts(new Map([["a", 0], ["b", 0], ["c", 0]]));
    expect(shares.get("a")).toBeCloseTo(1 / 3);
    expect(shares.get("b")).toBeCloseTo(1 / 3);
    expect(shares.get("c")).toBeCloseTo(1 / 3);
  });

  it("floors negative revenue at zero rather than producing a negative share", () => {
    const shares = computeSharePcts(new Map([["a", -500], ["b", 1000]]));
    expect(shares.get("a")).toBe(0);
    expect(shares.get("b")).toBe(1);
  });
});

describe("resolveRepSharePct", () => {
  it("prefers the admin-declared Contribution % over the computed share", () => {
    expect(resolveRepSharePct(0.4, 0.55, 0.5)).toBe(0.4);
  });

  it("falls back to the computed share when nothing is declared", () => {
    expect(resolveRepSharePct(null, 0.55, 0.5)).toBe(0.55);
  });

  it("falls back to an even split when neither declared nor computed exists", () => {
    expect(resolveRepSharePct(null, undefined, 0.25)).toBe(0.25);
  });
});

describe("validateContributionTotals", () => {
  it("flags a Principal whose declared %s don't sum to ~100%", () => {
    const warnings = validateContributionTotals([
      { principal: "Mars-Nairobi", active: true, contributionPct: 0.5, salesRole: "PRIMARY" },
      { principal: "Mars-Nairobi", active: true, contributionPct: 0.3, salesRole: "PRIMARY" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].principal).toBe("Mars-Nairobi");
    expect(warnings[0].totalPct).toBeCloseTo(80);
  });

  it("doesn't flag a Principal that sums to 100% within tolerance", () => {
    const warnings = validateContributionTotals([
      { principal: "Bic-Nairobi", active: true, contributionPct: 0.6, salesRole: "PRIMARY" },
      { principal: "Bic-Nairobi", active: true, contributionPct: 0.4, salesRole: "PRIMARY" },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("skips a Principal still mid-setup (any active Primary rep with no declared %)", () => {
    const warnings = validateContributionTotals([
      { principal: "Upfield-Nairobi", active: true, contributionPct: 0.5, salesRole: "PRIMARY" },
      { principal: "Upfield-Nairobi", active: true, contributionPct: null, salesRole: "PRIMARY" },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("ignores inactive assignments", () => {
    const warnings = validateContributionTotals([
      { principal: "Tropikal-Nairobi", active: true, contributionPct: 0.5, salesRole: "PRIMARY" },
      { principal: "Tropikal-Nairobi", active: false, contributionPct: 0.9, salesRole: "PRIMARY" },
    ]);
    expect(warnings).toHaveLength(1); // 50% active-only total, not diluted by the inactive row
    expect(warnings[0].totalPct).toBeCloseTo(50);
  });

  it("ignores Secondary reps entirely, even when their declared %s alone would fail the check (confirmed live: Mars-Nairobi's 7 Primary reps summed to 99%, its 84 Secondary reps summed separately to 102% - combined, that read as a bogus 201%)", () => {
    const warnings = validateContributionTotals([
      { principal: "Mars-Nairobi", active: true, contributionPct: 0.5, salesRole: "PRIMARY" },
      { principal: "Mars-Nairobi", active: true, contributionPct: 0.5, salesRole: "PRIMARY" },
      { principal: "Mars-Nairobi", active: true, contributionPct: 0.9, salesRole: "SECONDARY" },
      { principal: "Mars-Nairobi", active: true, contributionPct: 0.9, salesRole: "SECONDARY" },
    ]);
    expect(warnings).toHaveLength(0); // Primary alone sums to exactly 100%
  });
});

describe("computeWeekdayWeights", () => {
  it("uses Layer 1 (Detail) counts once they clear the minimum threshold", () => {
    const weights = computeWeekdayWeights([2, 1, 1, 0, 1], [10, 10, 10, 10, 10]);
    const total = 2 + 1 + 1 + 0 + 1;
    expect(weights).toEqual([2 / total, 1 / total, 1 / total, 0, 1 / total]);
  });

  it("falls back to Layer 2 (Daily) counts when Detail is too thin", () => {
    const weights = computeWeekdayWeights([1, 0, 0, 0, 0], [4, 4, 4, 4, 4]);
    expect(weights).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
  });

  it("falls back to an even split when neither source has any history", () => {
    expect(computeWeekdayWeights([0, 0, 0, 0, 0], [0, 0, 0, 0, 0])).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
  });
});
