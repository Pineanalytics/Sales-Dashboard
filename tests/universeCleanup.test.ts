import { describe, expect, it } from "vitest";
import { locationStatsFromRows, withCleanup, type CleanupInput } from "../lib/outletUniverse/cleanup";

const M_PER_DEG_LAT = 110_540;

function row(overrides: Partial<CleanupInput> & { outletKey: string; outletName: string }): CleanupInput {
  return {
    source: "PINE", principal: "Mars-Nairobi", salesRole: "Primary Sales", channel: "Retail", segment: "Retailers", region: "Nairobi", territory: "Kayole", route: null, repName: null,
    latitude: -1.28, longitude: 36.9, lastPurchaseDate: new Date("2026-10-01"), sales: 1000, transactions: 10, matchId: null, matchConfidence: null,
    ...overrides,
  };
}

/** `n` outlets of a territory name scattered around a point, so the territory has a centre and a spread. */
function territory(name: string, lat: number, lon: number, n: number): CleanupInput[] {
  return Array.from({ length: n }, (_, i) => row({ outletKey: `${name}-${i}`, outletName: `Shop ${name} ${i} ${"abcdefghij"[i % 10]}${i}`, territory: name, latitude: lat + ((i % 5) - 2) * 0.001, longitude: lon + ((Math.floor(i / 5) % 5) - 2) * 0.001 }));
}

describe("the universe cleanup", () => {
  const rows: CleanupInput[] = [
    ...territory("Kitui - MBSR", -1.3667, 38.0106, 40),
    ...territory("Kitui", -1.3668, 38.0105, 30),
    ...territory("Nairobi-Kitui", -1.3665, 38.0108, 5),
    ...territory("Babadogo", -1.2650, 36.8750, 60),
    row({ outletKey: "BD1", outletName: "Corner Fresh", territory: "Baba Dogo", latitude: -1.2651, longitude: 36.8751 }),
    // The same shop registered twice in Pine, 40 m apart, then in Leverage too (matched by the extract's match id), and a same-name shop far away.
    row({ outletKey: "100", outletName: "Gitero Stores", territory: "Kitui", latitude: -1.3670, longitude: 38.0100 }),
    row({ outletKey: "101", outletName: "Gitero Stores", territory: "Kitui - MBSR", latitude: -1.3670 + 40 / M_PER_DEG_LAT, longitude: 38.0100, sales: 50 }),
    row({ source: "LEVERAGE", outletKey: "T1", outletName: "Gitero Shop Kitui", territory: "Nairobi-Kitui", latitude: null, longitude: null, principal: "Unilever-Nairobi", matchId: "M-1", matchConfidence: "High" }),
    row({ outletKey: "100", outletName: "Gitero Stores", territory: "Kitui", latitude: -1.3670, longitude: 38.0100, principal: "Suntory-Nairobi", matchId: "M-1", matchConfidence: "High" }),
    row({ outletKey: "200", outletName: "Gitero Stores", territory: "Kayole", latitude: -1.2700, longitude: 36.9200 }),
  ];
  const cleaned = withCleanup(rows, new Date("2026-10-26"));
  const get = (source: string, key: string) => cleaned.filter((r) => r.source === source && r.outletKey === key);

  it("unifies the territory spellings, typos included, on every row", () => {
    expect(new Set(cleaned.filter((r) => ["Kitui - MBSR", "Kitui", "Nairobi-Kitui"].includes(r.territory)).map((r) => r.territoryClean))).toEqual(new Set(["Kitui"]));
    expect(cleaned.find((r) => r.territory === "Baba Dogo")?.territoryClean).toBe("Babadogo");
    expect(cleaned.find((r) => r.territory === "Kayole")?.territoryClean).toBe("Kayole");
  });

  it("gives outlets that are the same shop one shop id, the master's", () => {
    const [a] = get("PINE", "100");
    const [b] = get("PINE", "101");
    const [c] = get("LEVERAGE", "T1");
    expect(a.shopId).toBe("PINE-100");
    expect(b.shopId).toBe("PINE-100"); // same name 40 m apart: the loosened same-name rule
    expect(c.shopId).toBe("PINE-100"); // matched in another system by the extract's match id
    expect([a.shopSize, b.shopSize, c.shopSize]).toEqual([3, 3, 3]);
    expect(a.shopConfidence).toBeTruthy();
  });

  it("puts every principal row of an outlet in its shop, and leaves a distant namesake alone", () => {
    expect(get("PINE", "100").map((r) => r.shopId)).toEqual(["PINE-100", "PINE-100"]);
    const [far] = get("PINE", "200");
    expect(far).toMatchObject({ shopId: "PINE-200", shopSize: 1, shopConfidence: null });
  });

  it("counts a territory's rows, GPS rows and map cells", () => {
    const stats = locationStatsFromRows(rows);
    const kitui = stats.find((s) => s.name === "Kitui")!;
    expect(kitui.rows).toBe(30 + 2); // 30 scattered outlets + Gitero 100 (one row per principal)
    expect(kitui.gps).toBeGreaterThan(0);
    expect(kitui.sources).toEqual(["PINE"]);
    expect(kitui.cells.size).toBeGreaterThan(1);
    expect(stats.find((s) => s.name === "Nairobi-Kitui")!.sources).toEqual(["LEVERAGE", "PINE"]);
  });

  it("handles an empty universe", () => {
    expect(withCleanup([])).toEqual([]);
  });
});
