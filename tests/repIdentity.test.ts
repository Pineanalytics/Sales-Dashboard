import { describe, expect, it } from "vitest";
import { buildRepDirectory, repKey } from "../lib/outletUniverse/repIdentity";

const resolve = buildRepDirectory({
  employees: [
    { employeeCode: "1177", pineName: "Agnes Chelangat", sapName: "Agnes Chelangat", absolutePrincipal: "Mars-Nairobi", teamLeader: "Calvince Onditi" },
    { employeeCode: "1188", pineName: "Kelly Kiprotich", sapName: "Kelly Kiprotich", absolutePrincipal: "Weetabix-Nairobi", teamLeader: "Eve Theuri" },
    { employeeCode: "1300", pineName: "Solo Rep", sapName: "Solo Rep", absolutePrincipal: "Mars-Nairobi", teamLeader: "Home Leader" },
  ],
  assignments: [
    { employeeCode: "1177", employeeName: "Agnes Chelangat", sapName: "Agnes Chelangat", principal: "Mars-Nairobi", teamLeader: "Zachary Mwangi", contributionPct: null },
    { employeeCode: "1188", employeeName: "Kelly Kiprotich", sapName: "Kelly Kiprotich", principal: "Weetabix-Nairobi", teamLeader: "Eve Theuri", contributionPct: 0.5 },
    { employeeCode: "1188", employeeName: "Kelly Kiprotich", sapName: "Kelly Kiprotich", principal: "Weetabix-Nairobi", teamLeader: "Second Leader", contributionPct: 0.2 },
    { employeeCode: "PFL004", employeeName: "Counter Nyeri", sapName: "Eabl warehouse counter", principal: "EABL-Nyeri", teamLeader: "Richard", contributionPct: 0.04 },
    { employeeCode: "VAN_A2_OB", employeeName: "GILTON KAGEMA", sapName: "NY_VAN_A2_OB_18058585", principal: "Unilever-Nyeri", teamLeader: "Sarah", contributionPct: null },
  ],
  upfieldLogins: [{ fsrName: "Adrian Omondi", fsrLogin: "Faith.Pinefrost" }],
});

const withHomeLeader = buildRepDirectory({
  employees: [{ employeeCode: "PFL099", pineName: "Nyeri Rep Based In Nyahururu", sapName: null, absolutePrincipal: "EABL-Nyeri", teamLeader: "Richard" }],
  assignments: [
    { employeeCode: "PFL004", employeeName: "Counter Nyeri", sapName: null, principal: "EABL-Nyeri", teamLeader: "Richard", contributionPct: 0.04 },
    { employeeCode: "PFL050", employeeName: "Nyahururu Van", sapName: null, principal: "EABL-Nyahururu", teamLeader: "Erick", contributionPct: 0.2 },
    { employeeCode: "M1", employeeName: "Mars One", sapName: null, principal: "Mars-Nairobi", teamLeader: "Lead A", contributionPct: null },
    { employeeCode: "M2", employeeName: "Mars Two", sapName: null, principal: "Mars-Nairobi", teamLeader: "Lead B", contributionPct: null },
  ],
  upfieldLogins: [],
});

describe("rep key", () => {
  it("ignores case, spacing, punctuation and a Leverage distributor suffix", () => {
    expect(repKey("  Daniel   Odula ")).toBe("daniel odula");
    expect(repKey("NY_VAN_A2_OB_18058585")).toBe("ny van a2 ob");
    expect(repKey("NY_VAN_A2_OB")).toBe("ny van a2 ob");
    expect(repKey(null)).toBe("");
  });
});

describe("rep SFA ID and Team Leader", () => {
  it("gives a Pine rep their roster code and the Team Leader of their assignment to that principal", () => {
    expect(resolve("PINE", "Mars-Nairobi", "AGNES  chelangat", null)).toEqual({ repCode: "1177", teamLeader: "Zachary Mwangi" });
  });

  it("puts every Team Leader of a rep on the principal, the larger share first", () => {
    expect(resolve("PINE", "Weetabix-Nairobi", "Kelly Kiprotich", null)).toEqual({ repCode: "1188", teamLeader: "Eve Theuri / Second Leader" });
  });

  it("falls back to the employee master's Team Leader when the rep has no assignment to the principal", () => {
    expect(resolve("PINE", "Energia-Nairobi", "Solo Rep", null)).toEqual({ repCode: "1300", teamLeader: "Home Leader" });
  });

  it("keeps the code the system supplied when the rep is not on the roster, and leaves the Team Leader blank", () => {
    expect(resolve("PINE", "Energia-Nairobi", "Unknown Van", "E9")).toEqual({ repCode: "E9", teamLeader: null });
    expect(resolve("PINE", "Energia-Nairobi", null, null)).toEqual({ repCode: null, teamLeader: null });
  });

  it("keeps Leverage's Centegy rep code and finds the Team Leader of its unit through the SAP name", () => {
    expect(resolve("LEVERAGE", "Unilever-Nyeri", "NY_VAN_A2_OB", "YA3")).toEqual({ repCode: "YA3", teamLeader: "Sarah" });
  });

  it("gives an EABL salesman the roster code", () => {
    expect(resolve("EABL", "EABL-Nyeri", "Counter Nyeri", null)).toEqual({ repCode: "PFL004", teamLeader: "Richard" });
  });

  it("gives an Upfield FSR the DataEdge login", () => {
    expect(resolve("UPFIELD", "Upfield-Nairobi", "Adrian Omondi", null).repCode).toBe("Faith.Pinefrost");
  });
});

describe("the principal's own Team Leader", () => {
  it("gives a rep who is not on the roster the Team Leader of the principal when the whole principal has one", () => {
    expect(withHomeLeader("EABL", "EABL-Nyahururu", "Ambrose Mwenda", null).teamLeader).toBe("Erick");
    expect(withHomeLeader("EABL", "EABL-Nyeri", "Vivian Muchiri", null).teamLeader).toBe("Richard");
  });

  it("puts a rep who sells a principal in another region under that principal's Team Leader, not their home one", () => {
    expect(withHomeLeader("EABL", "EABL-Nyahururu", "Nyeri Rep Based In Nyahururu", null).teamLeader).toBe("Erick");
  });

  it("gives an outlet with no rep named the principal's Team Leader", () => {
    expect(withHomeLeader("EABL", "EABL-Nyeri", null, null).teamLeader).toBe("Richard");
  });

  it("does not guess for a principal with several Team Leaders", () => {
    expect(withHomeLeader("PINE", "Mars-Nairobi", "Unrostered Rep", null).teamLeader).toBeNull();
  });
});

describe("principals fixed to one Team Leader", () => {
  it("puts every Suntory rep under Eve and every Bic rep under Nickley, whatever the roster assigns", () => {
    const fixed = buildRepDirectory({
      employees: [],
      assignments: [
        { employeeCode: "1", employeeName: "Suntory Rep", sapName: null, principal: "Suntory-Nairobi", teamLeader: "Eva Gachoki", contributionPct: 0.3 },
        { employeeCode: "2", employeeName: "Bic Rep", sapName: null, principal: "Bic-Nairobi", teamLeader: "Eve Theuri", contributionPct: 0.3 },
        { employeeCode: "3", employeeName: "Bic Other", sapName: null, principal: "Bic-Nairobi", teamLeader: "Lydiah John", contributionPct: 0.3 },
      ],
      upfieldLogins: [],
    });
    expect(fixed("PINE", "Suntory-Nairobi", "Suntory Rep", null).teamLeader).toBe("Eve Theuri");
    expect(fixed("PINE", "Suntory-Nairobi", "Not On Roster", null).teamLeader).toBe("Eve Theuri");
    expect(fixed("PINE", "Suntory-Nairobi", null, null).teamLeader).toBe("Eve Theuri");
    expect(fixed("PINE", "Bic-Nairobi", "Bic Rep", null).teamLeader).toBe("Nickley");
    expect(fixed("PINE", "Bic-Nairobi", "Bic Other", null).teamLeader).toBe("Nickley");
  });
});
