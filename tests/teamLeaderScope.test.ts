import { describe, expect, it } from "vitest";
import { teamLeaderSupervisesName } from "@/lib/teamLeaderScope";

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
