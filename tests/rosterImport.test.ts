import { describe, it, expect } from "vitest";
import { detectRosterFormat, parseRosterSourceRows, RosterParseError, isRosterRow } from "../lib/rosterImport";

describe("detectRosterFormat", () => {
  it("detects V21 from the presence of Active (Y/N)", () => {
    expect(detectRosterFormat(["Employee Code", "Active (Y/N)", "Sales Role"])).toBe("V21");
  });

  it("detects V18 from the presence of Sales Supervisor", () => {
    expect(detectRosterFormat(["Employee Code", "Sales Supervisor", "Manager"])).toBe("V18");
  });

  it("throws when neither marker column is present", () => {
    expect(() => detectRosterFormat(["Employee Code", "Sales Role"])).toThrow(RosterParseError);
  });

  it("throws when both marker columns are present (ambiguous)", () => {
    expect(() => detectRosterFormat(["Employee Code", "Active (Y/N)", "Sales Supervisor"])).toThrow(RosterParseError);
  });
});

describe("parseRosterSourceRows", () => {
  const v18Row = {
    "Employee Code": "575",
    "Employee (Sales Edge Name)": "Van Mars Lower Eastern",
    "SAP Name": null,
    Channel: "Van",
    "Work Group": "DSR",
    "Sales Point": "Van ",
    "Team Leader": "Shekila Hassan",
    Principal: "Mars-Nairobi",
    "Absolute Principal": "Mars-Nairobi",
    "* Contribution %": 0.288438374,
    "Stock Point": "KD",
    "Cost Center": "Mars",
    "Sales Role": "Primary",
    Region: "Eastern",
    "Sub Region": "Lower Eastern",
    "Sales Supervisor": "Lucy Githinji",
    Manager: "Angela Sitati",
    Route: "Lower Eastern",
  };

  it("parses a V18 row with active defaulting true and the 5 V21-only fields null", () => {
    const [row] = parseRosterSourceRows([v18Row], 2, "V18");
    expect(row.employeeCode).toBe("575");
    expect(row.teamLeaderName).toBe("Shekila Hassan");
    expect(row.salesRole).toBe("PRIMARY");
    expect(row.active).toBe(true);
    expect(row.company).toBeNull();
    expect(row.costCenterCount).toBeNull();
    expect(row.location).toBeNull();
    expect(row.sourceContributionPct).toBeNull();
    expect(row.supervisor).toBeNull(); // legacy field, V18 doesn't populate it
    expect(row.supervisorName).toBe("Lucy Githinji");
    expect(row.managerName).toBe("Angela Sitati");
    expect(row.stockPoint).toBe("KD");
  });

  it("normalizes a title-case Sales Role and Secondary rows correctly", () => {
    const [row] = parseRosterSourceRows([{ ...v18Row, "Sales Role": "Secondary" }], 2, "V18");
    expect(row.salesRole).toBe("SECONDARY");
  });

  it("parses a V21 row with supervisorName/managerName/stockPoint null", () => {
    const v21Row = {
      "Employee Code": "832",
      "Employee (Sales Edge Name)": "Nickson Wanyonyi",
      "SAP Name": "Nickson Wanyonyi",
      Channel: "KA",
      "Team Leader": "Josephat",
      Principal: "Bic-Nairobi",
      "* Contribution %": 0.41236274,
      "Active (Y/N)": "Y",
      "Sales Role": "Primary",
      Company: null,
      "Cost Center": "Bic",
      "Absolute Principal": "Suntory-Nairobi",
      "Work Group": "KAMs",
      Region: "Nairobi",
      "Sub Region": "Nairobi Metro",
      Supervisor: null,
      "Cost Center Count": null,
      "Sales Point": "Key Accounts Rep",
      Route: "Nairobi Metro",
      Location: null,
      "Source Contribution %": null,
    };
    const [row] = parseRosterSourceRows([v21Row], 4, "V21");
    expect(row.active).toBe(true);
    expect(row.supervisorName).toBeNull();
    expect(row.managerName).toBeNull();
    expect(row.stockPoint).toBeNull();
  });

  it("throws RosterParseError on an unrecognized Sales Role", () => {
    expect(() => parseRosterSourceRows([{ ...v18Row, "Sales Role": "Tertiary" }], 2, "V18")).toThrow(RosterParseError);
  });

  it("throws RosterParseError on a missing required column", () => {
    const { "Team Leader": _omit, ...withoutTeamLeader } = v18Row;
    void _omit;
    expect(() => parseRosterSourceRows([withoutTeamLeader], 2, "V18")).toThrow(RosterParseError);
  });
});

describe("isRosterRow", () => {
  const validRow = {
    employeeCode: "575",
    employeeName: "Van Mars Lower Eastern",
    sapName: null,
    channel: "Van",
    teamLeaderName: "Shekila Hassan",
    principal: "Mars-Nairobi",
    contributionPct: 0.288438374,
    active: true,
    salesRole: "PRIMARY" as const,
    company: null,
    costCenter: "Mars",
    absolutePrincipal: "Mars-Nairobi",
    workGroup: "DSR",
    region: "Eastern",
    subRegion: "Lower Eastern",
    supervisor: null,
    costCenterCount: null,
    salesPoint: "Van",
    route: "Lower Eastern",
    location: null,
    sourceContributionPct: null,
    stockPoint: "KD",
    supervisorName: "Lucy Githinji",
    managerName: "Angela Sitati",
  };

  it("accepts a fully-populated row", () => {
    expect(isRosterRow(validRow)).toBe(true);
  });

  it("rejects a row missing the V18-only fields entirely (not just null)", () => {
    const { stockPoint: _s, supervisorName: _sn, managerName: _mn, ...withoutV18Fields } = validRow;
    void _s;
    void _sn;
    void _mn;
    expect(isRosterRow(withoutV18Fields)).toBe(false);
  });

  it("rejects an invalid salesRole", () => {
    expect(isRosterRow({ ...validRow, salesRole: "TERTIARY" })).toBe(false);
  });
});
