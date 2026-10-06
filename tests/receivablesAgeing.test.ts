import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    receivablesAgeingSnapshot: {
      findMany: vi.fn(async () => [
        { snapshotDate: new Date(Date.UTC(2026, 7, 1)), current: 1, days30: 1, days60: 1, days90: 1, daysOver90: 1, isApproximate: false },
        { snapshotDate: new Date(Date.UTC(2026, 8, 30)), current: 1, days30: 2, days60: 3, days90: 4, daysOver90: 5, isApproximate: false },
        { snapshotDate: new Date(Date.UTC(2026, 9, 5)), current: 10, days30: 20, days60: 30, days90: 40, daysOver90: 50, isApproximate: false },
      ]),
    },
  },
}));

import { getAgeingSnapshotForMonth } from "../lib/receivablesAgeing";

describe("getAgeingSnapshotForMonth blankWeeksNotElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 6, 9, 0, 0))); // Tue 6 Oct 2026
  });
  afterEach(() => vi.useRealTimers());

  it("repeats the latest snapshot on weeks still to come by default", async () => {
    const trend = await getAgeingSnapshotForMonth(2026, 9);
    expect(trend.weeks.length).toBeGreaterThan(1);
    expect(trend.weeks.every((week) => week.buckets !== null)).toBe(true);
  });

  it("leaves weeks that have not finished blank when asked, keeping the opening balance", async () => {
    const trend = await getAgeingSnapshotForMonth(2026, 9, { blankWeeksNotElapsed: true });
    expect(trend.lastMonth.buckets).not.toBeNull();
    // October 2026's first week (Sun 27 Sep - Sat 3 Oct) has finished; every later week has not.
    expect(trend.weeks[0].buckets).not.toBeNull();
    expect(trend.weeks.slice(1).every((week) => week.buckets === null && week.snapshotDate === null)).toBe(true);
  });

  it("keeps the weeks of a closed month", async () => {
    const trend = await getAgeingSnapshotForMonth(2026, 8, { blankWeeksNotElapsed: true });
    expect(trend.weeks.every((week) => week.buckets !== null)).toBe(true);
  });
});
