import { describe, it, expect } from "vitest";
import {
  getMondaysInMonth,
  getWeeksInMonth,
  diffMissingGridRows,
  sumWeeklyTargetsByPrincipalMonth,
  classifyMonthlyVariance,
  type WeekInfo,
} from "../lib/weeklyTargets";
import { computeSharePcts, computeWeekdayWeights } from "../lib/repContribution";

describe("getMondaysInMonth / getWeeksInMonth", () => {
  it("returns every real Monday in the month, not a fixed count", () => {
    // April 2026: Mondays fall on 6, 13, 20, 27 — exactly 4, not the source
    // workbook's hardcoded 5.
    const mondays = getMondaysInMonth(2026, 3);
    expect(mondays.map((d) => d.getUTCDate())).toEqual([6, 13, 20, 27]);
  });

  it("labels weeks sequentially with the month abbreviation", () => {
    const weeks = getWeeksInMonth(2026, 3);
    expect(weeks.map((w) => w.weekLabel)).toEqual(["Apr Week 1", "Apr Week 2", "Apr Week 3", "Apr Week 4"]);
    expect(weeks[0].monthLabel).toBe("April");
    expect(weeks[0].year).toBe("2026");
  });

  it("handles a 5-Monday month", () => {
    // June 2026: Mondays fall on 1, 8, 15, 22, 29.
    const weeks = getWeeksInMonth(2026, 5);
    expect(weeks).toHaveLength(5);
    expect(weeks[4].weekLabel).toBe("Jun Week 5");
  });
});

describe("diffMissingGridRows", () => {
  const weeks: WeekInfo[] = [
    { year: "2026", monthLabel: "April", weekLabel: "Apr Week 1", weekStartDate: new Date("2026-04-06T00:00:00.000Z") },
    { year: "2026", monthLabel: "April", weekLabel: "Apr Week 2", weekStartDate: new Date("2026-04-13T00:00:00.000Z") },
  ];

  it("creates a row for every pair x week when nothing exists yet", () => {
    const rows = diffMissingGridRows([{ teamLeaderId: "tl1", principal: "Bic-Nairobi" }], weeks, []);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.weekLabel)).toEqual(["Apr Week 1", "Apr Week 2"]);
  });

  it("skips combos that already have a row", () => {
    const rows = diffMissingGridRows(
      [{ teamLeaderId: "tl1", principal: "Bic-Nairobi" }],
      weeks,
      [{ teamLeaderId: "tl1", principal: "Bic-Nairobi", weekStartDate: new Date("2026-04-06T00:00:00.000Z") }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].weekLabel).toBe("Apr Week 2");
  });

  it("treats different team leaders on the same principal as independent grids", () => {
    const rows = diffMissingGridRows(
      [
        { teamLeaderId: "tl1", principal: "Bic-Nairobi" },
        { teamLeaderId: "tl2", principal: "Bic-Nairobi" },
      ],
      weeks,
      [{ teamLeaderId: "tl1", principal: "Bic-Nairobi", weekStartDate: new Date("2026-04-06T00:00:00.000Z") }]
    );
    // tl1 is missing 1 week, tl2 is missing both.
    expect(rows).toHaveLength(3);
  });
});

describe("sumWeeklyTargetsByPrincipalMonth", () => {
  it("sums across team leaders serving the same principal", () => {
    const map = sumWeeklyTargetsByPrincipalMonth([
      { principal: "Bic-Nairobi", monthLabel: "April", targetValue: 10000 },
      { principal: "Bic-Nairobi", monthLabel: "April", targetValue: 5000 },
      { principal: "Bic-Nairobi", monthLabel: "May", targetValue: 9999 },
      { principal: "Mars-Nairobi", monthLabel: "April", targetValue: 2000 },
    ]);
    expect(map.get("Bic-Nairobi|April")).toBe(15000);
    expect(map.get("Bic-Nairobi|May")).toBe(9999);
    expect(map.get("Mars-Nairobi|April")).toBe(2000);
  });

  it("returns an empty map for no rows", () => {
    expect(sumWeeklyTargetsByPrincipalMonth([]).size).toBe(0);
  });
});

describe("classifyMonthlyVariance", () => {
  it("flags no-target when the admin hasn't set a Monthly Target", () => {
    expect(classifyMonthlyVariance(null, 15000)).toBe("no-target");
  });

  it("matches within a 1-unit rounding tolerance", () => {
    expect(classifyMonthlyVariance(15000, 15000)).toBe("match");
    expect(classifyMonthlyVariance(15000, 15000.4)).toBe("match");
    expect(classifyMonthlyVariance(15000, 14999.6)).toBe("match");
  });

  it("flags variance just outside the tolerance", () => {
    expect(classifyMonthlyVariance(15000, 15001)).toBe("variance");
    expect(classifyMonthlyVariance(15000, 12000)).toBe("variance");
  });
});

describe("computeSharePcts", () => {
  it("splits proportionally to revenue", () => {
    const shares = computeSharePcts(new Map([["A", 300], ["B", 100]]));
    expect(shares.get("A")).toBeCloseTo(0.75);
    expect(shares.get("B")).toBeCloseTo(0.25);
  });

  it("falls back to an even split when every rep is at 0 revenue", () => {
    const shares = computeSharePcts(new Map([["A", 0], ["B", 0], ["C", 0]]));
    expect(shares.get("A")).toBeCloseTo(1 / 3);
    expect(shares.get("B")).toBeCloseTo(1 / 3);
    expect(shares.get("C")).toBeCloseTo(1 / 3);
  });

  it("gives a single rep 100% regardless of their revenue figure", () => {
    const shares = computeSharePcts(new Map([["A", 4200]]));
    expect(shares.get("A")).toBe(1);
  });

  it("floors negative revenue at 0 rather than letting it skew shares negative", () => {
    const shares = computeSharePcts(new Map([["A", 500], ["B", -50]]));
    expect(shares.get("A")).toBe(1);
    expect(shares.get("B")).toBe(0);
  });
});

describe("computeWeekdayWeights", () => {
  it("uses Layer 1 (Detail productive-visit counts) when there's enough signal", () => {
    // 2 Mon, 4 Tue, 4 Thu = 10 total, well above the 3-visit floor.
    const weights = computeWeekdayWeights([2, 4, 0, 4, 0], [0, 0, 0, 0, 0]);
    expect(weights[0]).toBeCloseTo(0.2);
    expect(weights[1]).toBeCloseTo(0.4);
    expect(weights[3]).toBeCloseTo(0.4);
    expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1);
  });

  it("falls back to Layer 2 (Daily total-visit counts) when Detail is too thin", () => {
    // Only 2 productive visits recorded (below the 3-visit floor) — e.g. rep
    // was on leave most of the week — so Daily's fuller history wins instead.
    const weights = computeWeekdayWeights([1, 1, 0, 0, 0], [5, 5, 5, 5, 0]);
    expect(weights[0]).toBeCloseTo(0.25);
    expect(weights[4]).toBe(0);
  });

  it("falls back to an even split when neither source has any history", () => {
    const weights = computeWeekdayWeights([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
    expect(weights).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
  });

  it("boundary: exactly 3 Detail visits still counts as Layer 1, not a fallback", () => {
    const weights = computeWeekdayWeights([3, 0, 0, 0, 0], [0, 0, 0, 0, 100]);
    expect(weights[0]).toBe(1);
    expect(weights[4]).toBe(0);
  });
});
