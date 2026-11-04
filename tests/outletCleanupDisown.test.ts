import { describe, expect, it } from "vitest";
import { describeDisownedRows, disownBlocker, filingTeamLeader, planDisown, type DisownRow } from "../lib/outletCleanup/disown";
import type { CleanupActor } from "../lib/outletCleanup/types";

const OTHER_TEAMS = ["Eve Theuri", "John Kamau", "Grace Wanjiru"];
const actor = (over: Partial<CleanupActor> = {}): CleanupActor => ({ email: "tl@x.test", role: "TEAM_LEADER", isAdmin: false, canReview: true, canSeeAll: false, teamLeaders: ["Mary Achieng"], displayName: "Mary Achieng", ...over });
const row = (over: Partial<DisownRow> = {}): DisownRow => ({ principal: "Mars-Nairobi", repName: "Jane", teamLeader: "Mary Achieng", editable: true, ...over });

describe("planDisown", () => {
  it("needs a reason of a few words", () => {
    const plan = planDisown({ reason: "no", candidates: ["Eve Theuri"] }, OTHER_TEAMS);
    expect(plan).toMatchObject({ ok: false, fields: [{ field: "reason" }] });
  });

  it("keeps only team leaders from the offered list, matched ignoring case and without repeats", () => {
    const plan = planDisown({ reason: "Sells in Eve's area", candidates: ["eve theuri", "Eve Theuri", "Nobody Known"] }, OTHER_TEAMS);
    expect(plan).toEqual({ ok: true, reason: "Sells in Eve's area", candidates: ["Eve Theuri"], ownerUnknown: false });
  });

  it("refuses an outlet with neither a possible owner nor the owner declared unknown", () => {
    const plan = planDisown({ reason: "Not on my route", candidates: ["Nobody Known"] }, OTHER_TEAMS);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain("declare the owner unknown");
  });

  it("accepts the owner declared unknown with no team leaders", () => {
    expect(planDisown({ reason: "Cannot tell whose it is", candidates: [], ownerUnknown: true }, OTHER_TEAMS)).toEqual({ ok: true, reason: "Cannot tell whose it is", candidates: [], ownerUnknown: true });
  });

  it("does not take unknown together with named owners", () => {
    const plan = planDisown({ reason: "Cannot tell whose it is", candidates: ["Eve Theuri"], ownerUnknown: true }, OTHER_TEAMS);
    expect(plan).toMatchObject({ ok: false, fields: [{ field: "candidates" }] });
  });
});

describe("what a disowned outlet is filed under", () => {
  it("files a team leader's outlet under their own team", () => {
    expect(filingTeamLeader(actor(), [row({ teamLeader: "Eve Theuri", editable: false }), row()])).toBe("Mary Achieng");
  });

  it("files a supervisor's or admin's outlet under the first team of theirs that sells it, else their own name", () => {
    const supervisor = actor({ role: "SUPERVISOR", teamLeaders: ["Mary Achieng", "John Kamau"], displayName: "Sam Otieno" });
    expect(filingTeamLeader(supervisor, [row({ teamLeader: "Eve Theuri", editable: false }), row({ teamLeader: "John Kamau" })])).toBe("John Kamau");
    expect(filingTeamLeader(supervisor, [row({ teamLeader: null })])).toBe("Sam Otieno");
  });

  it("lists the principals once and the reps who sold them", () => {
    expect(describeDisownedRows([row(), row({ principal: "Mars-Nairobi", repName: "Jane" }), row({ principal: "Bidco", repName: null })])).toEqual({ principals: "Mars-Nairobi, Bidco", previousReps: "Mars-Nairobi: Jane; Mars-Nairobi: Jane" });
  });
});

describe("which outlets can be disowned", () => {
  it("lets a person disown an outlet with a row on their team", () => {
    expect(disownBlocker({ rows: [row()], alreadyOpen: false })).toBeNull();
  });

  it("blocks an outlet that is unknown or out of scope, already open, or has no row on the person's team", () => {
    expect(disownBlocker(undefined)).toBe("Not one of your outlets.");
    expect(disownBlocker({ rows: [row()], alreadyOpen: true })).toBe("Already marked open.");
    expect(disownBlocker({ rows: [row({ editable: false })], alreadyOpen: false })).toBe("Not on your team.");
  });
});
