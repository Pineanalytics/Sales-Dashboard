import { describe, expect, it } from "vitest";
import { OUTLET_MASTER_FEED, parseFeedColumns, powerQueryScript } from "@/lib/dataFeedScript";
import { feedKeyPrefix, generateFeedKey, hashFeedKey } from "@/lib/dataFeeds";
import { resolveFrequencyPeriod } from "@/lib/outletUniverse/frequencyPeriod";
import { OUTLET_COLUMNS } from "@/lib/outletUniverse/frequencyExport";

describe("the rolling last-6-months period", () => {
  it("runs from the same day six months back through today", () => {
    const period = resolveFrequencyPeriod(new URLSearchParams({ kind: "last6" }), new Date("2026-11-15T09:00:00Z"));
    expect(period.kind).toBe("last6");
    expect(period.start.toISOString().slice(0, 10)).toBe("2026-05-15");
    expect(period.end.toISOString().slice(0, 10)).toBe("2026-11-16");
    expect(period.startedMonths).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(period.label).toBe("Last 6 months (15 May 2026 to 15 Nov 2026)");
  });

  it("crosses a year boundary and clamps a missing day", () => {
    const period = resolveFrequencyPeriod(new URLSearchParams({ kind: "last6" }), new Date("2027-08-31T09:00:00Z"));
    expect(period.start.toISOString().slice(0, 10)).toBe("2027-02-28");
    const wrap = resolveFrequencyPeriod(new URLSearchParams({ kind: "last6" }), new Date("2027-02-10T09:00:00Z"));
    expect(wrap.start.toISOString().slice(0, 10)).toBe("2026-08-10");
    expect(wrap.startedMonths).toEqual([7, 8, 9, 10, 11, 0, 1]);
  });
});

describe("the outlet master feed", () => {
  const available = OUTLET_COLUMNS.map((column) => column.header);

  it("serves columns the extract really has", () => {
    for (const column of OUTLET_MASTER_FEED.defaultColumns) expect(available).toContain(column);
  });

  it("keeps known columns in the order asked, else the defaults", () => {
    expect(parseFeedColumns("Outlet|Bogus|Source|Outlet", available, OUTLET_MASTER_FEED.defaultColumns)).toEqual(["Outlet", "Source"]);
    expect(parseFeedColumns("", available, OUTLET_MASTER_FEED.defaultColumns)).toEqual(OUTLET_MASTER_FEED.defaultColumns);
    expect(parseFeedColumns("Nope", available, ["Source"])).toEqual(["Source"]);
  });

  it("writes a Power Query script with the key in a header and the choices up top", () => {
    const script = powerQueryScript({ baseUrl: "https://pinefrostdb.com/", feed: OUTLET_MASTER_FEED, key: "pfk_abc" });
    expect(script).toContain('FeedKey = "pfk_abc",');
    expect(script).toContain('Period = "last6",');
    expect(script).toContain('Web.Contents("https://pinefrostdb.com", [');
    expect(script).toContain('RelativePath = "api/feeds/outlet-master",');
    expect(script).toContain('Headers = [#"X-Feed-Key" = FeedKey]');
    expect(script).toContain('{"Principals", "Principals Associated"}');
    expect(script).toContain('{"Absolute Team Leader", type text}');
    expect(script).toContain('{"Latitude", type number}');
    expect(script).not.toContain("?key=");
  });

  it("escapes quotes in M text", () => {
    const script = powerQueryScript({ baseUrl: "https://x", feed: OUTLET_MASTER_FEED, key: 'pfk_"q', columns: ["Outlet"], renames: {} });
    expect(script).toContain('FeedKey = "pfk_""q",');
    expect(script).toContain("Renames = {},");
  });
});

describe("feed keys", () => {
  it("are random, prefixed and stored as a hash", () => {
    const a = generateFeedKey();
    const b = generateFeedKey();
    expect(a).not.toBe(b);
    expect(a.startsWith("pfk_")).toBe(true);
    expect(hashFeedKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFeedKey(a)).toBe(hashFeedKey(a));
    expect(feedKeyPrefix(a)).toBe(a.slice(0, 10));
  });
});

describe("the feed's CSV", () => {
  it("writes only the asked columns, in order, quoting and neutralising cells", async () => {
    const { frequencyCsvColumns } = await import("@/lib/outletUniverse/frequencyExport");
    const outlet = {
      source: "Pine", outletKey: "C-1", outletName: '=Shop "A", Thika', shopId: "S1", systems: "Pine", channel: "Retail", segment: "Shop",
      regionGroup: "Nairobi", territory: "Thika", latitude: -1.05, longitude: 37.1, classification: "Direct", absolutePrincipal: "Mars-Nairobi",
      principals: "Mars-Nairobi, Suntory-Nairobi", teamLeader: "Eva",
    } as unknown as Parameters<typeof frequencyCsvColumns>[0][number];
    const csv = frequencyCsvColumns([outlet], ["Outlet", "Latitude", "Principals", "Team Leader", "Not A Column"]);
    expect(csv.split("\r\n")).toEqual(["Outlet,Latitude,Principals,Team Leader", `"'=Shop ""A"", Thika",-1.05,"Mars-Nairobi, Suntory-Nairobi",Eva`]);
  });
});
