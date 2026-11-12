import { describe, expect, it } from "vitest";
import { shapeTracker, trackerRange } from "@/lib/outletCleanup/trackerShape";

describe("trackerRange", () => {
  it("defaults to the first of this month through today", () => {
    expect(trackerRange(null, null, "2026-11-12")).toEqual({ from: "2026-11-01", to: "2026-11-12" });
  });

  it("never runs past today, never reverses and never spans more than a year", () => {
    expect(trackerRange("2026-11-01", "2026-12-31", "2026-11-12")).toEqual({ from: "2026-11-01", to: "2026-11-12" });
    expect(trackerRange("2026-11-10", "2026-11-02", "2026-11-12")).toEqual({ from: "2026-11-02", to: "2026-11-02" });
    expect(trackerRange("2020-01-01", "2026-11-12", "2026-11-12").from).toBe("2025-11-11");
    expect(trackerRange("garbage", "2026-10-15", "2026-11-12")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });
});

describe("shapeTracker", () => {
  it("turns the counts into a report: days oldest first, busiest people first, totals added up", () => {
    const report = shapeTracker(
      { from: "2026-11-01", to: "2026-11-12" },
      {
        days: [
          { date: "2026-11-03", outlets: BigInt(4), rep_outlets: BigInt(1), geo_tags: BigInt(2), validated: BigInt(0), sent_back: BigInt(1) },
          { date: "2026-11-02", outlets: BigInt(6), rep_outlets: BigInt(0), geo_tags: BigInt(3), validated: BigInt(5), sent_back: BigInt(0) },
        ],
        people: [
          { actor: "b@x.co", role: "REP", outlets: BigInt(1), actions: BigInt(3), geo_tags: BigInt(1), days: BigInt(1), last_at: new Date("2026-11-03T08:00:00Z") },
          { actor: "a@x.co", role: "TEAM_LEADER", outlets: BigInt(9), actions: BigInt(12), geo_tags: BigInt(4), days: BigInt(2), last_at: new Date("2026-11-03T09:00:00Z") },
        ],
        teams: [{ teamLeader: "Benson Mbivi", submitted: BigInt(1), reviewed: BigInt(7), validated: BigInt(2), applied: BigInt(0), sent_back: BigInt(1), geo_tagged: BigInt(5) }],
        distinct: { outlets: BigInt(9), rep_outlets: BigInt(1) },
      },
    );
    expect(report.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(report.people[0].actor).toBe("a@x.co");
    expect(report.teams[0]).toEqual({ teamLeader: "Benson Mbivi", submitted: 1, reviewed: 7, validated: 2, applied: 0, sentBack: 1, geoTagged: 5 });
    expect(report.totals).toEqual({ outlets: 9, repOutlets: 1, geoTags: 5, validated: 5, sentBack: 1, people: 2, activeDays: 2 });
  });
});
