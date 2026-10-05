import { describe, expect, it } from "vitest";
import { cleanTerritory, locationFromPrincipal, normalizeChannel, normalizeSegment, stripCodePrefix } from "../lib/outletUniverse/normalize";
import { cleanLeverageUnit, eablRow, leverageRow, pineRow } from "../lib/outletUniverse/rebuild";
import { parseOutletFilters } from "../lib/outletUniverse/query";

describe("outlet universe normalisation", () => {
  it("strips a numeric code prefix and cleans EABL territories", () => {
    expect(stripCodePrefix("001 - On Trade")).toBe("On Trade");
    expect(stripCodePrefix("Retail")).toBe("Retail");
    expect(cleanTerritory("DGO-D03-A09-T045 - Nyahururu")).toBe("Nyahururu");
    expect(cleanTerritory("Tharaka - MBSR")).toBe("Tharaka - MBSR");
    expect(cleanTerritory("NA - Unknown")).toBe("Unspecified");
    expect(cleanTerritory(null)).toBe("Unspecified");
  });

  it("maps the three sources' channels onto one taxonomy", () => {
    expect(normalizeChannel("Retail")).toBe("Retail");
    expect(normalizeChannel("retail")).toBe("Retail");
    expect(normalizeChannel("Retailer")).toBe("Retail");
    expect(normalizeChannel("002 - Off Trade")).toBe("Retail");
    expect(normalizeChannel("Wholesale")).toBe("Wholesale");
    expect(normalizeChannel("008 - Route to Market")).toBe("Wholesale");
    expect(normalizeChannel("LMT")).toBe("Modern Trade");
    expect(normalizeChannel("001 - On Trade")).toBe("On Trade");
    expect(normalizeChannel("X - Not Applicable")).toBe("Unspecified");
    expect(normalizeChannel("")).toBe("Unspecified");
    expect(normalizeChannel("Pharmacy Chain")).toBe("Pharmacy Chain");
  });

  it("normalises segments and prefers the specific one", () => {
    expect(normalizeSegment("retail")).toBe("Retailers");
    expect(normalizeSegment("Wholesaler")).toBe("Wholesalers");
    expect(normalizeSegment("034 - On Trade", "Bar")).toBe("Bar");
    expect(normalizeSegment("034 - On Trade", "Not Applicable")).toBe("Unspecified");
    expect(normalizeSegment("034 - On Trade", null)).toBe("On Trade");
    expect(normalizeSegment("Beauty")).toBe("Beauty Shop");
    expect(normalizeSegment(null)).toBe("Unspecified");
  });

  it("derives the location from the principal name", () => {
    expect(locationFromPrincipal("Mars-Nairobi")).toBe("Nairobi");
    expect(locationFromPrincipal("Ukl-Intl-Nairobi")).toBe("Nairobi");
    expect(locationFromPrincipal("EABL-Nyeri")).toBe("Nyeri");
    expect(locationFromPrincipal("Mars")).toBe("Unspecified");
  });
});

describe("outlet universe row builders", () => {
  it("builds a Pine row with the PJP owner as rep and drops a zero coordinate", () => {
    const row = pineRow({
      principal: "Mars-Nairobi",
      customerId: "45786",
      outletName: "Mama Dilan Shop",
      channel: "Retail",
      subChannel: "Retailers",
      territory: "Tharaka - MBSR",
      latitude: 0,
      longitude: 37.1,
      pjpEmployeeCode: "E1",
      pjpRepName: "Jane Doe",
      pjpRegion: "",
      mostRecentRep: "Other Rep",
      lastPurchaseDate: new Date("2026-09-30"),
      sales: 1200,
      timesBought: 4,
    });
    expect(row).toMatchObject({ source: "PINE", repName: "Jane Doe", region: "Unspecified", channel: "Retail", segment: "Retailers", location: "Nairobi", route: null, latitude: null, longitude: 37.1 });
  });

  it("builds a Leverage row with the branch as region and principal", () => {
    const row = leverageRow({
      customerCode: "T000115300100060844",
      storageLocation: "18048241",
      lastBuy: new Date("2026-10-01"),
      sales: 5000,
      transactions: 3,
      salesRepCode: "B01",
      salesRepName: "VAN B1_OB (TOTAL)_18048241",
      route: "B001",
      routeDesc: "VAN B1_OB (CBD)",
      outletName: "Simbisa Karen(Shell)",
      channel: "LMT",
    });
    expect(row).toMatchObject({
      source: "LEVERAGE",
      principal: "Unilever-Nairobi",
      region: "Nairobi",
      territory: "Nairobi",
      route: "VAN B1_OB (CBD) (B001)",
      repName: "VAN B1_OB (TOTAL)",
      channel: "Modern Trade",
      segment: "Large Modern Trade",
    });
  });

  it("falls back to the PJP code when the journey-plan roster has no description", () => {
    const row = leverageRow({ customerCode: "T0002", storageLocation: "18058585", lastBuy: null, sales: 0, transactions: 0, salesRepCode: null, salesRepName: null, route: "NY03", routeDesc: null, outletName: "Shop", channel: "Retailer" });
    expect(row.route).toBe("NY03");
    expect(row.repName).toBeNull();
  });

  it("strips the distributor-id suffix from a Leverage sales unit", () => {
    expect(cleanLeverageUnit("NY_VAN_A_OB_18058585")).toBe("NY_VAN_A_OB");
    expect(cleanLeverageUnit("Rep One")).toBe("Rep One");
    expect(cleanLeverageUnit(null)).toBeNull();
  });

  it("names a Leverage outlet by its code when no outlet name was ever synced", () => {
    const row = leverageRow({ customerCode: "T0001", storageLocation: "18058585", lastBuy: null, sales: 0, transactions: 0, salesRepCode: null, salesRepName: null, route: null, routeDesc: null, outletName: null, channel: null });
    expect(row).toMatchObject({ outletName: "T0001", principal: "Unilever-Nyeri", territory: "Nyeri", channel: "Unspecified", lastPurchaseDate: null });
  });

  it("builds an EABL row from the master plus its latest call", () => {
    const row = eablRow({
      customerId: "KE0187183",
      principal: "EABL-Nyahururu",
      outletName: "Retro Lounge Nyahururu",
      channel: "001 - On Trade",
      subChannel: "034 - On Trade",
      territory: "DGO-D03-A09-T045 - Nyahururu",
      route: "EABL-Nyahururu Town",
      latitude: -0.03,
      longitude: 36.36,
      lastBuy: new Date("2026-10-02"),
      sales: 800,
      transactions: 2,
      salesman: "Salesman A",
      segment: "Bar",
    });
    expect(row).toMatchObject({ source: "EABL", channel: "On Trade", segment: "Bar", territory: "Nyahururu", route: "EABL-Nyahururu Town", repName: "Salesman A", location: "Nyahururu" });
  });
});

describe("outlet universe filter parsing", () => {
  it("defaults to the principal view of active outlets", () => {
    const filters = parseOutletFilters(new URLSearchParams());
    expect(filters).toMatchObject({ view: "principal", status: "active", source: null, principal: null, q: "" });
  });

  it("accepts known values and ignores unknown ones", () => {
    const filters = parseOutletFilters(new URLSearchParams({ view: "general", status: "all", source: "EABL", channel: "Retail", rep: "  Jane  " }));
    expect(filters).toMatchObject({ view: "general", status: "all", source: "EABL", channel: "Retail", rep: "Jane" });
    const bad = parseOutletFilters(new URLSearchParams({ view: "x", status: "weird", source: "DROP TABLE" }));
    expect(bad).toMatchObject({ view: "principal", status: "active", source: null });
  });
});
