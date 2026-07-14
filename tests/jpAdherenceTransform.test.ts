import { describe, it, expect } from "vitest";
import {
  collapseToPurchaseEvents,
  geoSweepHomeDays,
  minOutletsTarget,
  buildJourneyPlan,
  aggregateActualVisits,
  buildJpAdherence,
  buildMonthlySplit,
  type PrincipalRow,
  type RepOutletVisitGrouped,
  type JourneyPlanRow,
  type ActualVisit,
} from "../scripts/db-bridge/jp-adherence/transform";
import type { FactLineRow, OutletRow, ProductRow, UserRow } from "../scripts/db-bridge/jp-adherence/query";

function principal(overrides: Partial<PrincipalRow>): PrincipalRow {
  return {
    key: "1",
    principal: "Bic-Nairobi",
    mainPrincipal: "Bic",
    location: "Nairobi",
    locationCode: "1",
    status: "Active",
    teamLeader: "Someone",
    ...overrides,
  };
}
const PRINCIPALS: PrincipalRow[] = [principal({ principal: "Bic-Nairobi", mainPrincipal: "Bic" })];

function outlet(overrides: Partial<OutletRow>): OutletRow {
  return { id: "1", name: "Test Outlet", subChannel: "Retailers", sourceChannel: "Retail", territory: "Nairobi", latitude: null, longitude: null, ...overrides };
}
function user(overrides: Partial<UserRow>): UserRow {
  return { id: "1", employee: "Jane Doe", userGroup: "DSR", region: "Nairobi", ...overrides };
}
function product(overrides: Partial<ProductRow>): ProductRow {
  return { id: "1", sapCode: "BIC12345", ...overrides };
}
function factLine(overrides: Partial<FactLineRow>): FactLineRow {
  return {
    docId: "100",
    isOrder: false,
    purchaseTime: new Date("2026-01-15T10:00:00Z"),
    userId: "1",
    customerId: "1",
    itemId: "1",
    qty: 10,
    unitPrice: 5,
    ...overrides,
  };
}

describe("geoSweepHomeDays", () => {
  it("orders outlets by angle around the centroid (a ring fixture)", () => {
    // Diagonal directions, not cardinal — hasGeo requires BOTH latitude and
    // longitude to be non-zero, so a cardinal point like (1, 0) would itself
    // be (incorrectly, for this fixture's purposes) treated as no-geo.
    const outlets = [
      { customerId: "NE", latitude: 1, longitude: 1 },
      { customerId: "SE", latitude: -1, longitude: 1 },
      { customerId: "SW", latitude: -1, longitude: -1 },
      { customerId: "NW", latitude: 1, longitude: -1 },
    ];
    const swept = geoSweepHomeDays(outlets);
    const order = [...swept].sort((a, b) => a.routeSeq - b.routeSeq).map((o) => o.customerId);
    // atan2(latDiff, longDiff) ascending: SW(-3pi/4), SE(-pi/4), NE(pi/4), NW(3pi/4)
    expect(order).toEqual(["SW", "SE", "NE", "NW"]);
    expect(swept.find((o) => o.customerId === "SW")!.homeDayIdx).toBe(0);
    expect(swept.find((o) => o.customerId === "SE")!.homeDayIdx).toBe(1);
    expect(swept.find((o) => o.customerId === "NE")!.homeDayIdx).toBe(2);
    expect(swept.find((o) => o.customerId === "NW")!.homeDayIdx).toBe(3);
  });

  it("splits a 10-outlet route into 5 contiguous chunks (2 outlets per weekday)", () => {
    // Angles offset away from any multiple of pi/2 so no outlet's lat or long
    // ever lands on (or near) exactly 0 — see the hasGeo caveat above.
    const outlets = Array.from({ length: 10 }, (_, i) => {
      const angle = -Math.PI + 0.15 + (i + 0.5) * ((2 * Math.PI * 0.95) / 10);
      return { customerId: `o${i}`, latitude: Math.sin(angle), longitude: Math.cos(angle) };
    }).reverse(); // shuffle input order — the sweep must still re-sort correctly
    const swept = geoSweepHomeDays(outlets);
    const byRouteSeq = [...swept].sort((a, b) => a.routeSeq - b.routeSeq);
    expect(byRouteSeq.map((o) => o.customerId)).toEqual(Array.from({ length: 10 }, (_, i) => `o${i}`));
    expect(byRouteSeq.map((o) => o.homeDayIdx)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("treats lat=0,long=0 as no-geo, appended after geo-valid outlets in original order", () => {
    const outlets = [
      { customerId: "zero1", latitude: 0, longitude: 0 },
      { customerId: "real", latitude: 5, longitude: 5 },
      { customerId: "zero2", latitude: 0, longitude: 0 },
    ];
    const swept = geoSweepHomeDays(outlets);
    const order = [...swept].sort((a, b) => a.routeSeq - b.routeSeq).map((o) => o.customerId);
    expect(order).toEqual(["real", "zero1", "zero2"]);
  });

  it("treats null lat/long as no-geo too", () => {
    const outlets = [
      { customerId: "nogeo", latitude: null, longitude: null },
      { customerId: "geo", latitude: 1, longitude: 1 },
    ];
    const swept = geoSweepHomeDays(outlets);
    const order = [...swept].sort((a, b) => a.routeSeq - b.routeSeq).map((o) => o.customerId);
    expect(order).toEqual(["geo", "nogeo"]);
  });

  it("doesn't throw on an empty list", () => {
    expect(geoSweepHomeDays([])).toEqual([]);
  });
});

describe("minOutletsTarget", () => {
  it("matches Mars by role", () => {
    expect(minOutletsTarget("Mars-Nairobi", "Secondary Sales")).toBe(40);
    expect(minOutletsTarget("Mars-Nairobi", "Primary Sales")).toBe(15);
  });

  it("is case-insensitive", () => {
    expect(minOutletsTarget("MARS-NAIROBI", "Secondary Sales")).toBe(40);
  });

  it("falls back to the (brand, any role) entry for Bic/Weetabix/Suntory", () => {
    expect(minOutletsTarget("Bic-Nairobi", "Primary Sales")).toBe(20);
    expect(minOutletsTarget("Bic-Nairobi", "Secondary Sales")).toBe(20);
    expect(minOutletsTarget("Weetabix-Nairobi", "Primary Sales")).toBe(30);
    expect(minOutletsTarget("Suntory-Nairobi", "Secondary Sales")).toBe(40);
  });

  it("falls back to the default for an unlisted brand", () => {
    expect(minOutletsTarget("Nestle-Nairobi", "Primary Sales")).toBe(15);
  });

  it("falls back to the default for the internal Key Accounts grouping token", () => {
    expect(minOutletsTarget("Key Accounts", "Primary Sales")).toBe(15);
  });
});

describe("buildJourneyPlan — frequency/offset day assignment, including mod-5 wraparound", () => {
  it("assigns visit days relative to each outlet's geo-sweep home day, wrapping past Friday back to Monday", () => {
    // 5 outlets for one rep, angles strictly increasing so the sweep order equals
    // input order: homeDayIdx = routeSeq = 0,1,2,3,4 (n=5). The 5th outlet
    // (homeDayIdx=4, Friday) gets visitsPerWeek=4 -> offsets [0,1,2,3] ->
    // {(4+0)%5,(4+1)%5,(4+2)%5,(4+3)%5} = {4,0,1,2} = Fri,Mon,Tue,Wed — NOT Thursday.
    const visits: RepOutletVisitGrouped[] = Array.from({ length: 5 }, (_, i) => {
      // Strictly increasing, and offset away from 0/+-pi/2 so no outlet's lat
      // or long lands on exactly 0 (hasGeo requires both to be non-zero).
      const angle = -2 + i * 1 + 0.15;
      return {
        userId: "1",
        employee: "Rep One",
        userGroup: "DSR",
        salesRole: "Primary Sales",
        costCentre: "Bic-Nairobi",
        costCentreGroup: "Bic-Nairobi",
        customerId: `o${i}`,
        customerName: `Outlet ${i}`,
        territory: "Nairobi",
        latitude: Math.sin(angle),
        longitude: Math.cos(angle),
        visitDays: 1,
        visitsPerWeek: i === 4 ? 4 : 1,
      };
    });

    // 2026-01-05 is a Monday, 2026-01-09 is the Friday of the same week (verified: 2025-01-01
    // was a Wednesday, 2025 has 365 days, so 2026-01-01 is a Thursday -> 01-05 is Monday).
    const start = new Date(Date.UTC(2026, 0, 5));
    const end = new Date(Date.UTC(2026, 0, 9, 23, 59, 59));
    const plan = buildJourneyPlan(visits, start, end);

    const daysFor = (customerId: string) =>
      plan
        .filter((r) => r.customerId === customerId)
        .map((r) => r.day)
        .sort();

    expect(daysFor("o0")).toEqual(["Monday"]);
    expect(daysFor("o1")).toEqual(["Tuesday"]);
    expect(daysFor("o2")).toEqual(["Wednesday"]);
    expect(daysFor("o3")).toEqual(["Thursday"]);
    expect(daysFor("o4").sort()).toEqual(["Friday", "Monday", "Tuesday", "Wednesday"].sort());
    expect(daysFor("o4")).not.toContain("Thursday");
  });
});

describe("aggregateActualVisits — same-day multi-line collapse", () => {
  it("collapses multiple purchase events for the same rep+outlet+day into one ActualVisit row", () => {
    const outlets = [outlet({ id: "1" })];
    const users = [user({ id: "1" })];
    const products = [product({ id: "1", sapCode: "BIC12345" }), product({ id: "2", sapCode: "BIC54321" })];
    const lines = [
      factLine({ docId: "100", itemId: "1", qty: 10, unitPrice: 5, purchaseTime: new Date("2026-01-15T09:00:00Z") }),
      factLine({ docId: "101", itemId: "2", qty: 4, unitPrice: 2.5, purchaseTime: new Date("2026-01-15T14:00:00Z") }), // different document, same day/outlet/rep
    ];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(2); // two distinct documents

    const actual = aggregateActualVisits(events, [], outlets, users);
    expect(actual).toHaveLength(1); // collapsed to one row per (date, userId, customerId)
    expect(actual[0].revenue).toBe(10 * 5 + 4 * 2.5);
    expect(actual[0].qty).toBe(14);
    expect(actual[0].productive).toBe(true);
  });
});

describe("buildJpAdherence — planned vs actual matching", () => {
  const baseDate = new Date(Date.UTC(2026, 0, 5));

  function planRow(overrides: Partial<JourneyPlanRow>): JourneyPlanRow {
    return {
      costCentreGroup: "Bic-Nairobi",
      principalCostCentre: "Bic-Nairobi",
      salesRole: "Primary Sales",
      userGroup: "DSR",
      employeeCode: "1",
      employeeName: "Jane Doe",
      monthLabel: "Jan-2026",
      day: "Monday",
      date: baseDate,
      weekOfMonth: 1,
      dayIndex: 0,
      routeSeq: 0,
      customerId: "c1",
      customerName: "Outlet 1",
      territory: "Nairobi",
      latitude: null,
      longitude: null,
      visitsPerWeek: 1,
      minOutletsTarget: 15,
      dayOutletCount: 1,
      status: "OK",
      ...overrides,
    };
  }
  function actualVisit(overrides: Partial<ActualVisit>): ActualVisit {
    return {
      date: "2026-01-05",
      userId: "1",
      employee: "Jane Doe",
      userGroup: "DSR",
      salesRole: "Primary Sales",
      costCentre: "Bic-Nairobi",
      customerId: "c1",
      customerName: "Outlet 1",
      territory: "Nairobi",
      latitude: null,
      longitude: null,
      revenue: 100,
      qty: 10,
      productive: true,
      visitType: "Sale",
      ...overrides,
    };
  }

  it("classifies all four outcomes correctly", () => {
    const plan = [
      planRow({ customerId: "c1" }), // planned + visited + productive
      planRow({ customerId: "c2" }), // planned + visited, not productive (no-sale only)
      planRow({ customerId: "c3" }), // planned, never visited
    ];
    const actual = [
      actualVisit({ customerId: "c1", productive: true, visitType: "Sale" }),
      actualVisit({ customerId: "c2", productive: false, visitType: "No Sale", revenue: 0, qty: 0 }),
      actualVisit({ customerId: "c4", productive: true, visitType: "Sale" }), // unplanned
    ];
    const { detail, summary } = buildJpAdherence(plan, actual);

    expect(detail.find((d) => d.customerId === "c1")!.jpStatus).toBe("Planned & Productive");
    expect(detail.find((d) => d.customerId === "c2")!.jpStatus).toBe("Planned & Visited");
    expect(detail.find((d) => d.customerId === "c3")!.jpStatus).toBe("Planned Not Visited");
    expect(detail.find((d) => d.customerId === "c4")!.jpStatus).toBe("Unplanned Visit");

    const s = summary.find((r) => r.employeeCode === "1")!;
    expect(s.outletsPlanned).toBe(3);
    expect(s.outletsVisited).toBe(2); // c1 + c2
    expect(s.productiveOutlets).toBe(1); // c1 only
    expect(s.plannedNotVisited).toBe(1); // c3
    expect(s.visitedNotPlanned).toBe(1); // c4
    expect(s.totalActualVisits).toBe(3); // c1, c2, c4
  });

  it("guards against division by zero when an employee has zero planned outlets that day", () => {
    const plan: JourneyPlanRow[] = []; // no plan at all
    const actual = [actualVisit({ employee: "Bob", customerId: "c9", date: "2026-01-05" })];
    const { summary } = buildJpAdherence(plan, actual);
    const s = summary[0];
    expect(s.outletsPlanned).toBe(0);
    expect(s.jpAdherencePct).toBe(0);
    expect(s.outletsVisited).toBe(0); // unplanned visits don't count as "visited" in the planned sense
    expect(s.strikeRatePct).toBe(0);
    expect(Number.isNaN(s.jpAdherencePct)).toBe(false);
    expect(Number.isNaN(s.strikeRatePct)).toBe(false);
  });

  it("Status boundaries: >=90% Excellent, >=75% Good, below Below Target", () => {
    function scenario(plannedCount: number, visitedCount: number) {
      const plan = Array.from({ length: plannedCount }, (_, i) => planRow({ customerId: `c${i}` }));
      const actual = Array.from({ length: visitedCount }, (_, i) => actualVisit({ customerId: `c${i}` }));
      return buildJpAdherence(plan, actual).summary[0];
    }
    expect(scenario(10, 9).status).toBe("Excellent"); // exactly 90%
    expect(scenario(20, 15).status).toBe("Good"); // exactly 75%
    expect(scenario(20, 14).status).toBe("Below Target"); // 70%, just under 75%
  });
});

describe("buildMonthlySplit — Active/Inactive 3-month boundary", () => {
  it("treats the cutoff date as Active (>=), one day before as Inactive, one day after as Active", () => {
    const outlets = [outlet({ id: "A" }), outlet({ id: "B" }), outlet({ id: "C" })];
    const users = [user({ id: "1" })];
    const products = [product({ id: "1", sapCode: "BIC12345" })];
    const windowEnd = new Date(Date.UTC(2026, 3, 10)); // 2026-04-10; cutoff = 2026-01-10

    const lines = [
      factLine({ docId: "100", customerId: "A", purchaseTime: new Date("2026-01-10T09:00:00Z") }), // exactly at cutoff
      factLine({ docId: "101", customerId: "B", purchaseTime: new Date("2026-01-09T09:00:00Z") }), // one day before
      factLine({ docId: "102", customerId: "C", purchaseTime: new Date("2026-01-11T09:00:00Z") }), // one day after
    ];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    const split = buildMonthlySplit(events, [], users, windowEnd);

    // All three purchases are in the same Jan-2026 / Bic-Nairobi / Primary Sales / rep "1" group,
    // so they collapse into ONE MonthlySplitRow per ActivityStatus. Coverage=1 for the "Active" row
    // (A and C, but they're the same group only if same ActivityStatus — A and C are both Active,
    // B is Inactive, so we expect exactly one Active row with coverage=2 and one Inactive row with coverage=1).
    const active = split.find((r) => r.activityStatus === "Active");
    const inactive = split.find((r) => r.activityStatus === "Inactive");
    expect(active?.coverage).toBe(2); // A (cutoff day itself) + C (one day after)
    expect(inactive?.coverage).toBe(1); // B (one day before)
  });
});
