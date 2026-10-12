import { describe, expect, it } from "vitest";
import { canonicalWeeks, planWeeklyRebuild, type Recipient, type WeeklyRow, rollUpToSupervisorRows } from "../lib/weeklyRebuild";

let seq = 0;
function row(teamLeaderId: string, principal: string, start: string, value: number, over: Partial<WeeklyRow> = {}): WeeklyRow {
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(start.slice(5, 7)) - 1];
  return { id: `w${++seq}`, teamLeaderId, principal, monthLabel: month, weekLabel: `${month.slice(0, 3)} Week ?`, start, value, ...over };
}

const sunday = (start: string, teamLeaderId: string, principal: string, value: number) => {
  const week = canonicalWeeks(2026).find((w) => w.start === start)!;
  return row(teamLeaderId, principal, start, value, { monthLabel: week.month, weekLabel: week.label });
};

describe("canonicalWeeks", () => {
  it("lists the 52 Sunday-start weeks of 2026, each in the month it starts in", () => {
    const weeks = canonicalWeeks(2026);
    expect(weeks).toHaveLength(52);
    expect(weeks[0]).toEqual({ start: "2026-01-04", month: "January", label: "Jan Week 2" });
    expect(weeks.find((w) => w.start === "2026-03-29")).toMatchObject({ month: "March", label: "Mar Week 5" });
    expect(weeks.filter((w) => w.month === "October").map((w) => w.start)).toEqual(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]);
    expect(weeks[weeks.length - 1].start).toBe("2026-12-27");
  });
});

describe("planWeeklyRebuild", () => {
  const octoberWeeks = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"];
  const recipients = (...r: [string, number][]): Map<string, Recipient[]> => new Map([["Mars-Nairobi", r.map(([teamLeaderId, weight]) => ({ teamLeaderId, weight }))]]);
  const monthly = (value: number) => [{ principal: "Mars-Nairobi", month: "October", value }];

  it("splits the monthly target across the leaders by weight and keeps the existing weekly phasing", () => {
    // the old plan sat on the supervisor's row, phased 1:1:2:4
    const weekly = octoberWeeks.map((start, i) => sunday(start, "lucy", "Mars-Nairobi", [100, 100, 200, 400][i]));
    const plan = planWeeklyRebuild({ year: 2026, weekly, monthly: monthly(800), recipientsByPrincipal: recipients(["zachary", 3], ["lewis", 1]) });

    const planned = (tl: string) => [...plan.updates, ...plan.inserts.map((i) => ({ ...i, id: "" }))].filter((u) => u.teamLeaderId === tl && octoberWeeks.includes(u.start)).sort((a, b) => a.start.localeCompare(b.start)).map((u) => u.newValue);
    expect(planned("zachary")).toEqual([75, 75, 150, 300]); // 600 of 800, phased 1:1:2:4 of 800
    expect(planned("lewis")).toEqual([25, 25, 50, 100]);
    // the old holder is zeroed, and the weeks add up to the monthly target exactly
    expect(planned("lucy")).toEqual([0, 0, 0, 0]);
    expect(plan.totals).toContainEqual({ principal: "Mars-Nairobi", month: "October", target: 800, planned: 800 });
    expect(plan.inserts.map((i) => i.teamLeaderId).sort()).toEqual(["lewis", "lewis", "lewis", "lewis", "zachary", "zachary", "zachary", "zachary"]);
  });

  it("uses every row of the principal as phasing, orphaned ones included, and zeroes them", () => {
    const weekly = [sunday("2026-10-04", "deleted-row", "Mars-Nairobi", 300), sunday("2026-10-11", "deleted-row", "Mars-Nairobi", 100)];
    const plan = planWeeklyRebuild({ year: 2026, weekly, monthly: monthly(400), recipientsByPrincipal: recipients(["zachary", 1]) });
    const zeroed = plan.updates.filter((u) => u.teamLeaderId === "deleted-row");
    expect(zeroed.map((u) => u.newValue)).toEqual([0, 0]);
    expect(plan.inserts.filter((i) => i.teamLeaderId === "zachary").map((i) => i.newValue)).toEqual([300, 100]);
  });

  it("uses a leader's legacy Monday-start figures for phasing when they have no Sunday ones, then zeroes them", () => {
    const weekly = [row("lucy", "Mars-Nairobi", "2026-10-05", 100), row("lucy", "Mars-Nairobi", "2026-10-12", 300)];
    const plan = planWeeklyRebuild({ year: 2026, weekly, monthly: monthly(400), recipientsByPrincipal: recipients(["zachary", 1]) });
    expect(plan.inserts.filter((i) => i.teamLeaderId === "zachary").map((i) => i.newValue)).toEqual([100, 300, 0, 0].filter((v) => v > 0));
    expect(plan.mondayZeroed).toBe(2);
    expect(plan.updates.filter((u) => u.newValue === 0 && u.oldValue > 0)).toHaveLength(2);
  });

  it("splits evenly across the weeks when there is no phasing to keep", () => {
    const plan = planWeeklyRebuild({ year: 2026, weekly: [], monthly: monthly(400), recipientsByPrincipal: recipients(["zachary", 1]) });
    expect(plan.inserts.map((i) => i.newValue)).toEqual([100, 100, 100, 100]);
  });

  it("keeps the rounding residual so the weeks always add up to the target", () => {
    const plan = planWeeklyRebuild({ year: 2026, weekly: [], monthly: monthly(1000), recipientsByPrincipal: recipients(["a", 1], ["b", 1], ["c", 1]) });
    expect(plan.totals.find((t) => t.month === "October")!.planned).toBe(1000);
    expect(plan.inserts.reduce((s, i) => s + i.newValue, 0)).toBeCloseTo(1000, 2);
  });

  it("zeroes a principal's weeks when the month has no target", () => {
    const weekly = octoberWeeks.map((start) => sunday(start, "zachary", "Mars-Nairobi", 50));
    const plan = planWeeklyRebuild({ year: 2026, weekly, monthly: monthly(0), recipientsByPrincipal: recipients(["zachary", 1]) });
    expect(plan.updates.filter((u) => octoberWeeks.includes(u.start)).every((u) => u.newValue === 0)).toBe(true);
    expect(plan.inserts).toEqual([]);
  });

  it("leaves a principal-month alone, and says so, when nobody can carry the target", () => {
    const weekly = octoberWeeks.map((start) => sunday(start, "lucy", "Mars-Nairobi", 50));
    const plan = planWeeklyRebuild({ year: 2026, weekly, monthly: monthly(900), recipientsByPrincipal: new Map() });
    expect(plan.unplaced).toEqual(["Mars-Nairobi October"]);
    expect(plan.updates).toEqual([]);
  });

  it("falls back to an equal split when no weight is known", () => {
    const plan = planWeeklyRebuild({ year: 2026, weekly: [], monthly: monthly(400), recipientsByPrincipal: recipients(["a", 0], ["b", 0]) });
    expect(plan.inserts.filter((i) => i.teamLeaderId === "a").reduce((s, i) => s + i.newValue, 0)).toBe(200);
  });

  it("relabels a week that carries the wrong month or number, and leaves a correct unchanged row out of the plan", () => {
    const right = sunday("2026-10-04", "zachary", "Mars-Nairobi", 100);
    const wrong = row("zachary", "Mars-Nairobi", "2026-10-11", 100, { monthLabel: "September", weekLabel: "Sep Week 9" });
    const plan = planWeeklyRebuild({ year: 2026, weekly: [right, wrong], monthly: monthly(200), recipientsByPrincipal: recipients(["zachary", 1]) });
    const relabelled = plan.updates.find((u) => u.id === wrong.id)!;
    expect(relabelled).toMatchObject({ relabel: true, month: "October", label: "Oct Week 3", newValue: 100 });
    expect(plan.updates.find((u) => u.id === right.id)).toBeUndefined();
  });
});

describe("rollUpToSupervisorRows", () => {
  const rows = [
  { id: "lucy", kind: "SUPERVISOR_TEAM", supervisorId: "S-lucy" },
  { id: "benson", kind: "TEAM_LEADER", supervisorId: "S-lucy" },
  { id: "christine", kind: "TEAM_LEADER", supervisorId: "S-lucy" },
  { id: "erick", kind: "TEAM_LEADER", supervisorId: "S-erick" },
  { id: "eve", kind: "SUPERVISOR_TEAM", supervisorId: "S-eve" },
];

  it("moves the leaders' weights onto the supervisor's own row", () => {
    const rolled = rollUpToSupervisorRows(new Map([["benson", 0.12], ["christine", 0.22], ["lucy", 0.04]]), rows);
    expect([...rolled.keys()]).toEqual(["lucy"]);
    expect(rolled.get("lucy")).toBeCloseTo(0.38, 10);
  });

  it("leaves leaders without a supervisor row, and supervisors, where they are", () => {
    const rolled = rollUpToSupervisorRows(new Map([["erick", 0.5], ["eve", 0.5]]), rows);
    expect(rolled.get("erick")).toBe(0.5);
    expect(rolled.get("eve")).toBe(0.5);
  });
});
