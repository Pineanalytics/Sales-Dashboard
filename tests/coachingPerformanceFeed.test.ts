import { describe, expect, it } from "vitest";
import { asOfDate, recentPeriods, shapeRepPerformance } from "@/lib/coachingPerformanceFeed";

const active = new Set(["100", "101", "102"]);

describe("shapeRepPerformance", () => {
  const rows = shapeRepPerformance({
    period: "2026-10",
    asOf: "2026-10-14",
    employeeCodes: active,
    sales: [
      { employeeCode: "100", cases: 120.44, revenue: 90_000 },
      { employeeCode: "999", cases: 5, revenue: 1_000 }, // not on the active roster
    ],
    calls: [
      { employeeCode: "100", callsMade: 50, productiveCalls: 40, daysWorked: 10 },
      { employeeCode: "101", callsMade: 0, productiveCalls: 0, daysWorked: 0 },
    ],
    targets: [
      { employeeCode: "100", monthTarget: 200_000, targetToDate: 100_000 },
      { employeeCode: "102", monthTarget: 50_000, targetToDate: 20_000 }, // target but no activity yet
    ],
  });
  const byCode = Object.fromEntries(rows.map((r) => [r.employeeCode, r]));

  it("turns amounts into percentages and keeps only roster employees", () => {
    expect(Object.keys(byCode).sort()).toEqual(["100", "101", "102"]);
    expect(byCode["100"]).toMatchObject({
      period: "2026-10",
      asOf: "2026-10-14",
      volumeCases: 120.4,
      revenueVsPacePct: 90,
      revenueVsMonthPct: 45,
      callsMade: 50,
      productiveCalls: 40,
      strikeRatePct: 80,
      daysWorked: 10,
    });
  });

  it("never exposes a currency amount or a target value", () => {
    const text = JSON.stringify(rows);
    for (const secret of ["90000", "200000", "100000", "50000", "20000"]) expect(text).not.toContain(secret);
    for (const row of rows) expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["revenue", "monthTarget", "targetToDate"]));
  });

  it("says 0% of pace for a rep with a target and no sales, and null when nothing can be measured", () => {
    expect(byCode["102"]).toMatchObject({ revenueVsPacePct: 0, revenueVsMonthPct: 0, volumeCases: null, strikeRatePct: null });
    expect(byCode["101"]).toMatchObject({ revenueVsPacePct: null, revenueVsMonthPct: null, strikeRatePct: null, callsMade: 0 });
  });
});

describe("periods", () => {
  it("lists the current month then the previous one, across a year boundary", () => {
    expect(recentPeriods(new Date("2026-10-15T08:00:00Z"), 2)).toEqual(["2026-10", "2026-09"]);
    expect(recentPeriods(new Date("2026-01-03T08:00:00Z"), 2)).toEqual(["2026-01", "2025-12"]);
  });

  it("includes data up to today for the current month and to the month's end for a past one", () => {
    const now = new Date("2026-10-15T08:00:00Z");
    expect(asOfDate("2026-10", now)).toBe("2026-10-15");
    expect(asOfDate("2026-09", now)).toBe("2026-09-30");
    expect(asOfDate("2026-02", new Date("2026-03-01T00:00:00Z"))).toBe("2026-02-28");
  });
});
