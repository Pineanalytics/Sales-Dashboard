import { describe, expect, it } from "vitest";
import { FEED_MAX_PAGE_SIZE, mergeHistory, paginate } from "../lib/universeFeed";
import { buildMonthlyStrike } from "../lib/universeAnalysis/monthlyStrike";

describe("universe feed paging", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);

  it("walks every row exactly once by following the cursor", () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { rows: number[]; total: number; nextCursor: string | null } = paginate(rows, cursor, 10);
      seen.push(...page.rows);
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null);
    expect(seen).toEqual(rows);
    expect(pages).toBe(3);
  });

  it("reports the total and ends with a null cursor", () => {
    const last = paginate(rows, "20", 10);
    expect(last).toEqual({ rows: [20, 21, 22, 23, 24], total: 25, nextCursor: null });
  });

  it("ignores a malformed cursor, caps the page size and never returns an empty size", () => {
    expect(paginate(rows, "abc", 5).rows).toEqual([0, 1, 2, 3, 4]);
    expect(paginate(Array.from({ length: 5000 }, (_, i) => i), null, 99_999).rows).toHaveLength(FEED_MAX_PAGE_SIZE);
    expect(paginate(rows, null, 0).rows.length).toBeGreaterThan(0);
  });
});

describe("universe history", () => {
  const strike = buildMonthlyStrike(2026, [
    { source: "PINE", principal: "Mars-Nairobi", customerId: "C1", monthIndex: 8, calls: 2, productive: 1 },
    { source: "LEVERAGE", principal: "Unilever-Nairobi", customerId: "L1", monthIndex: 8, calls: 1, productive: null },
  ]);
  const history = mergeHistory(
    2026,
    [
      { source: "PINE", principal: "Mars-Nairobi", customerId: "C1", monthIndex: 8, sales: 1500.5, transactions: 3 },
      { source: "PINE", principal: "Mars-Nairobi", customerId: "C1", monthIndex: 9, sales: 700, transactions: 1 },
      { source: "LEVERAGE", principal: "Unilever-Nairobi", customerId: "L1", monthIndex: 8, sales: 900, transactions: 2 },
    ],
    strike
  );

  it("gives one row per source, principal and outlet, with the months that had activity", () => {
    const mars = history.find((h) => h.outletId === "C1");
    expect(mars?.principal).toBe("Mars-Nairobi");
    expect(Object.keys(mars?.months ?? {})).toEqual(["2026-09", "2026-10"]);
    expect(mars?.months["2026-09"]).toEqual({ sales: 1500.5, transactions: 3, calls: 2, productive: 1 });
    expect(mars?.months["2026-10"]).toEqual({ sales: 700, transactions: 1, calls: 0, productive: 0 }); // bought, not called by a rep that month
  });

  it("leaves productive null for Leverage, which records no call without a sale", () => {
    expect(history.find((h) => h.outletId === "L1")?.months["2026-09"]).toEqual({ sales: 900, transactions: 2, calls: 1, productive: null });
  });

  it("is sorted so paging by offset is stable", () => {
    expect(history.map((h) => h.outletId)).toEqual(["L1", "C1"]); // LEVERAGE < PINE
  });
});
