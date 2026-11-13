import { describe, expect, it } from "vitest";
import {
  bucketKey,
  daysInRange,
  growthPct,
  isIsoDate,
  previousPeriod,
  proratedTarget,
  rangeBuckets,
  rangePresets,
  sameDatesLastYear,
  seriesByBucket,
  sumRange,
  targetDates,
  totalsByPrincipal,
  weekStart,
} from "@/lib/salesRange";

describe("date range basics", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-11-13")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("13/11/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("counts days and finds comparison periods", () => {
    expect(daysInRange("2026-11-01", "2026-11-13")).toBe(13);
    expect(previousPeriod("2026-11-01", "2026-11-13")).toEqual({ from: "2026-10-19", to: "2026-10-31" });
    expect(sameDatesLastYear("2024-02-29", "2024-03-05")).toEqual({ from: "2023-02-28", to: "2023-03-05" });
  });

  it("weeks run Monday to Sunday", () => {
    expect(weekStart("2026-11-13")).toBe("2026-11-09"); // Friday -> Monday
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday -> same week's Monday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(bucketKey("2026-11-13", "month")).toBe("2026-11");
  });

  it("builds buckets that cover the range, empty ones included", () => {
    const weeks = rangeBuckets({ from: "2026-11-01", to: "2026-11-13", groupBy: "week" });
    expect(weeks.map((b) => b.key)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(weeks[0].dates).toEqual(["2026-11-01"]);
    expect(weeks[2].label).toBe("Wk of 9 Nov");
  });
});

describe("totals and series", () => {
  const rows = [
    { date: "2026-11-02", principal: "Suntory-Nairobi", revenue: 100, grossProfit: 20 },
    { date: "2026-11-03", principal: "Mars-Nairobi", revenue: 300, grossProfit: 30 },
    { date: "2026-11-10", principal: "Suntory-Nairobi", revenue: 50, grossProfit: 10 },
  ];

  it("sums revenue and margin", () => {
    expect(sumRange(rows)).toEqual({ revenue: 450, grossProfit: 60, grossMarginPct: (60 / 450) * 100 });
    expect(sumRange([]).grossMarginPct).toBeNull();
  });

  it("groups by bucket and by principal", () => {
    const series = seriesByBucket(rows, { from: "2026-11-01", to: "2026-11-13", groupBy: "week" });
    expect(series.map((b) => b.revenue)).toEqual([0, 400, 50]);
    expect(totalsByPrincipal(rows).map((r) => [r.principal, r.revenue])).toEqual([["Mars-Nairobi", 300], ["Suntory-Nairobi", 150]]);
  });

  it("measures growth, without dividing by zero", () => {
    expect(growthPct(120, 100)).toBe(20);
    expect(growthPct(80, 100)).toBe(-20);
    expect(growthPct(80, 0)).toBeNull();
    expect(growthPct(80, null)).toBeNull();
  });
});

describe("pro-rated targets", () => {
  // November 2026: 30 days, 21 working days (Mon–Fri, no public holiday).
  const targets = [
    { year: "2026", monthIndex: 10, target: 2_100_000 },
    { year: "2026", monthIndex: 10, target: null },
  ];

  it("gives each working day an equal share of the month's target", () => {
    const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    expect(proratedTarget(targets, week)).toBeCloseTo(500_000, 0); // 5 working days of 21
  });

  it("never invents a target for a month without one", () => {
    expect(proratedTarget(targets, ["2026-12-01"])).toBeNull();
  });

  it("covers dates up to today only", () => {
    expect(targetDates({ from: "2026-11-10", to: "2026-11-20" }, "2026-11-13")).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(targetDates({ from: "2026-12-01", to: "2026-12-05" }, "2026-11-13")).toEqual([]);
  });
});

describe("quick ranges", () => {
  it("are anchored on today", () => {
    const presets = Object.fromEntries(rangePresets("2026-11-13").map((p) => [p.id, [p.from, p.to]]));
    expect(presets["this-week"]).toEqual(["2026-11-09", "2026-11-13"]);
    expect(presets["last-week"]).toEqual(["2026-11-02", "2026-11-08"]);
    expect(presets["last-month"]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(presets["this-quarter"]).toEqual(["2026-10-01", "2026-11-13"]);
    expect(presets["ytd"]).toEqual(["2026-01-01", "2026-11-13"]);
  });
});
