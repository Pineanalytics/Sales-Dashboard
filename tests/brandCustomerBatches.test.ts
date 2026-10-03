import { describe, it, expect } from "vitest";
import { groupByMonth, monthRange, parseMonthArg, planMonthReads, trailingMonths } from "../scripts/db-bridge/transform/brandCustomerBatches";

describe("brand-customer batch planning", () => {
  it("parses YYYY-MM and rejects malformed values", () => {
    expect(parseMonthArg("2026-09")).toEqual({ year: 2026, monthIndex: 8 });
    expect(parseMonthArg("2026-13")).toBeNull();
    expect(parseMonthArg("26-09")).toBeNull();
    expect(parseMonthArg(undefined)).toBeNull();
  });

  it("builds an inclusive month range across a year boundary", () => {
    const months = monthRange({ year: 2025, monthIndex: 10 }, { year: 2026, monthIndex: 1 });
    expect(months.map((m) => `${m.year}-${m.monthIndex + 1}`)).toEqual(["2025-11", "2025-12", "2026-1", "2026-2"]);
  });

  it("takes the trailing N months ending at the as-of month", () => {
    const months = trailingMonths(new Date("2026-02-10T00:00:00Z"), 3);
    expect(months.map((m) => `${m.year}-${m.monthIndex + 1}`)).toEqual(["2025-12", "2026-1", "2026-2"]);
    expect(trailingMonths(new Date("2026-10-03T00:00:00Z"), 1)).toEqual([{ year: 2026, monthIndex: 9 }]);
  });

  it("reads each month once, serving both years from the as-of-year window", () => {
    const reads = planMonthReads(
      [
        { year: 2025, monthIndex: 1 },
        { year: 2026, monthIndex: 1 },
        { year: 2026, monthIndex: 2 },
        { year: 2024, monthIndex: 5 },
      ],
      2026
    );
    expect(reads).toEqual([
      { monthIndex: 1, start: "2026-02-01", end: "2026-02-28", years: [2025, 2026] },
      { monthIndex: 2, start: "2026-03-01", end: "2026-03-31", years: [2026] },
    ]);
  });

  it("splits rows into one batch per month", () => {
    const rows = [
      { year: 2026, monthIndex: 0, v: 1 },
      { year: 2026, monthIndex: 1, v: 2 },
      { year: 2026, monthIndex: 0, v: 3 },
    ];
    const groups = groupByMonth(rows, (r) => ({ year: r.year, monthIndex: r.monthIndex }));
    expect(groups.size).toBe(2);
    expect(groups.get("2026|0")?.rows.map((r) => r.v)).toEqual([1, 3]);
  });
});
