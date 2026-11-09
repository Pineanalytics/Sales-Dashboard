import { describe, expect, it } from "vitest";
import { cleanRouteName, cleanVisitDays, routeNameFromLocations } from "../lib/outletCleanup/validate";
import { suggestFromVisits, weekdayFromWorkingDay, weekdayInText, weekdayOf, type VisitEvent } from "../lib/outletCleanup/visitSuggestion";
import { applyApprovedCleanup, NO_APPROVED_CLEANUP, type OverlayRow } from "../lib/outletCleanup/overlay";

// 2026-10-26 is a Monday.
const TODAY = "2026-10-26";
const day = (offset: number) => new Date(new Date(`${TODAY}T00:00:00Z`).getTime() - offset * 86_400_000).toISOString().slice(0, 10);
const visit = (offset: number, repCode = "R1", rep = "Erick Mutinda"): VisitEvent => ({ date: day(offset), repCode, rep });
const opts = { basis: "Pine call timestamps", windowDays: 90, today: TODAY };

describe("naming a route", () => {
  it("joins the major locations with hyphens, at most three", () => {
    expect(routeNameFromLocations(["Imara Daima", "Fedha"])).toBe("Imara Daima-Fedha");
    expect(routeNameFromLocations([" Kayole ", "", "Utawala", "Njiru", "Ruai"])).toBe("Kayole-Utawala-Njiru");
  });

  it("accepts a place-style name and tidies spacing around hyphens", () => {
    expect(cleanRouteName("  Imara  Daima - Fedha ")).toBe("Imara Daima-Fedha");
    expect(cleanRouteName("Kitui Town (North)")).toBe("Kitui Town (North)");
    expect(["", "ab", "-Kayole", "Kayole@Soweto", "x".repeat(61)].map(cleanRouteName)).toEqual([null, null, null, null, null]);
  });

  it("takes weekdays in any spelling, in week order, and refuses anything else", () => {
    expect(cleanVisitDays(["thursday", "Mon", "monday"])).toEqual(["Mon", "Thu"]);
    expect(cleanVisitDays(["Mon", "Someday"])).toBeNull();
    expect(cleanVisitDays([])).toEqual([]);
  });
});

describe("weekdays", () => {
  it("finds the weekday of a date, in text and from a Centegy working day", () => {
    expect(weekdayOf(TODAY)).toBe("Mon");
    expect(weekdayOf("2026-10-25")).toBe("Sun");
    expect(weekdayInText("Collins Onyuka - Thursday")).toBe("Thu");
    expect(weekdayInText("EABL-Mugunda")).toBeNull();
    expect(weekdayFromWorkingDay(1)).toBe("Mon");
    expect(weekdayFromWorkingDay(6)).toBe("Sat");
    expect(weekdayFromWorkingDay(null)).toBeNull();
  });
});

describe("suggesting route days from visits", () => {
  it("suggests the days an outlet is visited on every week and calls it weekly", () => {
    // Visited every Tuesday and Thursday for 12 weeks (Mon 26 Oct: Tuesday = 6 days earlier).
    const visits: VisitEvent[] = [];
    for (let week = 0; week < 12; week += 1) visits.push(visit(6 + week * 7), visit(4 + week * 7));
    const s = suggestFromVisits(visits, opts);
    expect(s.suggestedDays).toEqual(["Tue", "Thu"]);
    expect(s.cadence).toBe("Weekly or more");
    expect(s.visitDays).toBe(24);
    expect(s.weeksVisited).toBe(12);
    expect(s.reps).toEqual([{ code: "R1", name: "Erick Mutinda", visits: 24 }]);
  });

  it("counts several calls on one day as one visit", () => {
    const s = suggestFromVisits([visit(6), visit(6), visit(6)], opts);
    expect(s.visitDays).toBe(1);
    expect(s.suggestedDays).toEqual(["Tue"]);
  });

  it("calls an outlet seen every fortnight on the same day fortnightly", () => {
    const visits = [0, 2, 4, 6, 8, 10].map((n) => visit(5 + n * 7)); // Wednesdays, every other week
    const s = suggestFromVisits(visits, opts);
    expect(s.suggestedDays).toEqual(["Wed"]);
    expect(s.cadence).toBe("Fortnightly");
  });

  it("gives no suggested day to scattered one-off visits, and none to an outlet that was never visited", () => {
    const scattered = suggestFromVisits([visit(1), visit(9), visit(17), visit(26)], opts);
    expect(scattered.suggestedDays).toEqual([]);
    expect(scattered.cadence).toBe("Monthly"); // four visits in four different weeks
    expect(suggestFromVisits([visit(30)], opts).cadence).toBe("Occasional");
    const none = suggestFromVisits([], opts);
    expect(none).toMatchObject({ cadence: "No visits on record", suggestedDays: [], visitDays: 0, suggestedRep: null });
  });

  it("ignores visits outside the window", () => {
    const s = suggestFromVisits([visit(120), visit(200)], opts);
    expect(s.visitDays).toBe(0);
  });

  it("reads the visits of the row's own rep when they have any, and suggests a different rep who visits most", () => {
    const visits: VisitEvent[] = [];
    for (let week = 0; week < 8; week += 1) visits.push(visit(6 + week * 7, "R2", "Mercy Monicah"));
    visits.push(visit(3, "R1", "Erick Mutinda"));
    const repOptions = [{ code: "R1", name: "Erick Mutinda" }, { code: "R2", name: "Mercy Monicah" }];
    const own = suggestFromVisits(visits, { ...opts, rowRepCode: "R1", rowRepName: "Erick Mutinda", repOptions });
    expect(own.visitDays).toBe(1); // the row's rep visited once
    expect(own.suggestedRep).toEqual({ code: "R2", name: "Mercy Monicah" }); // but Mercy is the usual visitor
    expect(own.reps[0]).toMatchObject({ name: "Mercy Monicah", visits: 8 });
    const noRowVisits = suggestFromVisits(visits, { ...opts, rowRepCode: "R9", rowRepName: "Someone Else", repOptions });
    expect(noRowVisits.visitDays).toBe(9); // nobody on this row visited: everyone's visits are used
  });

  it("does not suggest a rep who is not on the principal's list, or the rep already on the row", () => {
    const visits = [visit(6, "R2", "Mercy Monicah"), visit(13, "R2", "Mercy Monicah")];
    expect(suggestFromVisits(visits, { ...opts, repOptions: [{ code: "R1", name: "Erick Mutinda" }] }).suggestedRep).toBeNull();
    expect(suggestFromVisits(visits, { ...opts, rowRepCode: "R2", repOptions: [{ code: "R2", name: "Mercy Monicah" }] }).suggestedRep).toBeNull();
  });
});

describe("approved route and visit days on the universe", () => {
  const row = (principal: string): OverlayRow => ({ source: "PINE", outletKey: "1", principal, region: "Nairobi", territory: "Kayole", channel: "Retail", segment: "Retailers", repCode: "100", repName: "Old Rep", teamLeader: "Eve Theuri", latitude: null, longitude: null, route: null, visitDays: null });
  const entry = { id: "e", source: "PINE", outletKey: "1", region: null, territory: null, channel: null, customerType: null, contactName: null, contactPhone: null, latitude: null, longitude: null };

  it("puts the validated route and days on the principal's rows, with or without a rep change", () => {
    const out = applyApprovedCleanup(
      [row("Mars-Nairobi"), row("Suntory-Nairobi")],
      { ...NO_APPROVED_CLEANUP, entries: [{ ...entry, repDecisions: [{ principal: "Mars-Nairobi", rep: "Old Rep", repCode: "100", previousRep: "Old Rep", action: "CONFIRMED", routeName: "Imara Daima-Fedha", visitDays: ["Tue", "Thu"] }] }] }
    );
    expect(out[0]).toMatchObject({ route: "Imara Daima-Fedha", visitDays: "Tue, Thu", repName: "Old Rep" });
    expect(out[1]).toMatchObject({ route: null, visitDays: null });
  });
});
