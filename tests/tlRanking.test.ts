import { describe, it, expect } from "vitest";
import { buildTlRanking, buildSupervisorRanking, buildManagerRanking, type TlRankingRow } from "../lib/tlRanking";

const teamLeaders = [
  { id: "tl-josephat", name: "Josephat" },
  { id: "tl-emmy", name: "Emmy" },
];

describe("buildTlRanking", () => {
  it("attributes a principal's whole revenue to whoever heads it", () => {
    const result = buildTlRanking(
      [{ principal: "Bic-Nairobi", revenue: 100000 }],
      [{ principal: "Bic-Nairobi", teamLeaderId: "tl-josephat" }],
      teamLeaders,
      [{ teamLeaderId: "tl-josephat", targetValue: 50000 }]
    );
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].teamLeaderId).toBe("tl-josephat");
    expect(result.rankings[0].mtdRevenue).toBe(100000);
    expect(result.unattributedPrincipals).toHaveLength(0);
  });

  it("sums several principals headed by the same Team Leader (e.g. Josephat: Bic, Unilever, Ukl-Intl)", () => {
    const result = buildTlRanking(
      [
        { principal: "Bic-Nairobi", revenue: 20000 },
        { principal: "Unilever-Nairobi", revenue: 30000 },
        { principal: "Ukl-Intl-Nairobi", revenue: 40000 },
      ],
      [
        { principal: "Bic-Nairobi", teamLeaderId: "tl-josephat" },
        { principal: "Unilever-Nairobi", teamLeaderId: "tl-josephat" },
        { principal: "Ukl-Intl-Nairobi", teamLeaderId: "tl-josephat" },
      ],
      teamLeaders,
      []
    );
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].mtdRevenue).toBe(90000);
  });

  it("surfaces revenue from a principal with no active owner as unattributed, not silently dropped or misattributed", () => {
    const result = buildTlRanking([{ principal: "Bic-Nairobi", revenue: 20000 }], [], teamLeaders, []);
    expect(result.rankings).toHaveLength(0);
    expect(result.unattributedPrincipals).toEqual([{ principal: "Bic-Nairobi", revenue: 20000 }]);
  });

  it("attributes revenue from two principals whose SAP transactions share rep names to their correct, separate Team Leaders — no rep-name matching involved (confirmed live: 'Eabl Udv town NYH RT' shared by one of Erick's reps on EABL-Nyahururu and one of Richard's on EABL-Nyeri used to mis-split revenue between them under the old rep-name attribution)", () => {
    const result = buildTlRanking(
      [
        { principal: "EABL-Nyahururu", revenue: 400000 },
        { principal: "EABL-Nyeri", revenue: 900000 },
      ],
      [
        { principal: "EABL-Nyahururu", teamLeaderId: "tl-erick" },
        { principal: "EABL-Nyeri", teamLeaderId: "tl-richard" },
      ],
      teamLeaders,
      []
    );
    const erick = result.rankings.find((r) => r.teamLeaderId === "tl-erick")!;
    const richard = result.rankings.find((r) => r.teamLeaderId === "tl-richard")!;
    expect(erick.mtdRevenue).toBe(400000);
    expect(richard.mtdRevenue).toBe(900000);
    expect(result.unattributedPrincipals).toHaveLength(0);
  });

  it("computes achievedPct as revenue/target, null when target is 0", () => {
    const result = buildTlRanking(
      [{ principal: "Bic-Nairobi", revenue: 62700000 }],
      [{ principal: "Bic-Nairobi", teamLeaderId: "tl-josephat" }],
      teamLeaders,
      [{ teamLeaderId: "tl-josephat", targetValue: 62500000 }]
    );
    expect(result.rankings[0].achievedPct).toBeCloseTo(100.32, 1);
  });

  it("carries the full-month target alongside the (elapsed-days) MTD target", () => {
    const result = buildTlRanking(
      [{ principal: "Bic-Nairobi", revenue: 20000000 }],
      [{ principal: "Bic-Nairobi", teamLeaderId: "tl-josephat" }],
      teamLeaders,
      [{ teamLeaderId: "tl-josephat", targetValue: 20500000, monthlyTargetValue: 87400000 }]
    );
    expect(result.rankings[0].mtdTarget).toBe(20500000);
    expect(result.rankings[0].monthlyTarget).toBe(87400000);
  });

  it("sorts by achievedPct descending, unranked (no target) Team Leaders last", () => {
    const result = buildTlRanking(
      [
        { principal: "Bic-Nairobi", revenue: 41100000 },
        { principal: "Upfield-Nairobi", revenue: 62700000 },
      ],
      [
        { principal: "Bic-Nairobi", teamLeaderId: "tl-josephat" },
        { principal: "Upfield-Nairobi", teamLeaderId: "tl-emmy" },
      ],
      teamLeaders,
      [
        { teamLeaderId: "tl-josephat", targetValue: 51800000 }, // 79%
        { teamLeaderId: "tl-emmy", targetValue: 62500000 }, // 100%
      ]
    );
    expect(result.rankings.map((r) => r.teamLeaderId)).toEqual(["tl-emmy", "tl-josephat"]);
  });

  it("ignores zero-revenue principals rather than treating them as unattributed noise", () => {
    const result = buildTlRanking([{ principal: "Bic-Nairobi", revenue: 0 }], [], teamLeaders, []);
    expect(result.unattributedPrincipals).toHaveLength(0);
    expect(result.rankings).toHaveLength(0);
  });
});

function tlRow(teamLeaderId: string, teamLeaderName: string, mtdTarget: number, mtdRevenue: number, monthlyTarget: number = mtdTarget): TlRankingRow {
  return { teamLeaderId, teamLeaderName, mtdTarget, mtdRevenue, monthlyTarget, achievedPct: mtdTarget > 0 ? (mtdRevenue / mtdTarget) * 100 : null };
}

const supervisors = [
  { id: "sup-lucy", name: "Lucy Githinji" },
  { id: "sup-eve", name: "Eve" },
];
const managers = [{ id: "mgr-angela", name: "Angela Sitati" }];

describe("buildSupervisorRanking", () => {
  it("groups several Team Leaders under one Supervisor and sums their target/revenue, including the full-month target", () => {
    const tlRanking = [tlRow("tl-shekila", "Shekila Hassan", 100000, 90000, 400000), tlRow("tl-calvince", "Calvince Onditi", 50000, 60000, 200000)];
    const assignments = [
      { teamLeaderId: "tl-shekila", employeeName: "Rep A", sapName: null, principal: "Mars-Nairobi", active: true, supervisorId: "sup-lucy", managerId: "mgr-angela" },
      { teamLeaderId: "tl-calvince", employeeName: "Rep B", sapName: null, principal: "Mars-Nairobi", active: true, supervisorId: "sup-lucy", managerId: "mgr-angela" },
    ];
    const result = buildSupervisorRanking(tlRanking, assignments, supervisors);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].supervisorId).toBe("sup-lucy");
    expect(result.rankings[0].mtdTarget).toBe(150000);
    expect(result.rankings[0].mtdRevenue).toBe(150000);
    expect(result.rankings[0].monthlyTarget).toBe(600000); // 400K + 200K - ties out to the overall month target
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
  it("rolls several Supervisors up to one Manager, summing their target/revenue/monthlyTarget", () => {
    const tlRanking = [tlRow("tl-shekila", "Shekila Hassan", 100000, 120000, 300000), tlRow("tl-josephat", "Josephat", 50000, 40000, 150000)];
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
    expect(result.rankings[0].monthlyTarget).toBe(450000);
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
