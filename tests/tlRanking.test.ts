import { describe, it, expect } from "vitest";
import { buildTlRanking } from "../lib/tlRanking";

const teamLeaders = [
  { id: "tl-josephat", name: "Josephat" },
  { id: "tl-emmy", name: "Emmy" },
];

describe("buildTlRanking", () => {
  it("matches a rep by sapName over employeeName when both exist", () => {
    const result = buildTlRanking(
      [{ salesEmployee: "J. Angela N.", revenue: 100000 }],
      [{ teamLeaderId: "tl-josephat", employeeName: "Angela Ngina", sapName: "J. Angela N.", principal: "Bic-Nairobi", active: true }],
      teamLeaders,
      [{ teamLeaderId: "tl-josephat", targetValue: 50000 }],
      null
    );
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].teamLeaderId).toBe("tl-josephat");
    expect(result.rankings[0].mtdRevenue).toBe(100000);
    expect(result.unmatchedReps).toHaveLength(0);
  });

  it("falls back to employeeName when sapName isn't declared", () => {
    const result = buildTlRanking(
      [{ salesEmployee: "Angela Ngina", revenue: 50000 }],
      [{ teamLeaderId: "tl-josephat", employeeName: "Angela Ngina", sapName: null, principal: "Bic-Nairobi", active: true }],
      teamLeaders,
      [],
      null
    );
    expect(result.rankings[0].mtdRevenue).toBe(50000);
    expect(result.unmatchedReps).toHaveLength(0);
  });

  it("surfaces revenue from a rep with no matching assignment as unmatched, not silently dropped or misattributed", () => {
    const result = buildTlRanking(
      [{ salesEmployee: "Ghost Rep", revenue: 20000 }],
      [{ teamLeaderId: "tl-josephat", employeeName: "Angela Ngina", sapName: null, principal: "Bic-Nairobi", active: true }],
      teamLeaders,
      [],
      null
    );
    expect(result.rankings).toHaveLength(0);
    expect(result.unmatchedReps).toEqual([{ salesEmployee: "Ghost Rep", revenue: 20000 }]);
  });

  it("ignores inactive assignments entirely", () => {
    const result = buildTlRanking(
      [{ salesEmployee: "Angela Ngina", revenue: 50000 }],
      [{ teamLeaderId: "tl-josephat", employeeName: "Angela Ngina", sapName: null, principal: "Bic-Nairobi", active: false }],
      teamLeaders,
      [],
      null
    );
    expect(result.unmatchedReps).toHaveLength(1);
  });

  it("prefers the assignment matching the selected Principal when a rep has multiple", () => {
    const result = buildTlRanking(
      [{ salesEmployee: "Angela Ngina", revenue: 30000 }],
      [
        { teamLeaderId: "tl-josephat", employeeName: "Angela Ngina", sapName: null, principal: "Bic-Nairobi", active: true },
        { teamLeaderId: "tl-emmy", employeeName: "Angela Ngina", sapName: null, principal: "Upfield-Nairobi", active: true },
      ],
      teamLeaders,
      [],
      "Upfield-Nairobi"
    );
    expect(result.rankings[0].teamLeaderId).toBe("tl-emmy");
  });

  it("computes achievedPct as revenue/target, null when target is 0", () => {
    const result = buildTlRanking(
      [{ salesEmployee: "Angela Ngina", revenue: 62700000 }],
      [{ teamLeaderId: "tl-josephat", employeeName: "Angela Ngina", sapName: null, principal: "Bic-Nairobi", active: true }],
      teamLeaders,
      [{ teamLeaderId: "tl-josephat", targetValue: 62500000 }],
      null
    );
    expect(result.rankings[0].achievedPct).toBeCloseTo(100.32, 1);
  });

  it("sorts by achievedPct descending, unranked (no target) Team Leaders last", () => {
    const result = buildTlRanking(
      [
        { salesEmployee: "Angela Ngina", revenue: 41100000 },
        { salesEmployee: "Emmy Rep", revenue: 62700000 },
      ],
      [
        { teamLeaderId: "tl-josephat", employeeName: "Angela Ngina", sapName: null, principal: "Bic-Nairobi", active: true },
        { teamLeaderId: "tl-emmy", employeeName: "Emmy Rep", sapName: null, principal: "Bic-Nairobi", active: true },
      ],
      teamLeaders,
      [
        { teamLeaderId: "tl-josephat", targetValue: 51800000 }, // 79%
        { teamLeaderId: "tl-emmy", targetValue: 62500000 }, // 100%
      ],
      null
    );
    expect(result.rankings.map((r) => r.teamLeaderId)).toEqual(["tl-emmy", "tl-josephat"]);
  });

  it("ignores zero-revenue reps rather than treating them as unmatched noise", () => {
    const result = buildTlRanking(
      [{ salesEmployee: "Ghost Rep", revenue: 0 }],
      [],
      teamLeaders,
      [],
      null
    );
    expect(result.unmatchedReps).toHaveLength(0);
    expect(result.rankings).toHaveLength(0);
  });
});
