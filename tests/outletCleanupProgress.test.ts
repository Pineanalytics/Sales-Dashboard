import { describe, expect, it } from "vitest";
import { pct, rankTeams, type RawTeamCounts } from "../lib/outletCleanup/progressRank";

const team = (teamLeader: string, outlets: number, reviewed: number): RawTeamCounts => ({ teamLeader, outlets, reviewed, validated: 0, missingGeo: 0, geoTagged: 0, repsValidated: 0, disowned: 0, active: outlets, dormant: 0 });

describe("cleanup ranking", () => {
  it("ranks on the share of the target reached, then on outlets reviewed", () => {
    const teams = rankTeams([team("A", 100, 50), team("B", 400, 200), team("C", 100, 80), team("D", 10, 0)], { defaultPct: 100, byTeam: new Map() });
    expect(teams.map((t) => t.teamLeader)).toEqual(["C", "B", "A", "D"]); // B and A are both at 50%: B has cleaned more outlets
    expect(teams.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
    expect(teams[0]).toMatchObject({ pctReviewed: 80, targetPct: 100, attainment: 80 });
  });

  it("measures against each team leader's own target and caps the share at 100%", () => {
    const teams = rankTeams([team("A", 100, 40), team("B", 100, 60)], { defaultPct: 50, byTeam: new Map([["a", 40]]) });
    const a = teams.find((t) => t.teamLeader === "A");
    const b = teams.find((t) => t.teamLeader === "B");
    expect(a).toMatchObject({ targetPct: 40, attainment: 100 });
    expect(b).toMatchObject({ targetPct: 50, attainment: 100 });
    // both reached their target: the one with more outlets reviewed leads
    expect(teams[0].teamLeader).toBe("B");
  });

  it("gives equal teams the same rank and handles a team with no outlets", () => {
    const teams = rankTeams([team("A", 10, 5), team("B", 10, 5), team("C", 0, 0)], { defaultPct: 100, byTeam: new Map() });
    expect(teams.map((t) => t.rank)).toEqual([1, 1, 3]);
    expect(pct(0, 0)).toBe(0);
  });

  it("matches a team leader's target whatever the spacing or case of the name", () => {
    const teams = rankTeams([team("Eve  Theuri", 100, 50)], { defaultPct: 100, byTeam: new Map([["eve theuri", 50]]) });
    expect(teams[0].targetPct).toBe(50);
  });
});
