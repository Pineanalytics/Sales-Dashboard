import { describe, expect, it } from "vitest";
import { distanceMetres, explainMatch, jaroWinkler, matchOutlets, normalizeName, type MatchInput } from "../lib/outletUniverse/matching";
import { flagCrossSystemMatches, type OutletUniverseRow } from "../lib/outletUniverse/rebuild";

const outlet = (id: string, source: string, name: string, lat: number | null, lon: number | null, over: Partial<MatchInput> = {}): MatchInput => ({
  id, source, name, location: "Nairobi", region: "Nairobi", territory: "Umoja", route: null, latitude: lat, longitude: lon, ...over,
});

// about 0.0001 degrees of latitude is 11 m
const near = (n: number) => -1.2800 + n * 0.0001;

describe("name and distance helpers", () => {
  it("normalises case, punctuation and the ampersand", () => {
    expect(normalizeName("Wa Denis' Shop & Stores!")).toBe("wa denis shop and stores");
  });

  it("measures metres between two points", () => {
    expect(distanceMetres(-1.28, 36.9, -1.28, 36.9)).toBe(0);
    expect(Math.round(distanceMetres(-1.28, 36.9, -1.2801, 36.9))).toBe(11);
  });

  it("scores near-identical words high and different words low", () => {
    expect(jaroWinkler("supermarket", "supermarkt")).toBeGreaterThan(0.93);
    expect(jaroWinkler("kairo", "bidii")).toBeLessThan(0.6);
  });
});

describe("matchOutlets", () => {
  it("matches the same shop in two systems when the name agrees and the points are close", () => {
    const groups = matchOutlets([outlet("PINE|1", "PINE", "Razak Shop", near(0), 36.9), outlet("UPFIELD|9", "UPFIELD", "Razak", near(1), 36.9)]);
    const a = groups.get("PINE|1")!;
    expect(a.matchId).toBe(groups.get("UPFIELD|9")!.matchId);
    expect(a.sources).toEqual(["PINE", "UPFIELD"]);
    expect(a.confidence).toBe("High");
  });

  it("does not match different names at the same spot", () => {
    const groups = matchOutlets([outlet("PINE|1", "PINE", "Razak Shop", near(0), 36.9), outlet("UPFIELD|9", "UPFIELD", "Citadel Supermarket", near(0), 36.9)]);
    expect(groups.size).toBe(0);
  });

  it("does not match the same name far apart", () => {
    const groups = matchOutlets([outlet("PINE|1", "PINE", "Razak Shop", near(0), 36.9), outlet("UPFIELD|9", "UPFIELD", "Razak Shop", near(40), 36.9)]);
    expect(groups.size).toBe(0);
  });

  it("does not match two outlets in the same system", () => {
    const groups = matchOutlets([outlet("PINE|1", "PINE", "Razak Shop", near(0), 36.9), outlet("PINE|2", "PINE", "Razak Shop", near(1), 36.9)]);
    expect(groups.size).toBe(0);
  });

  it("does not let a shared landmark word match different shops", () => {
    const groups = matchOutlets([
      outlet("EABL|1", "EABL", "Miami Pub Ngangarithi", near(0), 36.9),
      outlet("LEVERAGE|2", "LEVERAGE", "Tabitha shop ngangarithi", near(1), 36.9),
      outlet("PINE|3", "PINE", "Ngangarithi", near(1), 36.9, { territory: "Bahati" }),
    ]);
    expect(groups.get("EABL|1")).toBeUndefined();
  });

  it("only matches a very common single word when the outlets are nearly on top of each other", () => {
    const rows = [outlet("PINE|1", "PINE", "Hope Shop", near(0), 36.9), outlet("UPFIELD|9", "UPFIELD", "Hope", near(0.2), 36.9)];
    // pad with many other "Hope" outlets so the word is common
    for (let i = 0; i < 300; i++) rows.push(outlet(`PINE|h${i}`, "PINE", `Hope ${i}`, 0.5 + i * 0.01, 37.5));
    expect(matchOutlets(rows).get("PINE|1")).toBeDefined(); // 2 m apart
    const far = [outlet("PINE|1", "PINE", "Hope Shop", near(0), 36.9), outlet("UPFIELD|9", "UPFIELD", "Hope", near(5), 36.9)];
    for (let i = 0; i < 300; i++) far.push(outlet(`PINE|h${i}`, "PINE", `Hope ${i}`, 0.5 + i * 0.01, 37.5));
    expect(matchOutlets(far).get("PINE|1")).toBeUndefined(); // 55 m apart
  });

  it("keeps one outlet per system in a group", () => {
    const groups = matchOutlets([
      outlet("PINE|1", "PINE", "Razak Shop", near(0), 36.9),
      outlet("PINE|2", "PINE", "Razak Shop", near(1), 36.9),
      outlet("UPFIELD|9", "UPFIELD", "Razak", near(0), 36.9),
    ]);
    const joined = ["PINE|1", "PINE|2"].filter((id) => groups.has(id));
    expect(joined.length).toBe(1);
  });

  it("never matches an outlet without a GPS point", () => {
    expect(matchOutlets([outlet("PINE|1", "PINE", "Razak Shop", null, null), outlet("UPFIELD|9", "UPFIELD", "Razak", near(0), 36.9)]).size).toBe(0);
  });

  it("explains a pair", () => {
    const rows = [outlet("PINE|1", "PINE", "Razak Shop", near(0), 36.9), outlet("UPFIELD|9", "UPFIELD", "Razak", near(1), 36.9)];
    expect(explainMatch(rows, "PINE|1", "UPFIELD|9")).toMatchObject({ confidence: "High" });
    expect(explainMatch(rows, "PINE|1", "none")).toBeNull();
  });
});

describe("flagCrossSystemMatches", () => {
  const row = (source: "PINE" | "UPFIELD", key: string, principal: string, name: string, lat: number): OutletUniverseRow =>
    ({ source, outletKey: key, principal, outletName: name, salesRole: "Primary Sales", channel: "Retail", segment: "Retailers", rawChannel: null, rawSegment: null, location: "Nairobi", region: "Nairobi", territory: "Umoja", route: null, repCode: null, repName: null, plannedRep: null, latitude: lat, longitude: 36.9, lastPurchaseDate: null, sales: 0, transactions: 0, purchaseDays30: 0, outletPurchaseDays30: 0, firstPurchaseDate: null, periodsBought90: 0, periodsBought180: 0 }) as OutletUniverseRow;

  it("flags every row of a matched outlet with the same id, systems and confidence, and leaves the rest alone", () => {
    const rows = [row("PINE", "1", "Mars-Nairobi", "Razak Shop", near(0)), row("PINE", "1", "Suntory-Nairobi", "Razak Shop", near(0)), row("UPFIELD", "9", "Upfield-Nairobi", "Razak", near(1)), row("PINE", "2", "Mars-Nairobi", "Lone Shop", near(80))];
    const flagged = flagCrossSystemMatches(rows);
    expect(flagged).toHaveLength(4);
    expect(flagged[0].matchId).toBe(flagged[1].matchId);
    expect(flagged[0].matchId).toBe(flagged[2].matchId);
    expect(flagged[0]).toMatchObject({ matchedSystems: "Pine; Upfield DataEdge", matchConfidence: "High" });
    expect(flagged[3].matchId).toBeUndefined();
  });
});
