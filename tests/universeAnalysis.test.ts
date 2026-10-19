import { describe, expect, it } from "vitest";
import { cleanName } from "../lib/universeAnalysis/dedup";
import { applyFilters, concentration, coverageBy, coverageDetail, crossBuyMatrix, pyRound, summarise, universe } from "../lib/universeAnalysis/metrics";
import { sizeOpportunities, targetLists } from "../lib/universeAnalysis/opportunities";
import { recordKey, runPipeline } from "../lib/universeAnalysis/pipeline";
import { similarity } from "../lib/universeAnalysis/similarity";
import { tierOf } from "../lib/universeAnalysis/enrich";
import { buildMonthlyStrike, monthCounts, principalMonthStrike, windowCounts } from "../lib/universeAnalysis/monthlyStrike";
import type { ExtractRow } from "../lib/universeAnalysis/types";

function row(over: Partial<ExtractRow> & { outletId: string; outlet: string; principal: string }): ExtractRow {
  const base: ExtractRow = {
    source: "Pine", outletId: "", outlet: "", principal: "", routeClass: "Primary Sales", channel: "Retail", segment: "Retailers", region: "Nairobi", territory: "Kayole", route: null, rep: "R1",
    lat: -1.28, lon: 36.8, lastPurchase: "2026-10-10", daysSince: 9, sales: 1000, avgSales: 1000, tx: 1, buyingSince: "2026-01-02", monthsBuying: 9, tenure: "More than 6 months", periods3: 3,
    consistency: "Consistent", tier: "1,001 - 5,000", combinedAvg: 1000, bought30: "Yes", matchId: null, matchConf: null, teamLeader: "TL A", repRegion: "Nairobi", repSubregion: "Nairobi Metro",
    calls: 1, productive: 1, strike: 100, callsRecent: null, productiveRecent: null, principalStrike: 80, recKey: "", isDirect: true,
  };
  const merged = { ...base, ...over };
  return { ...merged, recKey: recordKey(merged.source, merged.outletId), isDirect: merged.routeClass === "Primary Sales" };
}

// The reference package's own synthetic test: the same shop twice in Pine 5 m apart must merge; ratios must be ratios of sums.
const extract: ExtractRow[] = [
  row({ outletId: "1", outlet: "Wamu Store", principal: "Suntory-Nairobi", rep: "R1", lat: -1.28, lon: 36.8, sales: 9000, tx: 9, daysSince: 9, calls: 10, productive: 9, strike: 90 }),
  row({ outletId: "2", outlet: "Wamu Shop", principal: "Weetabix-Nairobi", rep: "R2", lat: -1.28004, lon: 36.80002, sales: 1000, tx: 1, daysSince: 40, calls: 4, productive: 1, strike: 25 }),
  row({ outletId: "3", outlet: "Baraka Kiosk", principal: "Mars-Nairobi", routeClass: "Secondary Sales", rep: "D1", lat: -1.3, lon: 36.9, sales: 500, tx: 5, daysSince: 3, calls: 5, productive: 5, strike: 100 }),
];

describe("universe analysis: de-duplication and ratios", () => {
  const result = runPipeline(extract);

  it("merges the same shop registered twice and counts outlets on the master id", () => {
    expect(new Set(result.fact.map((f) => f.masterId)).size).toBe(2); // 3 records -> 2 outlets
    expect(result.records.filter((r) => !r.isMaster)).toHaveLength(1);
  });

  it("computes strike as a ratio of sums and the average invoice as sales over invoices", () => {
    const s = summarise(result.fact)[0];
    expect(s.strikeRate).toBeCloseTo(15 / 19, 9); // not the mean of row strike rates
    expect(s.avgInvoice).toBeCloseTo(10500 / 15, 9); // not a sum of averages
  });

  it("filters by route class and classifies the coverage route of each outlet", () => {
    const secondary = applyFilters(result.fact, { route_class: ["Secondary Sales"] });
    expect(new Set(secondary.map((f) => f.masterId)).size).toBe(1);
    expect(new Set(result.fact.map((f) => f.coverageRoute))).toEqual(new Set(["Direct only", "Distributor only"]));
  });

  it("reports direct reach over the unique universe", () => {
    const u = universe(result.fact);
    expect(u.uniqueOutlets).toBe(2);
    expect(u.directReach).toBeCloseTo(0.5, 9);
    expect(coverageBy(result.fact, "segment")[0].universe).toBe(2);
    expect(coverageDetail(result.fact, "segment")[0].status).toBe("Partial");
  });
});

describe("universe analysis: building blocks", () => {
  it("rounds halves to even like the reference implementation", () => {
    expect([0.5, 1.5, 2.5, 3.5].map(pyRound)).toEqual([0, 2, 2, 4]);
  });

  it("measures name similarity as the normalised longest common subsequence", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("wamu", "wamu store")).toBeCloseTo(8 / 14, 9);
  });

  it("strips filler words and punctuation before matching names", () => {
    const filler = "\\b(shop|store|ltd|limited)\\b";
    expect(cleanName("Wamu's Store Ltd.", filler)).toBe("wamus");
  });

  it("tiers on the true average invoice by channel", () => {
    expect(tierOf(450, "Retail")).toBe("500 & Below");
    expect(tierOf(500, "Retail")).toBe("500 & Below");
    expect(tierOf(4999, "Retail")).toBe("1,001 - 5,000");
    expect(tierOf(60000, "Wholesale")).toBe("Above 50,000");
    expect(tierOf(null, "Wholesale")).toBe("5,000 & Below");
  });

  it("sizes the share of sales of the top outlets", () => {
    const rows = runPipeline(extract).fact;
    expect(concentration(rows)[0].shareOfSales).toBeGreaterThan(0.5);
  });

  it("keeps cross-buy to direct outlets and returns a square matrix", () => {
    const x = crossBuyMatrix(runPipeline(extract).fact, ["Suntory-Nairobi", "Weetabix-Nairobi", "Mars-Nairobi"]);
    expect(x.principals).toEqual(["Suntory-Nairobi", "Weetabix-Nairobi"]); // Mars is distributor-only
    expect(x.matrix[0][1]).toBe(1); // the merged outlet buys both
  });
});

describe("universe analysis: opportunities and target lists", () => {
  const result = runPipeline(extract);

  it("returns pools and a total without dividing by an empty benchmark", () => {
    const opp = sizeOpportunities(result.fact);
    expect(opp.totalNewRevenue).toBe(opp.distributorToDirect.annualValue + opp.crossSell.annualValue + opp.frequency.annualValue);
    expect(opp.unproductiveCalls.pool).toBe(4);
  });

  it("names the outlets to convert and to win back", () => {
    const targets = targetLists(result.fact, 10);
    expect(targets.some((t) => t.action === "Convert to direct")).toBe(true);
    expect(targets.find((t) => t.action === "Win back (lapsing)")?.why).toMatch(/No purchase for/);
  });

  it("flags low strike from the trailing three months only", () => {
    const quiet = runPipeline([
      row({ outletId: "9", outlet: "Chronic Shop", principal: "Mars-Nairobi", callsRecent: 3, productiveRecent: 0, calls: 1, productive: 0, strike: 0 }),
      row({ outletId: "10", outlet: "One Off Shop", principal: "Mars-Nairobi", lat: -1.5, lon: 36.5, callsRecent: 1, productiveRecent: 0, calls: 1, productive: 0, strike: 0 }),
    ]);
    const fix = targetLists(quiet.fact, 10).filter((t) => t.action === "Fix strike rate");
    expect(fix.map((t) => t.outlet)).toEqual(["Chronic Shop"]); // one call in the window is too thin to flag
  });
});

describe("universe analysis: monthly strike", () => {
  const data = buildMonthlyStrike(2026, [
    { source: "PINE", principal: "Mars-Nairobi", customerId: "C1", monthIndex: 7, calls: 1, productive: 1 },
    { source: "PINE", principal: "Mars-Nairobi", customerId: "C1", monthIndex: 8, calls: 1, productive: 0 },
    { source: "PINE", principal: "Mars-Nairobi", customerId: "C2", monthIndex: 8, calls: 1, productive: 1 },
    { source: "LEVERAGE", principal: "Unilever-Nairobi", customerId: "L1", monthIndex: 8, calls: 1, productive: null },
  ]);

  it("reads one month at a time, not the year to date", () => {
    expect(monthCounts(data, "PINE", "Mars-Nairobi", "C1", 7)).toEqual({ calls: 1, productive: 1 });
    expect(monthCounts(data, "PINE", "Mars-Nairobi", "C1", 8)).toEqual({ calls: 1, productive: 0 });
    expect(monthCounts(data, "PINE", "Mars-Nairobi", "C1", 5)).toEqual({ calls: 0, productive: 0 });
  });

  it("gives a principal's monthly strike over all its customers", () => {
    expect(principalMonthStrike(data, "PINE", "Mars-Nairobi", 8)).toBe(50); // C1 not productive, C2 productive
    expect(principalMonthStrike(data, "PINE", "Mars-Nairobi", 7)).toBe(100);
    expect(principalMonthStrike(data, "PINE", "Mars-Nairobi", 3)).toBeNull();
  });

  it("has calls but no productive measure for Leverage", () => {
    expect(monthCounts(data, "LEVERAGE", "Unilever-Nairobi", "L1", 8)).toEqual({ calls: 1, productive: null });
    expect(principalMonthStrike(data, "LEVERAGE", "Unilever-Nairobi", 8)).toBeNull();
  });

  it("sums a trailing window ending at the month", () => {
    expect(windowCounts(data, "PINE", "Mars-Nairobi", "C1", 8, 3)).toEqual({ calls: 2, productive: 1 });
  });
});
