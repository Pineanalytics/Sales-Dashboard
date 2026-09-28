import { describe, it, expect } from "vitest";
import { summarizeSupervisorPrincipalContribution } from "../lib/supervisorContribution";

const assignments = [
  { teamLeaderId: "tlA", supervisorId: "sup1", principal: "Mars-Nairobi", active: true, salesRole: "PRIMARY", contributionPct: 0.4 },
  { teamLeaderId: "tlB", supervisorId: "sup1", principal: "Mars-Nairobi", active: true, salesRole: "PRIMARY", contributionPct: 0.35 },
  { teamLeaderId: "tlC", supervisorId: "sup1", principal: "Mars-Nairobi", active: true, salesRole: "PRIMARY", contributionPct: 0.25 },
  // A Secondary row for the same group/principal — must not affect the total.
  { teamLeaderId: "tlA", supervisorId: "sup1", principal: "Mars-Nairobi", active: true, salesRole: "SECONDARY", contributionPct: 1 },
  // An inactive row — must not count.
  { teamLeaderId: "tlA", supervisorId: "sup1", principal: "Mars-Nairobi", active: false, salesRole: "PRIMARY", contributionPct: 0.5 },
  // A different principal under the same supervisor — must not leak in.
  { teamLeaderId: "tlA", supervisorId: "sup1", principal: "EABL", active: true, salesRole: "PRIMARY", contributionPct: 1 },
  // A different supervisor entirely — must not leak in.
  { teamLeaderId: "tlD", supervisorId: "sup2", principal: "Mars-Nairobi", active: true, salesRole: "PRIMARY", contributionPct: 1 },
];

describe("summarizeSupervisorPrincipalContribution", () => {
  it("sums each Team Leader's declared share within one Supervisor x Principal group", () => {
    const summary = summarizeSupervisorPrincipalContribution(assignments, "sup1", "Mars-Nairobi");
    expect(summary.shares).toEqual([
      { teamLeaderId: "tlA", totalPct: 0.4, repCount: 1, hasUndeclared: false },
      { teamLeaderId: "tlB", totalPct: 0.35, repCount: 1, hasUndeclared: false },
      { teamLeaderId: "tlC", totalPct: 0.25, repCount: 1, hasUndeclared: false },
    ]);
    expect(summary.totalPct).toBeCloseTo(1, 5);
    expect(summary.reconciled).toBe(true);
  });

  it("flags an undeclared share and a non-100% total as not reconciled", () => {
    const summary = summarizeSupervisorPrincipalContribution(
      [
        { teamLeaderId: "tlA", supervisorId: "sup1", principal: "Mars-Nairobi", active: true, salesRole: "PRIMARY", contributionPct: 0.4 },
        { teamLeaderId: "tlB", supervisorId: "sup1", principal: "Mars-Nairobi", active: true, salesRole: "PRIMARY", contributionPct: null },
      ],
      "sup1",
      "Mars-Nairobi"
    );
    expect(summary.shares.find((s) => s.teamLeaderId === "tlB")?.hasUndeclared).toBe(true);
    expect(summary.reconciled).toBe(false);
  });

  it("returns an empty summary for a Supervisor/Principal with no active PRIMARY reps", () => {
    const summary = summarizeSupervisorPrincipalContribution(assignments, "sup1", "Nonexistent");
    expect(summary.shares).toEqual([]);
    expect(summary.totalPct).toBe(0);
    expect(summary.reconciled).toBe(false);
  });
});
