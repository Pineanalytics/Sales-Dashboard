import { describe, expect, it } from "vitest";
import { dailyKey, freezeCosts, isClosedDay, isClosedMonth, monthlyKey, monthlyRepKey, recordRatios, type CostRatioMap } from "../scripts/db-bridge/transform/freezeClosedMonthCosts";

const asOf = new Date("2026-10-05T08:00:00Z");

describe("freezing closed-month costs", () => {
  it("treats only months before the as-of month as closed", () => {
    expect(isClosedMonth(2026, 8, asOf)).toBe(true); // September
    expect(isClosedMonth(2025, 11, asOf)).toBe(true);
    expect(isClosedMonth(2026, 9, asOf)).toBe(false); // October, the live month
    expect(isClosedMonth(2026, 10, asOf)).toBe(false);
    expect(isClosedDay("2026-09-30", asOf)).toBe(true);
    expect(isClosedDay("2026-10-01", asOf)).toBe(false);
  });

  it("keeps the stored margin and applies it to the refreshed revenue", () => {
    const ratios: CostRatioMap = new Map();
    recordRatios(ratios, "2026|June|Unilever-Nairobi", { revenue: 7_475_807, cogs: 6_000_000, grossProfit: 674_718 });
    const rows = [{ year: "2026", month: "June", principal: "Unilever-Nairobi", revenue: 8_000_000, cogs: 18_000_000, grossProfit: -10_169_085 }];
    const frozen = freezeCosts(rows, monthlyKey, () => true, ratios);
    expect(frozen).toBe(1);
    expect(rows[0].grossProfit / rows[0].revenue).toBeCloseTo(674_718 / 7_475_807, 10);
    expect(rows[0].cogs / rows[0].revenue).toBeCloseTo(6_000_000 / 7_475_807, 10);
    expect(rows[0].revenue).toBe(8_000_000); // revenue is never touched
  });

  it("leaves rows alone when the month is open, nothing is stored, or stored revenue was zero", () => {
    const ratios: CostRatioMap = new Map();
    recordRatios(ratios, "2026|June|A", { revenue: 100, cogs: 90, grossProfit: 10 });
    recordRatios(ratios, "2026|June|Zero", { revenue: 0, cogs: 5, grossProfit: 5 });
    expect(ratios.has("2026|June|Zero")).toBe(false);

    const open = [{ year: "2026", month: "June", principal: "A", revenue: 200, cogs: 150, grossProfit: 50 }];
    expect(freezeCosts(open, monthlyKey, () => false, ratios)).toBe(0);
    expect(open[0]).toMatchObject({ cogs: 150, grossProfit: 50 });

    const unknown = [{ year: "2026", month: "June", principal: "Brand new", revenue: 200, cogs: 150, grossProfit: 50 }];
    expect(freezeCosts(unknown, monthlyKey, () => true, ratios)).toBe(0);
    expect(unknown[0]).toMatchObject({ cogs: 150, grossProfit: 50 });
  });

  it("builds distinct keys for each table's grain", () => {
    expect(monthlyKey({ year: "2026", month: "June", principal: "Mars-Nairobi" })).toBe("2026|June|Mars-Nairobi");
    expect(monthlyRepKey({ year: "2026", month: "June", principal: "Mars-Nairobi", sapName: "Jane" })).toBe("2026|June|Mars-Nairobi|Jane");
    expect(dailyKey({ date: "2026-06-03", principal: "Mars-Nairobi", location: "Nairobi" })).toBe("2026-06-03|Mars-Nairobi|Nairobi");
  });
});
