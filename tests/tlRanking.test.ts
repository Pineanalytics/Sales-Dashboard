import { describe, it, expect } from "vitest";
import { buildTlRanking, buildSupervisorRanking, buildManagerRanking, type TlRankingRow } from "../lib/tlRanking";

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

function tlRow(teamLeaderId: string, teamLeaderName: string, mtdTarget: number, mtdRevenue: number): TlRankingRow {
  return { teamLeaderId, teamLeaderName, mtdTarget, mtdRevenue, achievedPct: mtdTarget > 0 ? (mtdRevenue / mtdTarget) * 100 : null };
}

const supervisors = [
  { id: "sup-lucy", name: "Lucy Githinji" },
  { id: "sup-eve", name: "Eve" },
];
const managers = [{ id: "mgr-angela", name: "Angela Sitati" }];

describe("buildSupervisorRanking", () => {
  it("groups several Team Leaders under one Supervisor and sums their target/revenue", () => {
    const tlRanking = [tlRow("tl-shekila", "Shekila Hassan", 100000, 90000), tlRow("tl-calvince", "Calvince Onditi", 50000, 60000)];
    const assignments = [
      { teamLeaderId: "tl-shekila", employeeName: "Rep A", sapName: null, principal: "Mars-Nairobi", active: true, supervisorId: "sup-lucy", managerId: "mgr-angela" },
      { teamLeaderId: "tl-calvince", employeeName: "Rep B", sapName: null, principal: "Mars-Nairobi", active: true, supervisorId: "sup-lucy", managerId: "mgr-angela" },
    ];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].supervisorId).toBe("sup-lucy");
    expect(result.rankings[0].mtdTarget).toBe(150000);
    expect(result.rankings[0].mtdRevenue).toBe(150000);
    expect(result.rankings[0].teamLeaders.map((tl) => tl.teamLeaderId)).toEqual(["tl-calvince", "tl-shekila"]); // best (120%) before worst (90%)
    expect(result.unassignedTeamLeaders).toHaveLength(0);
  });

  it("puts a Team Leader with no resolvable Supervisor into unassignedTeamLeaders", () => {
    const tlRanking = [tlRow("tl-orphan", "Orphan TL", 10000, 5000)];
    // Has a real, active team behind it - a genuine gap, not a stale identity.
    const assignments = [{ teamLeaderId: "tl-orphan", employeeName: "Rep A", sapName: null, principal: "P", active: true, supervisorId: null, managerId: null }];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings).toHaveLength(0);
    expect(result.unassignedTeamLeaders).toHaveLength(1);
    expect(result.unassignedTeamLeaders[0].teamLeaderId).toBe("tl-orphan");
  });

  it("ranks Supervisors best-to-worst by achievedPct", () => {
    const tlRanking = [tlRow("tl-a", "A", 100000, 50000), tlRow("tl-b", "B", 100000, 90000)];
    const assignments = [
      { teamLeaderId: "tl-a", employeeName: "Rep A", sapName: null, principal: "P", active: true, supervisorId: "sup-lucy", managerId: null },
      { teamLeaderId: "tl-b", employeeName: "Rep B", sapName: null, principal: "P", active: true, supervisorId: "sup-eve", managerId: null },
    ];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings.map((r) => r.supervisorId)).toEqual(["sup-eve", "sup-lucy"]);
  });

  it("ignores inactive assignments when resolving a Team Leader's Supervisor, and drops the Team Leader entirely since it has no active team left (same as a fully-replaced legacy identity)", () => {
    const tlRanking = [tlRow("tl-a", "A", 100000, 50000)];
    const assignments = [{ teamLeaderId: "tl-a", employeeName: "Rep A", sapName: null, principal: "P", active: false, supervisorId: "sup-lucy", managerId: null }];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings).toHaveLength(0);
    expect(result.unassignedTeamLeaders).toHaveLength(0);
  });

  it("falls back to fuzzy name-matching a legacy Team Leader with no roster-linked Supervisor (e.g. old monolithic 'Lucy' vs 'Lucy Githinji')", () => {
    const tlRanking = [tlRow("tl-legacy-lucy", "Lucy", 90000000, 16000000), tlRow("tl-shekila", "Shekila Hassan", 100000, 90000)];
    const assignments = [{ teamLeaderId: "tl-shekila", employeeName: "Rep A", sapName: null, principal: "Mars-Nairobi", active: true, supervisorId: "sup-lucy", managerId: null }];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.unassignedTeamLeaders).toHaveLength(0);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].supervisorId).toBe("sup-lucy");
    expect(result.rankings[0].mtdTarget).toBe(90100000);
    expect(result.rankings[0].teamLeaders.map((tl) => tl.teamLeaderId)).toContain("tl-legacy-lucy");
  });

  it("leaves a genuinely unrelated stray Team Leader name unassigned rather than guessing, as long as it still has an active team behind it", () => {
    const tlRanking = [tlRow("tl-christine", "Christine", 5000000, 0)];
    const assignments = [{ teamLeaderId: "tl-christine", employeeName: "Rep A", sapName: null, principal: "P", active: true, supervisorId: null, managerId: null }];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings).toHaveLength(0);
    expect(result.unassignedTeamLeaders).toHaveLength(1);
  });

  it("does not fuzzy-match when the name is ambiguous across more than one Supervisor", () => {
    const ambiguousSupervisors = [{ id: "sup-e1", name: "Eve" }, { id: "sup-e2", name: "Eve Njoroge" }];
    const tlRanking = [tlRow("tl-eve", "Eve", 1000, 500)];
    const assignments = [{ teamLeaderId: "tl-eve", employeeName: "Rep A", sapName: null, principal: "P", active: true, supervisorId: null, managerId: null }];
    const result = buildSupervisorRanking(tlRanking, assignments, ambiguousSupervisors);
    expect(result.rankings).toHaveLength(0);
    expect(result.unassignedTeamLeaders).toHaveLength(1);
  });

  it("drops a Team Leader with zero active assignments and no fuzzy match entirely, rather than flagging it as needing a Supervisor (confirmed live: 'Christine,' fully replaced by 'Eve,' whose assignments are already deactivated)", () => {
    const tlRanking = [tlRow("tl-christine", "Christine", 48700000, 0)];
    // Christine's own assignments are all inactive (replaced by Eve) - no active row for her teamLeaderId at all.
    const assignments = [{ teamLeaderId: "tl-christine", employeeName: "Rep A", sapName: null, principal: "Suntory-Nairobi", active: false, supervisorId: null, managerId: null }];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings).toHaveLength(0);
    expect(result.unassignedTeamLeaders).toHaveLength(0); // dropped, not surfaced as unassigned
  });

  it("keeps a Team Leader with a real active team but no resolvable Supervisor in unassignedTeamLeaders (a genuine, actionable gap)", () => {
    const tlRanking = [tlRow("tl-newbie", "Newly Added TL", 1000000, 500000)];
    const assignments = [{ teamLeaderId: "tl-newbie", employeeName: "Rep A", sapName: null, principal: "P", active: true, supervisorId: null, managerId: null }];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings).toHaveLength(0);
    expect(result.unassignedTeamLeaders).toHaveLength(1);
  });
});

describe("buildManagerRanking", () => {
  it("rolls several Supervisors up to one Manager, summing their target/revenue", () => {
    const tlRanking = [tlRow("tl-shekila", "Shekila Hassan", 100000, 120000), tlRow("tl-josephat", "Josephat", 50000, 40000)];
    const assignments = [
      { teamLeaderId: "tl-shekila", employeeName: "Rep A", sapName: null, principal: "Mars-Nairobi", active: true, supervisorId: "sup-lucy", managerId: "mgr-angela" },
      { teamLeaderId: "tl-josephat", employeeName: "Rep B", sapName: null, principal: "Bic-Nairobi", active: true, supervisorId: "sup-eve", managerId: "mgr-angela" },
    ];
    const supervisorRanking = buildSupervisorRanking(tlRanking, assignments, supervisors);
    const result = buildManagerRanking(supervisorRanking.rankings, assignments, managers);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].managerId).toBe("mgr-angela");
    expect(result.rankings[0].mtdTarget).toBe(150000);
    expect(result.rankings[0].mtdRevenue).toBe(160000);
    expect(result.rankings[0].supervisors).toHaveLength(2);
  });

  it("puts a Supervisor with no resolvable Manager into unassignedSupervisors", () => {
    const tlRanking = [tlRow("tl-a", "A", 100000, 50000)];
    const assignments = [{ teamLeaderId: "tl-a", employeeName: "Rep A", sapName: null, principal: "P", active: true, supervisorId: "sup-lucy", managerId: null }];
    const supervisorRanking = buildSupervisorRanking(tlRanking, assignments, supervisors);
    const result = buildManagerRanking(supervisorRanking.rankings, assignments, managers);
    expect(result.rankings).toHaveLength(0);
    expect(result.unassignedSupervisors).toHaveLength(1);
    expect(result.unassignedSupervisors[0].supervisorId).toBe("sup-lucy");
  });

  it("resolves Manager via any nested Team Leader, not just the first (sorted-by-achievement) one", () => {
    // tl-legacy (fuzzy-merged, no assignment row) sorts first on achievedPct; only
    // tl-shekila carries a real managerId - buildManagerRanking must still find it.
    const tlRanking = [tlRow("tl-legacy", "Lucy", 100, 1000), tlRow("tl-shekila", "Shekila Hassan", 100000, 50000)];
    const assignments = [{ teamLeaderId: "tl-shekila", employeeName: "Rep A", sapName: null, principal: "Mars-Nairobi", active: true, supervisorId: "sup-lucy", managerId: "mgr-angela" }];
    const supervisorRanking = buildSupervisorRanking(tlRanking, assignments, supervisors);
    const result = buildManagerRanking(supervisorRanking.rankings, assignments, managers);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].managerId).toBe("mgr-angela");
  });

  it("falls back to fuzzy name-matching a Supervisor with no roster-linked Manager", () => {
    const tlRanking = [tlRow("tl-a", "A", 100000, 50000)];
    const assignments = [{ teamLeaderId: "tl-a", employeeName: "Rep A", sapName: null, principal: "P", active: true, supervisorId: "sup-eve", managerId: null }];
    const supervisorRanking = buildSupervisorRanking(tlRanking, assignments, [{ id: "sup-eve", name: "Eve" }]);
    const result = buildManagerRanking(supervisorRanking.rankings, assignments, [{ id: "mgr-eve-full", name: "Eve Wanjiru" }]);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].managerId).toBe("mgr-eve-full");
  });
});
