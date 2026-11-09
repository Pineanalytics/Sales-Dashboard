import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { restrictToPrincipal, scopeNameClause, teamLeaderSupervisesName, UPFIELD_PRINCIPAL, type TeamLeaderScope } from "@/lib/teamLeaderScope";

describe("teamLeaderSupervisesName", () => {
  it("matches a short TeamLeader name against the Roster's full Supervisor name", () => {
    expect(teamLeaderSupervisesName("Lucy", "Lucy Githinji")).toBe(true);
  });

  it("matches when both sides are already the same full name", () => {
    expect(teamLeaderSupervisesName("Calvince Onditi", "Calvince Onditi")).toBe(true);
  });

  it("does not confuse two people with similar but distinct first names", () => {
    expect(teamLeaderSupervisesName("Eve", "Eva Gachoki")).toBe(false);
  });

  it("does not match unrelated names", () => {
    expect(teamLeaderSupervisesName("Richard", "Lucy Githinji")).toBe(false);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(teamLeaderSupervisesName("  lucy  ", "LUCY GITHINJI")).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(teamLeaderSupervisesName("", "Lucy Githinji")).toBe(false);
    expect(teamLeaderSupervisesName("Lucy", "")).toBe(false);
  });
});

describe("restrictToPrincipal", () => {
  const scope = (principals: string[]): TeamLeaderScope => ({ teamLeaderId: null, supervisorId: "s1", teamLeaderIds: ["t1"], principals, employeeCodes: ["1013"], normalizedNames: new Set(["joel weru"]) });

  it("leaves an unrestricted session alone", () => {
    expect(restrictToPrincipal(null, UPFIELD_PRINCIPAL)).toBeNull();
  });

  it("keeps the scope for a session that has an Upfield principal", () => {
    const s = scope(["Suntory-Nairobi", "Upfield-Nairobi"]);
    expect(restrictToPrincipal(s, UPFIELD_PRINCIPAL)).toBe(s);
  });

  it("leaves a Suntory-only session with no reps, so Upfield rows are filtered out, even for a rep it shares with Upfield", () => {
    const restricted = restrictToPrincipal(scope(["Suntory-Nairobi"]), UPFIELD_PRINCIPAL);
    expect(restricted?.normalizedNames.size).toBe(0);
    expect(restricted?.employeeCodes).toEqual([]);
    expect(restricted?.principals).toEqual(["Suntory-Nairobi"]);
    expect(scopeNameClause(restricted, Prisma.sql`fsr`).sql).toContain("false");
  });
});
