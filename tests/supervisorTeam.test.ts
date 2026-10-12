import { describe, expect, it } from "vitest";
import { buildTeamBreakdown, supervisorTeamRows, type RosterRow } from "../lib/supervisorTeam";

const roster: RosterRow[] = [
  { id: "lucy", name: "Lucy", kind: "SUPERVISOR_TEAM", supervisorId: "S-lucy" },
  { id: "benson", name: "Benson Mbivi", kind: "TEAM_LEADER", supervisorId: "S-lucy" },
  { id: "christine", name: "Christine Mweni", kind: "TEAM_LEADER", supervisorId: "S-lucy" },
  { id: "clarrine", name: "Clarrine Wahome", kind: "KEY_ACCOUNTS", supervisorId: "S-lucy" },
  { id: "erick", name: "Erick", kind: "TEAM_LEADER", supervisorId: "S-erick" },
  { id: "eve", name: "Eve Theuri", kind: "SUPERVISOR_TEAM", supervisorId: "S-eve" },
];

describe("supervisorTeamRows", () => {
  it("groups a supervisor's own row with the leaders under her and skips supervisors with no leaders", () => {
    const teams = supervisorTeamRows(roster);
    expect(teams.get("lucy")).toEqual(["lucy", "benson", "christine", "clarrine"]);
    expect(teams.has("eve")).toBe(false);
    expect(teams.has("erick")).toBe(false);
  });
});

describe("buildTeamBreakdown", () => {
  const weekStarts = ["2026-10-04", "2026-10-11"];
  const w = (teamLeaderId: string, weekStart: string, targetValue: number) => ({ teamLeaderId, principal: "Mars-Nairobi", weekStart, targetValue });
  const input = {
    memberIds: ["lucy", "benson", "christine", "clarrine"],
    roster,
    supervisorRowId: "lucy",
    weekStarts,
    weekly: [
      w("benson", weekStarts[0], 100),
      w("benson", weekStarts[1], 100),
      w("christine", weekStarts[0], 300),
      w("christine", weekStarts[1], 300),
      w("clarrine", weekStarts[0], 50),
      w("clarrine", weekStarts[1], 50),
    ],
    reps: [
      { teamLeaderId: "benson", principal: "Mars-Nairobi", employeeCode: "V1", employeeName: "Van Mars Nai South", channel: "Van", contributionPct: 0.12 },
      { teamLeaderId: "christine", principal: "Mars-Nairobi", employeeCode: "V2", employeeName: "Van Mars Lower Eastern", channel: "Van", contributionPct: 0.22 },
      { teamLeaderId: "clarrine", principal: "Mars-Nairobi", employeeCode: "K1", employeeName: "Clarrine Wahome", channel: "KA", contributionPct: 0.04 },
    ],
    daily: [{ teamLeaderId: "benson", principal: "Mars-Nairobi", employeeCode: "V1", total: 190 }],
  };

  it("adds the team up to the supervisor's whole target, with each member's share", () => {
    const [mars] = buildTeamBreakdown(input);
    expect(mars.total).toBe(900);
    expect(mars.weekTotals).toEqual([450, 450]);
    expect(mars.members.map((m) => [m.label, m.total])).toEqual([
      ["Christine Mweni", 600],
      ["Benson Mbivi", 200],
      ["Clarrine Wahome", 100],
    ]);
    expect(mars.members.reduce((s, m) => s + m.sharePct, 0)).toBeCloseTo(1, 10);
  });

  it("lists the key-accounts rep after the leaders, and each leader's reps with their daily total", () => {
    const [mars] = buildTeamBreakdown(input);
    const last = mars.members[mars.members.length - 1];
    expect(last.role).toBe("Key accounts");
    expect(last.label).toBe("Clarrine Wahome");
    expect(mars.members.some((m) => m.teamLeaderId === "lucy")).toBe(false);
    expect(mars.members.find((m) => m.teamLeaderId === "benson")?.reps[0]).toMatchObject({ employeeName: "Van Mars Nai South", monthDailyTotal: 190 });
  });

  it("leaves out a member with no target and no reps on the principal", () => {
    const [mars] = buildTeamBreakdown({ ...input, memberIds: [...input.memberIds, "erick"] });
    expect(mars.members.some((m) => m.teamLeaderId === "erick")).toBe(false);
  });
});
