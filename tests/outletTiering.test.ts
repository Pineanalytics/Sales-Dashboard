import { describe, expect, it } from "vitest";
import { averageSales, buildNameProfiles, channelForSegment, classification2, cleanPlaces, defaultSegment, isPlaceholderPlace, nameKey, tierFor, tierRow, type ProfileInput } from "../lib/outletUniverse/tiering";

const row = (over: Partial<ProfileInput> = {}): ProfileInput => ({ outletName: "Heykal Packers", channel: "Retail", segment: "Retailers", sales: 1000, transactions: 10, active: true, ...over });

describe("tierFor", () => {
  it("bands a retail outlet by its combined average sale", () => {
    expect(tierFor("Retail", 500)).toBe("500 & Below");
    expect(tierFor("Retail", 500.01)).toBe("501 - 1,000");
    expect(tierFor("Retail", 1000)).toBe("501 - 1,000");
    expect(tierFor("Retail", 5000)).toBe("1,001 - 5,000");
    expect(tierFor("Retail", 9999.5)).toBe("5,001 - 9,999");
    expect(tierFor("Retail", 10000)).toBe("10,000 & Above");
  });

  it("bands a wholesale outlet", () => {
    expect(tierFor("Wholesale", 5000)).toBe("5,000 & Below");
    expect(tierFor("Wholesale", 10000)).toBe("5,001 - 10,000");
    expect(tierFor("Wholesale", 20000)).toBe("10,001 - 20,000");
    expect(tierFor("Wholesale", 50000)).toBe("20,001 - 50,000");
    expect(tierFor("Wholesale", 885957)).toBe("Above 50,000");
  });

  it("says No Sales Data when there is nothing to average", () => {
    expect(tierFor("Retail", null)).toBe("No Sales Data");
    expect(tierFor("Wholesale", Number.NaN)).toBe("No Sales Data");
  });
});

describe("channel, segment and place defaults", () => {
  it("makes Wholesale the Wholesalers type and everything else Retail", () => {
    expect(channelForSegment("Wholesalers")).toBe("Wholesale");
    expect(channelForSegment("wholesalers")).toBe("Wholesale");
    expect(channelForSegment("Supermarkets")).toBe("Retail");
    expect(channelForSegment("Distributor")).toBe("Retail");
  });

  it("replaces an Unspecified segment by the one its channel implies", () => {
    expect(defaultSegment("Unspecified", "Wholesale")).toBe("Wholesalers");
    expect(defaultSegment("Unspecified", "Retail")).toBe("Retailers");
    expect(defaultSegment("", "Modern Trade")).toBe("Retailers");
    expect(defaultSegment("Pharmacies", "Retail")).toBe("Pharmacies");
  });

  it("recognises General, Unspecified and blank as no place", () => {
    expect(isPlaceholderPlace("General")).toBe(true);
    expect(isPlaceholderPlace(" unspecified ")).toBe(true);
    expect(isPlaceholderPlace("")).toBe(true);
    expect(isPlaceholderPlace("Nyahururu")).toBe(false);
  });

  it("fills a General or Unspecified place from the next supported column", () => {
    expect(cleanPlaces({ location: "General", region: "General", territory: "Othaya" })).toEqual({ location: "Othaya", region: "Othaya", territory: "Othaya" });
    expect(cleanPlaces({ location: "Nairobi", region: "Unspecified", territory: "Kayole" })).toEqual({ location: "Nairobi", region: "Kayole", territory: "Kayole" });
    expect(cleanPlaces({ location: "Nyeri", region: "Nyeri", territory: "Unspecified" })).toEqual({ location: "Nyeri", region: "Nyeri", territory: "Nyeri" });
    expect(cleanPlaces({ location: "General", region: "General", territory: "Unspecified" })).toEqual({ location: "", region: "", territory: "" });
  });
});

describe("classification2", () => {
  it("turns Primary + Secondary into Primary Sales and leaves the rest alone", () => {
    expect(classification2("Primary + Secondary")).toBe("Primary Sales");
    expect(classification2("Primary Sales")).toBe("Primary Sales");
    expect(classification2("Secondary Sales")).toBe("Secondary Sales");
  });
});

describe("name profiles: combined average sale and one tier per outlet name", () => {
  it("adds the average sale of every row with the same name (the Heykal Packers example) and tiers them all alike", () => {
    // averages 814,725 / 27,875 / 43,356 -> combined 885,956
    const rows = [row({ sales: 8_147_250, transactions: 10 }), row({ sales: 27_875, transactions: 1 }), row({ sales: 433_560, transactions: 10 })];
    const profiles = buildNameProfiles(rows);
    expect(profiles.combined.get(nameKey("Heykal Packers")!)).toBeCloseTo(814_725 + 27_875 + 43_356, 6);
    const tiers = rows.map((r) => tierRow(r, profiles));
    expect(tiers.map((t) => t.tier)).toEqual(["10,000 & Above", "10,000 & Above", "10,000 & Above"]); // a Retail outlet; the same for every row
    expect(tiers[1].averageSales).toBe(27_875);
    expect(tiers[1].combinedAverage).toBeCloseTo(885_956, 6);
  });

  it("gives every row of a name the segment of its highest-selling row, and the channel that segment implies", () => {
    const rows = [
      row({ outletName: "Abdi", channel: "Retail", segment: "Retailers", sales: 100 }),
      row({ outletName: "Abdi", channel: "Wholesale", segment: "Wholesalers", sales: 9000 }),
      row({ outletName: "Abdi", channel: "Retail", segment: "Minimart", sales: 500 }),
    ];
    const profiles = buildNameProfiles(rows);
    for (const r of rows) expect(tierRow(r, profiles)).toMatchObject({ channel: "Wholesale", segment: "Wholesalers" });
  });

  it("takes the first row on a tie in Sales YTD", () => {
    const rows = [row({ outletName: "Tie", segment: "Pharmacies", sales: 500 }), row({ outletName: "Tie", segment: "Minimart", sales: 500 })];
    expect(tierRow(rows[1], buildNameProfiles(rows)).segment).toBe("Pharmacies");
  });

  it("adds averages across names that differ only in upper / lower case, but keeps their segments apart (the workbook's SUMIFS vs its per-name lookup)", () => {
    const rows = [row({ outletName: "Rubis", segment: "Pharmacies", sales: 1000, transactions: 1 }), row({ outletName: "RUBIS", segment: "Minimart", sales: 3000, transactions: 1 }), row({ outletName: "Rubis Energy", sales: 7, transactions: 1 })];
    const profiles = buildNameProfiles(rows);
    expect(tierRow(rows[0], profiles)).toMatchObject({ segment: "Pharmacies", combinedAverage: 4000 });
    expect(tierRow(rows[1], profiles)).toMatchObject({ segment: "Minimart", combinedAverage: 4000 });
    expect(tierRow(rows[2], profiles).combinedAverage).toBe(7);
    expect(nameKey("  ")).toBeNull();
  });

  it("only counts active rows when a name has any, and all of them when none is active", () => {
    const mixedRows = [row({ outletName: "N", sales: 1000, transactions: 1, active: true }), row({ outletName: "N", sales: 90_000, transactions: 1, active: false })];
    expect(tierRow(mixedRows[0], buildNameProfiles(mixedRows)).combinedAverage).toBe(1000);
    const dormantRows = [row({ outletName: "D", sales: 600, transactions: 1, active: false }), row({ outletName: "D", sales: 400, transactions: 1, active: false })];
    expect(tierRow(dormantRows[0], buildNameProfiles(dormantRows)).combinedAverage).toBe(1000);
  });

  it("says No Sales Data for a name whose rows have no transactions, and keeps an Unspecified segment out of the result", () => {
    const rows = [row({ outletName: "Empty", sales: 0, transactions: 0, segment: "Unspecified", channel: "Retail" })];
    expect(tierRow(rows[0], buildNameProfiles(rows))).toMatchObject({ tier: "No Sales Data", segment: "Retailers", combinedAverage: null });
    expect(averageSales(0, 0)).toBeNull();
  });

  it("tiers a nameless row on its own", () => {
    const tiered = tierRow(row({ outletName: "", sales: 3000, transactions: 3, segment: "Unspecified", channel: "Wholesale" }), buildNameProfiles([]));
    expect(tiered).toMatchObject({ channel: "Wholesale", segment: "Wholesalers", averageSales: 1000, combinedAverage: 1000, tier: "5,000 & Below" });
  });
});
