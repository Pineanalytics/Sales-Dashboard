import { describe, expect, it } from "vitest";
import { buildCellInfo, buildLinkContext, buildProposals, nameSimilarity, proposeIdentity, suggestEmployees, type DirectoryIdentity, type RosterEmployeeLite, type StoredLink } from "@/lib/repLinkMatch";
import { normalizeRepName } from "@/lib/repDirectoryBuild";

const identity = (source: string, sourceKey: string, displayName: string, isActive = true): DirectoryIdentity => ({ source, sourceKey, displayName, normalizedName: normalizeRepName(displayName), isActive });
const employee = (employeeCode: string, pineName: string, sapName = pineName): RosterEmployeeLite => ({ employeeCode, pineName, sapName, active: true });
const link = (employeeCode: string, source: string, sourceKey: string): StoredLink => ({ employeeCode, source, sourceKey });

const IDENTITIES = [
  identity("SAP", "101", "Jane Wanjiru"),
  identity("SAP", "102", "Peter Kamau"),
  identity("SAP", "103", "Peter  KAMAU"), // same name as 102 once normalised: never guessed
  identity("PINE", "1249", "Robert Macharia"),
  identity("PINE", "2000", "Jane Wanjiru"),
];

describe("proposeIdentity", () => {
  it("matches SAP by exact normalised name, ignoring case, spacing and punctuation", () => {
    expect(proposeIdentity(employee("E1", "Jane W", "jane   wanjiru"), "SAP", IDENTITIES)?.sourceKey).toBe("101");
  });

  it("never guesses when a name matches two identities", () => {
    expect(proposeIdentity(employee("E2", "Peter Kamau"), "SAP", IDENTITIES)).toBeNull();
  });

  it("matches Pine by user id equal to the roster code before looking at names, then by exact name", () => {
    expect(proposeIdentity(employee("1249", "Someone Else"), "PINE", IDENTITIES)?.sourceKey).toBe("1249");
    expect(proposeIdentity(employee("X9", "Robert Macharia"), "PINE", IDENTITIES)?.sourceKey).toBe("1249");
    expect(proposeIdentity(employee("X9", "Nobody Known"), "PINE", IDENTITIES)).toBeNull();
  });

  it("returns nothing for an empty name", () => {
    expect(proposeIdentity(employee("E3", "  ", ""), "SAP", IDENTITIES)).toBeNull();
  });
});

describe("buildCellInfo", () => {
  const people = [employee("E1", "Jane Wanjiru"), employee("E4", "Jane Wanjiru (second code)", "Jane Wanjiru")];

  it("is linked when an explicit link exists, showing the identity's own spelling, and warns when another employee holds it", () => {
    const context = buildLinkContext("SAP", people, [link("E1", "SAP", "101"), link("E4", "SAP", "101")], IDENTITIES);
    const cell = buildCellInfo(people[0], "SAP", context);
    expect(cell).toMatchObject({ state: "linked", key: "101", name: "Jane Wanjiru", identityActive: true });
    expect(cell.sharedWith).toEqual([{ employeeCode: "E4", name: "Jane Wanjiru (second code)" }]);
  });

  it("is name-only when there is no link but exactly one identity matches, with the one-click proposal", () => {
    const context = buildLinkContext("SAP", people, [], IDENTITIES);
    expect(buildCellInfo(people[0], "SAP", context)).toMatchObject({ state: "name-only", key: null, proposal: { key: "101", name: "Jane Wanjiru" } });
  });

  it("is not linked when nothing matches, and keeps the roster's own text", () => {
    const context = buildLinkContext("SAP", [employee("E9", "Ghost", "Ghost Rep")], [], IDENTITIES);
    expect(buildCellInfo(employee("E9", "Ghost", "Ghost Rep"), "SAP", context)).toMatchObject({ state: "not-linked", name: "Ghost Rep", proposal: null });
  });

  it("stays linked, flagged inactive, when the identity has gone inactive in its source", () => {
    const gone = [identity("SAP", "101", "Jane Wanjiru", false)];
    const context = buildLinkContext("SAP", people, [link("E1", "SAP", "101")], gone);
    expect(buildCellInfo(people[0], "SAP", context)).toMatchObject({ state: "linked", identityActive: false });
  });

  it("only counts links of its own source", () => {
    const context = buildLinkContext("PINE", people, [link("E1", "SAP", "101")], IDENTITIES);
    expect(buildCellInfo(people[0], "PINE", context).state).toBe("name-only");
  });
});

describe("nameSimilarity and suggestions", () => {
  it("is 1 for the same words in any order, high for a left-out middle name, 0 for nothing in common", () => {
    expect(nameSimilarity("Macharia Robert", "robert macharia")).toBe(1);
    expect(nameSimilarity("Robert Macharia", "Robert Kimani Macharia")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("Robert Macharia", "Millian Chege")).toBe(0);
    expect(nameSimilarity("", "Robert")).toBe(0);
  });

  it("ranks the likeliest roster employees first and drops weak matches", () => {
    const roster = [employee("A", "Robert Macharia"), employee("B", "Robert Kimani Macharia"), employee("C", "Robert Otieno"), employee("D", "Millian Chege")];
    const suggestions = suggestEmployees("Macharia Robert", roster, 3, 0.6);
    expect(suggestions.map((s) => s.employeeCode)).toEqual(["A", "B"]);
  });

  it("also looks at the roster's SAP name", () => {
    expect(suggestEmployees("Peter Kamau", [employee("A", "P. Kamau Jr", "Peter Kamau")]).map((s) => s.employeeCode)).toEqual(["A"]);
  });
});

describe("buildProposals", () => {
  it("offers exact matches nobody else holds, and splits out the ones that need a person", () => {
    const people = [
      employee("E1", "Jane Wanjiru"), // SAP 101 free: proposal
      employee("E2", "Peter Kamau"), // SAP name matches two identities: no proposal at all
      employee("1249", "Robert Macharia"), // Pine id equals the code: proposal (code)
      employee("E5", "Jane Wanjiru"), // same SAP name as E1: both claim 101 in this pass: conflict
      employee("E6", "Held Elsewhere", "Jane Wanjiru"), // SAP 101 already linked to E7: conflict
      employee("E7", "Linked Already"),
    ];
    const links = [link("E7", "SAP", "101")];
    const { proposals, conflicts } = buildProposals(people, links, IDENTITIES);
    expect(proposals.map((p) => [p.employeeCode, p.source, p.sourceKey, p.basis])).toEqual([["1249", "PINE", "1249", "code"]]);
    const ofSap = conflicts.filter((c) => c.source === "SAP").map((c) => c.employeeCode).sort();
    expect(ofSap).toEqual(["E1", "E5", "E6"]);
    expect(conflicts.find((c) => c.employeeCode === "E6")?.heldBy).toEqual([{ employeeCode: "E7", name: "Linked Already" }]);
  });

  it("skips an employee who already has a link in that column", () => {
    const people = [employee("E1", "Jane Wanjiru")];
    const { proposals, conflicts } = buildProposals(people, [link("E1", "SAP", "101"), link("E1", "PINE", "2000")], IDENTITIES);
    expect(proposals).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("names a holder who is outside the list being offered", () => {
    const mine = [employee("E6", "Held Elsewhere", "Jane Wanjiru")];
    const everyone = [...mine, employee("E7", "Other TL's Rep")];
    const { conflicts } = buildProposals(mine, [link("E7", "SAP", "101")], IDENTITIES, everyone);
    expect(conflicts[0].heldBy).toEqual([{ employeeCode: "E7", name: "Other TL's Rep" }]);
  });
});
