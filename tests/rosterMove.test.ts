import { describe, expect, it } from "vitest";
import { planTeamLeaderMove, type AssignmentRow } from "@/lib/rosterMove";

const a = (id: string, teamLeaderId: string, principal: string, active = true): AssignmentRow => ({ id, teamLeaderId, principal, active });

describe("planTeamLeaderMove", () => {
  it("moves the old home Team Leader's active assignments to the new one", () => {
    const steps = planTeamLeaderMove({
      assignments: [a("1", "lewis", "Mars-Nairobi"), a("2", "lewis", "EFL-Nairobi", false), a("3", "other", "Bidco-Nairobi")],
      fromTeamLeaderId: "lewis",
      toTeamLeaderId: "benson",
      absolutePrincipal: "Mars-Nairobi",
    });
    // The inactive row stays as history; the row under another Team Leader is a separate relationship and stays.
    expect(steps).toEqual([{ kind: "move", assignmentId: "1", principal: "Mars-Nairobi" }]);
  });

  it("reactivates the new Team Leader's existing row instead of duplicating it, and retires the old one", () => {
    const steps = planTeamLeaderMove({
      assignments: [a("1", "lewis", "Mars-Nairobi"), a("9", "benson", "Mars-Nairobi", false)],
      fromTeamLeaderId: "lewis",
      toTeamLeaderId: "benson",
      absolutePrincipal: "Mars-Nairobi",
    });
    expect(steps).toEqual([{ kind: "reactivate", keepId: "9", retireId: "1", principal: "Mars-Nairobi", keepWasActive: false }]);
  });

  it("creates an assignment for the absolute principal when nothing comes across", () => {
    const steps = planTeamLeaderMove({ assignments: [], fromTeamLeaderId: null, toTeamLeaderId: "benson", absolutePrincipal: "Mars-Nairobi" });
    expect(steps).toEqual([{ kind: "create", principal: "Mars-Nairobi" }]);
  });

  it("brings back a retired row for the absolute principal rather than creating a second one", () => {
    const steps = planTeamLeaderMove({ assignments: [a("9", "benson", "Mars-Nairobi", false)], fromTeamLeaderId: null, toTeamLeaderId: "benson", absolutePrincipal: "Mars-Nairobi" });
    expect(steps).toEqual([{ kind: "reactivate", keepId: "9", retireId: "", principal: "Mars-Nairobi", keepWasActive: false }]);
  });

  it("does nothing when the rep already sits under the Team Leader", () => {
    const steps = planTeamLeaderMove({ assignments: [a("1", "benson", "Mars-Nairobi")], fromTeamLeaderId: "benson", toTeamLeaderId: "benson", absolutePrincipal: "Mars-Nairobi" });
    expect(steps).toEqual([]);
  });
});
