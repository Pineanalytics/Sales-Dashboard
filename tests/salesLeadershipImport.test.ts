import { describe, it, expect } from "vitest";
import { parseSalesLeadershipSourceRows, splitPrincipalName, SalesLeadershipParseError } from "../lib/salesLeadershipImport";

describe("splitPrincipalName", () => {
  it("splits a plain <Brand>-<Location> name on the last hyphen", () => {
    expect(splitPrincipalName("Bic-Nairobi")).toEqual({ mainPrincipal: "Bic", location: "Nairobi" });
    expect(splitPrincipalName("Unilever-Nyeri")).toEqual({ mainPrincipal: "Unilever", location: "Nyeri" });
  });

  it("keeps a hyphenated brand name intact by splitting on the LAST hyphen", () => {
    expect(splitPrincipalName("Ukl-Intl-Nairobi")).toEqual({ mainPrincipal: "Ukl-Intl", location: "Nairobi" });
  });

  it("falls back to the whole string for both fields when there's no hyphen to split on", () => {
    expect(splitPrincipalName("Bidco")).toEqual({ mainPrincipal: "Bidco", location: "Bidco" });
  });
});

describe("parseSalesLeadershipSourceRows", () => {
  const rows = [
    {
      Principal: "Upfield-Nairobi",
      "Sales Supervisor": "Emmy",
      "Sales Supervisor Email": "emily.mbithe@pinefrost.co.ke",
      "Team Leader": "Emmy",
      "Team Leader Email": "emily.mbithe@pinefrost.co.ke",
      "Head Of Sales": "Angela Sitati",
      "Head Of Sales Email": "angela.sitati@pinefrost.co.ke",
    },
    {
      Principal: "Mars-Nairobi",
      "Sales Supervisor": "Lucy",
      "Team Leader": "Benson Mbivi",
      "Head Of Sales": "Angela Sitati",
    },
    {
      Principal: "Mars-Nairobi",
      "Sales Supervisor": "Lucy",
      "Team Leader": "Shekila Hassan",
      "Head Of Sales": "Angela Sitati",
    },
  ];

  it("parses the four org-chart columns plus the Sales Supervisor/Team Leader email columns", () => {
    const parsed = parseSalesLeadershipSourceRows(rows, 2);
    expect(parsed).toEqual([
      {
        principal: "Upfield-Nairobi",
        supervisorName: "Emmy",
        supervisorEmail: "emily.mbithe@pinefrost.co.ke",
        teamLeaderName: "Emmy",
        teamLeaderEmail: "emily.mbithe@pinefrost.co.ke",
        hodName: "Angela Sitati",
      },
      {
        principal: "Mars-Nairobi",
        supervisorName: "Lucy",
        supervisorEmail: null,
        teamLeaderName: "Benson Mbivi",
        teamLeaderEmail: null,
        hodName: "Angela Sitati",
      },
      {
        principal: "Mars-Nairobi",
        supervisorName: "Lucy",
        supervisorEmail: null,
        teamLeaderName: "Shekila Hassan",
        teamLeaderEmail: null,
        hodName: "Angela Sitati",
      },
    ]);
  });

  it("lowercases the email columns for case-insensitive matching", () => {
    const parsed = parseSalesLeadershipSourceRows(
      [{ ...rows[0], "Sales Supervisor Email": "Emily.Mbithe@Pinefrost.co.ke" }],
      2
    );
    expect(parsed[0].supervisorEmail).toBe("emily.mbithe@pinefrost.co.ke");
  });

  it("keeps a self-represented row (same name as Supervisor and Team Leader) as-is, no special-casing", () => {
    const parsed = parseSalesLeadershipSourceRows(rows, 2);
    expect(parsed[0].supervisorName).toBe(parsed[0].teamLeaderName);
  });

  it("skips a row with no Principal", () => {
    const parsed = parseSalesLeadershipSourceRows([...rows, { Principal: "", "Sales Supervisor": "X", "Team Leader": "Y", "Head Of Sales": "Z" }], 2);
    expect(parsed).toHaveLength(3);
  });

  it("throws on a row missing a required column", () => {
    expect(() =>
      parseSalesLeadershipSourceRows([{ Principal: "Bidco-Nairobi", "Sales Supervisor": "Eva", "Team Leader": "Eva" }], 2)
    ).toThrow(SalesLeadershipParseError);
  });
});
