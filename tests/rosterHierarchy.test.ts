import { describe, it, expect } from "vitest";
import { buildRosterHierarchy } from "../lib/rosterHierarchy";

describe("buildRosterHierarchy", () => {
  it("nests a full chain from Director down to Team Leader", () => {
    const hierarchy = buildRosterHierarchy(
      [{ id: "tl1", name: "Christine", supervisorId: "sup1" }],
      [{ id: "sup1", name: "Lucy", managerId: "mgr1" }],
      [{ id: "mgr1", name: "Peter", hodId: "hod1" }],
      [{ id: "hod1", name: "Susan", directorId: "dir1" }],
      [{ id: "dir1", name: "James" }]
    );

    expect(hierarchy.directors).toHaveLength(1);
    const [director] = hierarchy.directors;
    expect(director.hods).toHaveLength(1);
    expect(director.hods[0].managers).toHaveLength(1);
    expect(director.hods[0].managers[0].supervisors).toHaveLength(1);
    expect(director.hods[0].managers[0].supervisors[0].teamLeaders).toHaveLength(1);
    expect(director.hods[0].managers[0].supervisors[0].teamLeaders[0].name).toBe("Christine");
    expect(hierarchy.unassignedTeamLeaders).toHaveLength(0);
    expect(hierarchy.unassignedSupervisors).toHaveLength(0);
    expect(hierarchy.unassignedManagers).toHaveLength(0);
    expect(hierarchy.unassignedHods).toHaveLength(0);
  });

  it("surfaces a Team Leader with no Supervisor as unassigned instead of dropping it", () => {
    const hierarchy = buildRosterHierarchy(
      [{ id: "tl1", name: "Christine", supervisorId: null }],
      [],
      [],
      [],
      []
    );
    expect(hierarchy.unassignedTeamLeaders).toHaveLength(1);
    expect(hierarchy.unassignedTeamLeaders[0].name).toBe("Christine");
  });

  it("surfaces a dangling parent id (points at a Supervisor that no longer exists) as unassigned, not silently dropped", () => {
    const hierarchy = buildRosterHierarchy(
      [{ id: "tl1", name: "Christine", supervisorId: "does-not-exist" }],
      [{ id: "sup1", name: "Lucy", managerId: null }],
      [],
      [],
      []
    );
    expect(hierarchy.unassignedTeamLeaders).toHaveLength(1);
    // The orphaned reference must not appear under the unrelated real Supervisor either.
    expect(hierarchy.unassignedSupervisors[0].teamLeaders).toHaveLength(0);
  });

  it("keeps multiple Team Leaders under one Supervisor together", () => {
    const hierarchy = buildRosterHierarchy(
      [
        { id: "tl1", name: "Christine", supervisorId: "sup1" },
        { id: "tl2", name: "Brian", supervisorId: "sup1" },
      ],
      [{ id: "sup1", name: "Lucy", managerId: null }],
      [],
      [],
      []
    );
    expect(hierarchy.unassignedSupervisors).toHaveLength(1);
    expect(hierarchy.unassignedSupervisors[0].teamLeaders.map((tl) => tl.name).sort()).toEqual(["Brian", "Christine"]);
  });
});
