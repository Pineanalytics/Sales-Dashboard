import { describe, expect, it } from "vitest";
import { deriveReportingHierarchy } from "../lib/reportingHierarchy";

describe("deriveReportingHierarchy", () => {
  it("uses real employee-code rows to resolve a reporting-line disagreement", () => {
    const links = deriveReportingHierarchy([
      { teamLeaderId: "tl-erick", supervisorId: "sup-erick", managerId: "mgr-angela", employeeCode: "Erick", employeeName: "Erick" },
      { teamLeaderId: "tl-erick", supervisorId: "sup-erick", managerId: "mgr-angela", employeeCode: "Erick", employeeName: "Erick" },
      { teamLeaderId: "tl-erick", supervisorId: "sup-erick", managerId: "mgr-alexander", employeeCode: "E123", employeeName: "Erick" },
      { teamLeaderId: "tl-shekila", supervisorId: "sup-lucy", managerId: "mgr-angela", employeeCode: "E456", employeeName: "Shekila Hassan" },
    ]);

    expect(links.teamLeaderToSupervisor).toEqual(
      expect.arrayContaining([
        { teamLeaderId: "tl-erick", supervisorId: "sup-erick" },
        { teamLeaderId: "tl-shekila", supervisorId: "sup-lucy" },
      ])
    );
    expect(links.supervisorToManager).toEqual(
      expect.arrayContaining([
        { supervisorId: "sup-erick", managerId: "mgr-alexander" },
        { supervisorId: "sup-lucy", managerId: "mgr-angela" },
      ])
    );
  });

  it("does not invent a reporting line when the assignment has none", () => {
    expect(
      deriveReportingHierarchy([{ teamLeaderId: "tl-christine", supervisorId: null, managerId: null, employeeCode: "E111", employeeName: "Christine" }])
    ).toEqual({ teamLeaderToSupervisor: [], supervisorToManager: [] });
  });
});
