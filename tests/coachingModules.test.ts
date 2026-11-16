import { describe, expect, it } from "vitest";
import { countBy, dailyCounts, groupRows, isOverdue, kpis, scoreBuckets } from "@/lib/coachingModules";
import { mainPrincipalKey } from "@/lib/coachingBridge";

const acc = (id: string, over: Record<string, unknown> = {}) => ({
  id, team_leader_id: "tl", sales_rep_id: "rep", teamLeaderName: "Benson Mbivi", salesRepName: "Catherine Karimi", date: "2026-11-03",
  status: "approved" as const, overall_score: 80, supervisor_comments: "Good", activityType: "accompaniment" as const, routeName: "Kayole", ...over,
});
const visit = (id: string, accompaniment_id: string, over: Record<string, unknown> = {}) => ({
  id, accompaniment_id, outlet_id: `o-${id}`, outletName: "Duka", principalName: "Mars-Nairobi", visitPrincipal: "Mars", planned: true, geofence_status: "inside",
  arrival_at: "2026-11-03T07:00:00Z", departure_at: "2026-11-03T07:20:00Z", ...over,
});

describe("coaching modules", () => {
  const snapshot = {
    accompaniments: [acc("a1"), acc("a2", { status: "submitted", overall_score: 50, supervisor_comments: null, date: "2026-11-04" }), acc("a3", { teamLeaderName: "Lewis Muthomi", status: "draft", overall_score: null, activityType: "outlet_visitation" })],
    visits: [visit("v1", "a1"), visit("v2", "a1", { geofence_status: "outside", departure_at: null }), visit("v3", "a2", { geofence_status: "gps_unavailable" })],
    actions: [
      { id: "x1", accompaniment_id: "a1", issue: "Shelf", coaching_area: "Merchandising", priority: "high", target_date: "2026-11-01", status: "open" },
      { id: "x2", accompaniment_id: "a2", issue: "Pricing", coaching_area: null, priority: "low", target_date: "2026-11-01", status: "completed" },
    ],
  };

  it("summarises per team leader: scores, approval and feedback of submitted work, geofence of known visits, time at the outlet", () => {
    const rows = groupRows(snapshot, (a) => a.teamLeaderName);
    expect(rows[0]).toEqual({ name: "Benson Mbivi", accompaniments: 2, visits: 3, outlets: 3, avgScore: 65, approvedPct: 50, feedbackPct: 50, geofencePct: 50, avgMinutesAtOutlet: 20 });
    expect(rows[1].name).toBe("Lewis Muthomi");
  });

  it("works out the headline figures", () => {
    expect(kpis(snapshot, "2026-11-16")).toEqual({ accompaniments: 2, visitations: 1, outletVisits: 3, uniqueOutlets: 3, avgScore: 65, approvedPct: 50, geofencePct: 50, actionClosurePct: 50, overdueActions: 1 });
    expect(isOverdue(snapshot.actions[1], "2026-11-16")).toBe(false);
  });

  it("counts by day, score band and label", () => {
    expect(dailyCounts(snapshot.accompaniments)).toEqual([{ label: "2026-11-03", value: 2 }, { label: "2026-11-04", value: 1 }]);
    expect(scoreBuckets(snapshot.accompaniments).map((b) => b.value)).toEqual([0, 1, 0, 1]);
    expect(countBy(snapshot.actions, (a) => a.coaching_area ?? "General")).toEqual([{ label: "General", value: 1 }, { label: "Merchandising", value: 1 }]);
  });

  it("matches a principal's locations to its main principal", () => {
    expect(mainPrincipalKey("Mars-Nairobi")).toBe("mars");
    expect(mainPrincipalKey("Mars")).toBe("mars");
    expect(mainPrincipalKey("EABL-General")).toBe("eabl");
    expect(mainPrincipalKey("Milly Fruits-Nairobi")).toBe("milly fruits");
  });
});

import { filterSnapshot } from "@/lib/coachingBridge";

describe("the team leader filter", () => {
  const payload = {
    principals: [],
    accompaniments: [acc("a1"), acc("a2", { teamLeaderName: "Lewis Muthomi" }), acc("a3", { teamLeaderName: "zachary  Mwangi", date: "2026-10-01" })],
    visits: [visit("v1", "a1"), visit("v2", "a2")],
    actions: [],
    photos: [{ url: "https://x/1.jpg", accompaniment_id: "a2", outletName: "Duka", takenAt: null, date: "2026-11-03", latitude: null, longitude: null }],
  };

  it("narrows to one team leader (ignoring case and spacing) and lists the leaders in scope and dates", () => {
    const all = filterSnapshot(payload, { allLeaders: true, leaderNames: [] }, { from: "2026-11-01", to: "2026-11-16" });
    expect(all.teamLeaders).toEqual(["Benson Mbivi", "Lewis Muthomi"]);
    const lewis = filterSnapshot(payload, { allLeaders: true, leaderNames: [] }, { from: "2026-11-01", to: "2026-11-16", teamLeader: "lewis muthomi" });
    expect(lewis.accompaniments.map((a) => a.id)).toEqual(["a2"]);
    expect(lewis.visits.map((v) => v.id)).toEqual(["v2"]);
    expect(lewis.photos).toHaveLength(1);
    expect(lewis.teamLeaders).toEqual(["Benson Mbivi", "Lewis Muthomi"]);
  });

  it("never reaches past the viewer's own scope", () => {
    const own = filterSnapshot(payload, { allLeaders: false, leaderNames: ["Benson Mbivi"] }, { from: "2026-11-01", to: "2026-11-16", teamLeader: "Lewis Muthomi" });
    expect(own.accompaniments).toEqual([]);
    expect(own.teamLeaders).toEqual(["Benson Mbivi"]);
  });
});
