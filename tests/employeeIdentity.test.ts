import { describe, it, expect } from "vitest";
import { codeLooksLikeName, findSameNameMatches, normalizePersonName, resolveHomeTeamLeaderId } from "../lib/employeeIdentity";

describe("resolveHomeTeamLeaderId", () => {
  it("resolves to the one Team Leader when exactly one distinct candidate exists", () => {
    expect(resolveHomeTeamLeaderId(["tl1"])).toBe("tl1");
  });

  it("returns null when a rep has no active assignment at all", () => {
    expect(resolveHomeTeamLeaderId([])).toBeNull();
  });

  it("returns null when a rep is genuinely under more than one Team Leader", () => {
    expect(resolveHomeTeamLeaderId(["tl1", "tl2"])).toBeNull();
  });
});

describe("spotting a stray duplicate roster record", () => {
  const teamLeaderNames = new Map([["tl-eva", "Eva Gachoki"]]);
  const roster = [
    { employeeCode: "1093", pineName: "Gloria Mutheu", sapName: "GLORIA MUTHEU", teamLeaderId: "tl-eva" },
    { employeeCode: "Gloria Mutheu", pineName: "Gloria Mutheu", sapName: "Gloria Mutheu", teamLeaderId: null },
    { employeeCode: "1181", pineName: "Isabellah Nderitu", sapName: "ISABELLAH NDERITU", teamLeaderId: "tl-eva" },
  ];

  it("treats a code holding a name as not a real roster code", () => {
    expect(codeLooksLikeName("Gloria Mutheu", "Gloria Mutheu")).toBe(true);
    expect(codeLooksLikeName("VAN 1 WEETABIX - KDL 904E", "VAN 1 WEETABIX - KDL 904E")).toBe(true);
    expect(codeLooksLikeName("1181", "Isabellah Nderitu")).toBe(false);
    expect(codeLooksLikeName("556", "FSR Test")).toBe(false);
  });

  it("normalizes case, punctuation and spacing", () => {
    expect(normalizePersonName("  GLORIA  Mutheu ")).toBe("gloria mutheu");
    expect(normalizePersonName("VAN 1 WEETABIX - KDL 904E")).toBe("van 1 weetabix kdl 904e");
  });

  it("finds the real, assigned rep behind a name-coded duplicate", () => {
    const matches = findSameNameMatches(roster[1], roster, teamLeaderNames);
    expect(matches).toEqual([{ employeeCode: "1093", pineName: "Gloria Mutheu", teamLeaderId: "tl-eva", teamLeaderName: "Eva Gachoki" }]);
  });

  it("never matches a record to itself, a different person, or on a single word", () => {
    expect(findSameNameMatches(roster[2], roster, teamLeaderNames)).toEqual([]);
    expect(findSameNameMatches({ employeeCode: "9", pineName: "Test", sapName: "Test" }, [{ employeeCode: "8", pineName: "Test", sapName: "Test", teamLeaderId: "tl-eva" }], teamLeaderNames)).toEqual([]);
  });
});
