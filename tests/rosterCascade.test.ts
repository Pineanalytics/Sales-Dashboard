import { describe, it, expect } from "vitest";
import { principalsForTeamLeader, assignmentsForTeamLeaderAndPrincipal, groupAssignmentsByEmployeeCode } from "../lib/rosterCascade";

const assignments = [
  { teamLeaderId: "tl1", principal: "Mars", employeeCode: "E001" },
  { teamLeaderId: "tl1", principal: "EABL", employeeCode: "E001" },
  { teamLeaderId: "tl1", principal: "Mars", employeeCode: "E002" },
  { teamLeaderId: "tl2", principal: "Mars", employeeCode: "E001" },
  { teamLeaderId: "tl2", principal: "Upfield", employeeCode: "E003" },
];

describe("principalsForTeamLeader", () => {
  it("returns only the distinct principals that Team Leader has an assignment under, sorted", () => {
    expect(principalsForTeamLeader(assignments, "tl1")).toEqual(["EABL", "Mars"]);
    expect(principalsForTeamLeader(assignments, "tl2")).toEqual(["Mars", "Upfield"]);
  });

  it("returns an empty array for a Team Leader with no assignments", () => {
    expect(principalsForTeamLeader(assignments, "tl-nobody")).toEqual([]);
  });
});

describe("assignmentsForTeamLeaderAndPrincipal", () => {
  it("narrows to exactly the rows for that Team Leader x Principal pair", () => {
    const rows = assignmentsForTeamLeaderAndPrincipal(assignments, "tl1", "Mars");
    expect(rows.map((r) => r.employeeCode)).toEqual(["E001", "E002"]);
  });

  it("does not cross-match the same principal under a different Team Leader", () => {
    const rows = assignmentsForTeamLeaderAndPrincipal(assignments, "tl2", "Mars");
    expect(rows.map((r) => r.employeeCode)).toEqual(["E001"]);
  });
});

describe("groupAssignmentsByEmployeeCode", () => {
  it("groups a rep's assignments across every Team Leader/Principal they're under", () => {
    const grouped = groupAssignmentsByEmployeeCode(assignments);
    expect(grouped.get("E001")).toHaveLength(3);
    expect(grouped.get("E002")).toHaveLength(1);
    expect(grouped.get("E003")).toHaveLength(1);
    expect(grouped.has("E999")).toBe(false);
  });
});
