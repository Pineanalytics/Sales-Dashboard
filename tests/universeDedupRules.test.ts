import { describe, expect, it } from "vitest";
import { DEFAULT_DEDUP, STRICT_DEDUP } from "../lib/universeAnalysis/config";
import { deduplicate } from "../lib/universeAnalysis/dedup";
import type { ExtractRow } from "../lib/universeAnalysis/types";

const M_PER_DEG_LAT = 110_540;

/** An outlet row at a given distance (metres, due north) from the origin point. */
function row(id: string, outlet: string, metresNorth: number, overrides: Partial<ExtractRow> = {}): ExtractRow {
  return {
    source: "Pine", outletId: id, outlet, principal: "Mars-Nairobi", routeClass: "Primary Sales", channel: "Retail", segment: "Retailers", region: "Nairobi", territory: "Kayole", route: null, rep: null,
    lat: -1.28 + metresNorth / M_PER_DEG_LAT, lon: 36.9, lastPurchase: null, daysSince: 5, sales: 1000, avgSales: null, tx: 10, buyingSince: null, monthsBuying: null, tenure: null, periods3: null,
    consistency: null, tier: null, combinedAvg: null, bought30: null, matchId: null, matchConf: null, teamLeader: null, repRegion: null, repSubregion: null, calls: null, productive: null,
    strike: null, callsRecent: null, productiveRecent: null, principalStrike: null, recKey: `PINE-${id}`, isDirect: true, ...overrides,
  };
}

const sizeOf = (rows: ExtractRow[], rules = DEFAULT_DEDUP) => new Set(deduplicate(rows, rules).records.map((r) => r.masterId)).size;

describe("de-duplication of the same outlet registered twice", () => {
  const pair = (metres: number, a = "Gitero Shop", b = "Gitero Shop", segB = "Retailers") => [row("1", a, 0), row("2", b, metres, { segment: segB })];

  it("keeps merging identical names within 30 m", () => {
    expect(sizeOf(pair(20))).toBe(1);
    expect(sizeOf(pair(20), STRICT_DEDUP)).toBe(1);
  });

  it("now merges identical names up to 60 m apart, which the strict rules left for review", () => {
    expect(sizeOf(pair(45))).toBe(1);
    expect(sizeOf(pair(45), STRICT_DEDUP)).toBe(2);
    expect(deduplicate(pair(45)).records[0].confidence).toBe("Medium");
  });

  it("does not merge identical names further apart than that", () => {
    expect(sizeOf(pair(75))).toBe(2);
  });

  it("does not merge a wholesaler with a retailer of the same name", () => {
    expect(sizeOf([row("1", "Gitero Shop", 0, { segment: "Wholesalers" }), row("2", "Gitero Shop", 45)])).toBe(2);
  });

  it("does not merge a common name, which is likely a different shop", () => {
    // 45 outlets whose names start with "Baraka": a very common first word.
    const crowd = Array.from({ length: 45 }, (_, i) => row(String(100 + i), `Baraka Place ${i}${"x".repeat(i % 3)}`, 2000 + i * 500));
    expect(sizeOf([row("1", "Baraka Mini", 0), row("2", "Baraka Mini", 45), ...crowd]) - crowd.length).toBe(2);
  });

  it("does not merge branch numbers or labels", () => {
    expect(sizeOf(pair(45, "Mama Shop 1", "Mama Shop 2"))).toBe(2);
    expect(sizeOf(pair(45, "Mama Shop Upper", "Mama Shop Lower"))).toBe(2);
  });

  it("merges the same letters written with different spacing, case or punctuation", () => {
    expect(sizeOf(pair(25, "Home Care Shop", "Homecare Shop"))).toBe(1);
    expect(sizeOf(pair(45, "J Kare Pharmacy", "J-KARE PHARMACY"))).toBe(1);
    expect(sizeOf(pair(34, "Sunshop", "Sun Shop"))).toBe(1);
    expect(sizeOf(pair(80, "Sunshop", "Sun Shop"))).toBe(2);
  });

  it("merges a near-identical spelling within 45 m", () => {
    expect(sizeOf(pair(40, "Kamau Wa Njoroge", "Kamau Wa Njoroge A"))).toBe(2); // a lone letter is a branch label
    expect(sizeOf(pair(40, "Wangechi Kiosk Annex", "Wangechi Kiosk Anex"))).toBe(2); // annex is a branch word
    expect(sizeOf(pair(40, "Kitonyoni Mwanzo", "Kitonyoni Mwanso"))).toBe(1);
    expect(sizeOf(pair(40, "Kitonyoni Mwanzo", "Kitonyoni Mwanso"), STRICT_DEDUP)).toBe(2);
  });
});
