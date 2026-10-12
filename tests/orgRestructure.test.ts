import { describe, expect, it } from "vitest";
import { MARS_LOCATION_OWNER, REAL_TEAM_LEADERS, SUPERVISOR_DIRECT_TEAMS, marsOwnerForLocation, planAssignmentMoves, type AssignmentLite } from "../lib/orgRestructure";
import { directTeamNamesFromRows, groupTeamLeadersByKind, isRealTeamLeader, normalizeTeamLeaderKind, teamLeaderDisplayName } from "../lib/teamLeaderKind";

const a = (id: string, teamLeaderId: string, employeeCode: string, principal = "Mars-Nairobi"): AssignmentLite => ({ id, teamLeaderId, employeeCode, principal, active: true });

describe("Mars territories", () => {
  it("maps each Mars KPI location to its team leader", () => {
    expect(marsOwnerForLocation("Nairobi Lower")).toEqual({ kind: "TEAM_LEADER", name: "Zachary Mwangi" });
    expect(marsOwnerForLocation("Nairobi Metro")).toEqual({ kind: "TEAM_LEADER", name: "Lewis Muthomi" });
    expect(marsOwnerForLocation("Nairobi South")).toEqual({ kind: "TEAM_LEADER", name: "Benson Mbivi" });
    expect(marsOwnerForLocation("Lower Eastern")).toEqual({ kind: "TEAM_LEADER", name: "Christine Mweni" });
    expect(marsOwnerForLocation("Upper Eastern")).toEqual({ kind: "TEAM_LEADER", name: "Shekila Hassan" });
    expect(marsOwnerForLocation("Central")).toEqual({ kind: "TEAM_LEADER", name: "Lydiah John" });
  });

  it("puts key accounts on the supervisor's own team and ignores unknown locations", () => {
    expect(marsOwnerForLocation("KAM")).toEqual({ kind: "DIRECT" });
    expect(marsOwnerForLocation(" KAM ")).toEqual({ kind: "DIRECT" });
    expect(marsOwnerForLocation("Mombasa")).toBeNull();
    expect(marsOwnerForLocation(null)).toBeNull();
  });

  it("only names team leaders that the structure lists", () => {
    const real = new Set(REAL_TEAM_LEADERS.map((t) => t.name));
    for (const name of Object.values(MARS_LOCATION_OWNER)) expect(real.has(name)).toBe(true);
    // a supervisor's stand-in is never also a team leader
    for (const name of SUPERVISOR_DIRECT_TEAMS) expect(real.has(name)).toBe(false);
  });
});

describe("planAssignmentMoves", () => {
  const owners: Record<string, string> = { R1: "zachary", R2: "lewis", R3: "benson", R4: "zachary" };
  const ownerOf = (code: string) => owners[code] ?? null;

  it("moves each rep to the team leader that owns them", () => {
    const rows = [a("1", "calvince", "R1"), a("2", "benson", "R2"), a("3", "benson", "R3")];
    const plan = planAssignmentMoves(rows, ownerOf);
    expect(plan.moves).toEqual([{ id: "1", toTeamLeaderId: "zachary" }, { id: "2", toTeamLeaderId: "lewis" }]);
    expect(plan.unchanged).toBe(1); // R3 is already Benson's
  });

  it("leaves a rep whose owner is not known where they are", () => {
    const plan = planAssignmentMoves([a("1", "calvince", "NOBODY")], ownerOf);
    expect(plan).toMatchObject({ moves: [], unmapped: 1 });
  });

  it("does not force a move onto a row that already exists", () => {
    const rows = [a("1", "calvince", "R1"), a("9", "zachary", "R1")];
    const plan = planAssignmentMoves([rows[0]], ownerOf, rows);
    expect(plan.moves).toEqual([]);
    expect(plan.duplicates).toEqual([{ id: "1" }]);
  });

  it("treats the same rep on a different principal as a separate row", () => {
    const rows = [a("1", "calvince", "R1", "Mars-Nairobi"), a("9", "zachary", "R1", "Bic-Nairobi")];
    const plan = planAssignmentMoves([rows[0]], ownerOf, rows);
    expect(plan.moves).toEqual([{ id: "1", toTeamLeaderId: "zachary" }]);
  });

  it("does not move two copies of the same assignment onto one row", () => {
    const plan = planAssignmentMoves([a("1", "calvince", "R1"), a("2", "benson", "R1")], ownerOf);
    expect(plan.moves).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
  });
});

describe("directTeamNamesFromRows (the importer's guard)", () => {
  it("flags a team leader named like the supervisor on every row, ignoring case and spacing", () => {
    const rows = [
      { teamLeader: "Nickley", supervisor: "NICKLEY" },
      { teamLeader: "Nickley", supervisor: "Nickley " },
      { teamLeader: "Benson Mbivi", supervisor: "Lucy" },
      { teamLeader: "Emmy", supervisor: "Emmy" },
    ];
    expect([...directTeamNamesFromRows(rows)].sort()).toEqual(["Emmy", "Nickley"]);
  });

  it("does not flag a real team leader, one with any row under a different supervisor, or one with no supervisor", () => {
    expect([...directTeamNamesFromRows([{ teamLeader: "Erick", supervisor: "Erick" }, { teamLeader: "Erick", supervisor: "Alexander Muhoro" }])]).toEqual([]);
    expect([...directTeamNamesFromRows([{ teamLeader: "Zachary", supervisor: null }])]).toEqual([]);
  });
});

describe("team leader display", () => {
  it("says when a row is a supervisor's direct team or a leaver", () => {
    expect(teamLeaderDisplayName({ name: "Nickley", kind: "SUPERVISOR_TEAM" })).toBe("Nickley (supervisor's direct team)");
    expect(teamLeaderDisplayName({ name: "Josephat", kind: "FORMER" })).toBe("Josephat (former)");
    expect(teamLeaderDisplayName({ name: "Benson Mbivi", kind: "TEAM_LEADER" })).toBe("Benson Mbivi");
    expect(teamLeaderDisplayName({ name: "Old row" })).toBe("Old row");
  });
});

describe("team leader kinds", () => {
  it("treats a missing or unknown kind as a real team leader", () => {
    expect(normalizeTeamLeaderKind(undefined)).toBe("TEAM_LEADER");
    expect(normalizeTeamLeaderKind("nonsense")).toBe("TEAM_LEADER");
    expect(isRealTeamLeader(null)).toBe(true);
    expect(isRealTeamLeader("SUPERVISOR_TEAM")).toBe(false);
    expect(isRealTeamLeader("FORMER")).toBe(false);
  });

  it("groups for a dropdown: leaders, direct teams, and former only on request", () => {
    const list = [{ name: "Benson", kind: "TEAM_LEADER" }, { name: "Nickley", kind: "SUPERVISOR_TEAM" }, { name: "Josephat", kind: "FORMER" }, { name: "Old row" }];
    const grouped = groupTeamLeadersByKind(list);
    expect(grouped.teamLeaders.map((t) => t.name)).toEqual(["Benson", "Old row"]);
    expect(grouped.directTeams.map((t) => t.name)).toEqual(["Nickley"]);
    expect(grouped.former).toEqual([]);
    expect(groupTeamLeadersByKind(list, { includeFormer: true }).former.map((t) => t.name)).toEqual(["Josephat"]);
  });
});
