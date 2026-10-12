import { describe, it, expect } from "vitest";
import { computeSharePcts, computeWeekdayWeights, normalizeRepShares, pickTargetReps, resolveRepSharePct, spreadsAcrossWholeTeam, validateContributionTotals, weekdayDatesForWeek } from "../lib/repContribution";

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

describe("weekdayDatesForWeek", () => {
  const days = (start: string) => weekdayDatesForWeek(new Date(`${start}T00:00:00Z`)).map((d) => d.toISOString().slice(0, 10));
  const names = (start: string) => weekdayDatesForWeek(new Date(`${start}T00:00:00Z`)).map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]);

  it("spreads a Sunday-start week over Monday to Friday, not Sunday to Thursday", () => {
    expect(days("2026-10-04")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(names("2026-10-04")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  it("keeps a Monday-start (legacy) week as it is", () => {
    expect(names("2026-10-05")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(days("2026-10-05")[0]).toBe("2026-10-05");
  });

  it("crosses a month boundary", () => {
    expect(days("2026-03-29")).toEqual(["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03"]);
  });
});

describe("normalizeRepShares", () => {
  it("makes a leader's reps' shares add up to one, keeping their proportions", () => {
    const shares = normalizeRepShares([0.2, 0.1, 0.1]); // shares of the whole principal, only a part of it
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(shares[0]).toBeCloseTo(0.5, 10);
    expect(shares[1]).toBeCloseTo(0.25, 10);
  });

  it("leaves shares that already add up to one unchanged", () => {
    expect(normalizeRepShares([0.5, 0.3, 0.2])).toEqual([0.5, 0.3, 0.2].map((s) => s / 1));
  });

  it("splits evenly when no rep has a positive share, and ignores bad values", () => {
    expect(normalizeRepShares([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(normalizeRepShares([Number.NaN, -1])).toEqual([0.5, 0.5]);
    expect(normalizeRepShares([])).toEqual([]);
  });

  it("gives a lone rep the whole figure, however small their principal-level share", () => {
    expect(normalizeRepShares([0.23])).toEqual([1]);
  });
});

describe("whole-team spread (Mars)", () => {
  const rep = (salesRole: string, contributionPct: number | null) => ({ salesRole, contributionPct });

  it("applies to Mars only", () => {
    expect(spreadsAcrossWholeTeam("Mars-Nairobi")).toBe(true);
    expect(spreadsAcrossWholeTeam("Suntory-Nairobi")).toBe(false);
  });

  it("spreads a Mars leader's target over the SECONDARY field reps, not the PRIMARY van unit", () => {
    const van = rep("PRIMARY", 0.2);
    const a = rep("SECONDARY", 0.1);
    const b = rep("SECONDARY", 0.05);
    expect(pickTargetReps("Mars-Nairobi", [van, a, b])).toEqual([a, b]);
  });

  it("drops field reps with no declared share, and falls back to PRIMARY when none has one", () => {
    const van = rep("PRIMARY", 0.2);
    expect(pickTargetReps("Mars-Nairobi", [van, rep("SECONDARY", 0), rep("SECONDARY", null)])).toEqual([van]);
    expect(pickTargetReps("Mars-Nairobi", [van])).toEqual([van]);
  });

  it("leaves every other principal on its PRIMARY reps", () => {
    const p = rep("PRIMARY", 0.5);
    expect(pickTargetReps("Suntory-Nairobi", [p, rep("SECONDARY", 0.3)])).toEqual([p]);
  });
});
