import { describe, expect, it } from "vitest";
import { buildOperationsReport, clock, duration, minuteOfDay, operationsInputFromSnapshot, renderCoachingOperationsHtml } from "@/lib/coachingOperationsReport";

const acc = (id: string, over: Record<string, unknown> = {}) => ({
  id, team_leader_id: "tl", sales_rep_id: "rep", teamLeaderName: "Benson Mbivi", salesRepName: "Catherine Karimi", date: "2026-11-10",
  status: "approved" as const, overall_score: 80, supervisor_comments: null, routeName: "Kayole",
  start_time: "2026-11-10T05:00:00Z", end_time: "2026-11-10T08:00:00Z", ...over,
});
const visit = (id: string, accompaniment_id: string, over: Record<string, unknown> = {}) => ({
  id, accompaniment_id, outlet_id: `o-${id}`, outletName: `Duka ${id}`, principalName: "Mars-Nairobi", visitPrincipal: "Mars", planned: false,
  geofence_status: "inside", arrival_at: "2026-11-10T05:30:00Z", departure_at: "2026-11-10T05:50:00Z", outletCode: "C1", place: "Kayole", distance_from_outlet_m: "12.5", ...over,
});

describe("the Coaching operations report", () => {
  const snapshot = {
    accompaniments: [acc("a1"), acc("a2", { teamLeaderName: "Lewis Muthomi ", salesRepName: "Peter O", status: "draft", overall_score: null, start_time: undefined, end_time: undefined })],
    visits: [visit("v1", "a1"), visit("v2", "a1", { geofence_status: "gps_unavailable", departure_at: null }), visit("v3", "a2", { arrival_at: "2026-11-10T09:00:00Z", departure_at: "2026-11-10T09:01:00Z" })],
    actions: [{ id: "x1", accompaniment_id: "a1", issue: "Shelf", coaching_area: null, priority: "high", target_date: "2026-11-01", status: "open", ownerName: null }],
    photos: [{ url: "https://x/1.jpg", accompaniment_id: "a1", outletName: "Duka v1", takenAt: null, date: "2026-11-10", latitude: null, longitude: null }],
  };

  it("reads the synced snapshot: names, principals, distances and the action owner", () => {
    const input = operationsInputFromSnapshot(snapshot);
    expect(input.rows[0]).toMatchObject({ teamLeader: "Benson Mbivi", rep: "Catherine Karimi", route: "Kayole", overallScore: 80, startTime: "2026-11-10T05:00:00Z" });
    expect(input.rows[1].startTime).toBeNull();
    expect(input.visits[0]).toMatchObject({ outlet: "Duka v1", outletCode: "C1", place: "Kayole", principal: "Mars", planned: false, distanceM: 12.5 });
    expect(input.actions[0]).toMatchObject({ teamLeader: "Benson Mbivi", owner: "Catherine Karimi", area: "General", requiredAction: "" });
    expect(input.photos).toBe(1);
  });

  it("summarises sessions, timing, GPS and exceptions", () => {
    const r = buildOperationsReport(operationsInputFromSnapshot(snapshot), "2026-11-16");
    expect(r.summary).toMatchObject({ sessions: 2, teamLeaders: 2, reps: 2, outlets: 3, visits: 3, plannedTracked: false, plannedPct: null, gpsPct: 66.7, photos: 1, overdueActions: 1 });
    expect(r.teamLeaders.map((t) => t.name)).toEqual(["Benson Mbivi", "Lewis Muthomi"]);
    const a1 = r.sessions.find((s) => s.id === "a1")!;
    expect([clock(a1.start), clock(a1.end), duration(a1.minutes)]).toEqual(["08:00", "11:00", "3h 00m"]);
    // No start or end on the phone: the check-in and check-out stand in.
    const a2 = r.sessions.find((s) => s.id === "a2")!;
    expect([clock(a2.start), a2.minutes]).toEqual(["12:00", 1]);
    const counts = Object.fromEntries(r.exceptions.map((e) => [e.kind, e.count]));
    expect(counts["Sessions still in draft"]).toBe(1);
    expect(counts["Outlet visits with no check-out"]).toBe(1);
    expect(counts["Outlet visits under 3 minutes"]).toBe(1);
    expect(minuteOfDay("2026-11-10T22:15:00Z")).toBe(75);
  });

  it("draws a safe, printable page", () => {
    const evil = { ...snapshot, accompaniments: [acc("a1", { salesRepName: "<img src=x onerror=alert(1)>" })] };
    const html = renderCoachingOperationsHtml("Coaching", buildOperationsReport(operationsInputFromSnapshot(evil), "2026-11-16"), "2026-11-01 – 2026-11-16");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("size:A4 landscape");
    for (const id of ["summary", "leaders", "reps", "days", "time", "coverage", "actions", "exceptions", "log"]) expect(html).toContain(`id="${id}"`);
  });
});
