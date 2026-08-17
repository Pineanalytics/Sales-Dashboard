import { describe, it, expect } from "vitest";
import { derivePrincipal, deriveRouteName, parseGpsCoordinate, transformEablCustomers, type EablCustomerRow } from "../scripts/db-bridge/eabl-call-performance/customers";

describe("derivePrincipal", () => {
  it("maps a Nyeri territory to EABL-Nyeri", () => {
    expect(derivePrincipal("DGO-D03-A09-T046 - Nyeri")).toBe("EABL-Nyeri");
  });

  it("maps a Nyahururu territory to EABL-Nyahururu", () => {
    expect(derivePrincipal("DGO-D03-A09-T045 - Nyahururu")).toBe("EABL-Nyahururu");
  });

  it("is case-insensitive", () => {
    expect(derivePrincipal("nyeri town")).toBe("EABL-Nyeri");
  });

  it("maps Othaya to EABL-Nyeri - administratively part of Nyeri, confirmed directly, not a substring match on 'nyeri'", () => {
    expect(derivePrincipal("DGO-D03-A09-T047 - Othaya")).toBe("EABL-Nyeri");
  });

  it("falls back to EABL-General for a genuinely separate, unrelated area (e.g. Upper Mountain KSO), never guessing the nearest named one", () => {
    expect(derivePrincipal("DGO-D03-A71-T756 - Upper Mountain KSO")).toBe("EABL-General");
  });

  it("falls back to EABL-General for null/unknown territory", () => {
    expect(derivePrincipal(null)).toBe("EABL-General");
    expect(derivePrincipal("NA - Unknown")).toBe("EABL-General");
  });
});

describe("deriveRouteName", () => {
  it("strips the distributor/route code, keeping only the readable place name", () => {
    expect(deriveRouteName("PFL1002 - Ngarua")).toBe("EABL-Ngarua");
  });

  it("prefixes EABL- so it can never collide with a same-named Pine route", () => {
    expect(deriveRouteName("DST-353705-PFL12 - Kiganjo")).toBe("EABL-Kiganjo");
  });

  it("handles the inconsistent 'code -CODE - Name' source formatting (extra space, no space after the inner hyphen)", () => {
    expect(deriveRouteName("DST-353705 -PFL09 - Chinga Othaya")).toBe("EABL-Chinga Othaya");
  });

  it("maps 'NA - Unknown' (a real, common source value) to no route rather than a fabricated one", () => {
    expect(deriveRouteName("NA - Unknown")).toBeNull();
  });

  it("maps null to no route", () => {
    expect(deriveRouteName(null)).toBeNull();
  });
});

describe("parseGpsCoordinate", () => {
  it("parses 'longitude,latitude' order, not the more common 'lat,long'", () => {
    // Real sample value - 36.36 can only be a longitude (Kenya's latitude
    // range is roughly -4.7 to +5.5), confirming source order live.
    expect(parseGpsCoordinate("36.3633646,0.039607")).toEqual({ longitude: 36.3633646, latitude: 0.039607 });
  });

  it("returns nulls for a missing value", () => {
    expect(parseGpsCoordinate(null)).toEqual({ latitude: null, longitude: null });
  });

  it("returns nulls for a malformed value rather than a partial/garbage parse", () => {
    expect(parseGpsCoordinate("not-a-coordinate")).toEqual({ latitude: null, longitude: null });
    expect(parseGpsCoordinate("36.36")).toEqual({ latitude: null, longitude: null });
  });
});

describe("transformEablCustomers", () => {
  function row(overrides: Partial<EablCustomerRow>): EablCustomerRow {
    return {
      customerId: "KE0159645",
      outletName: "Nyahururu town Stockist",
      channel: "001 - On Trade",
      subChannel: "034 - On Trade",
      territory: "DGO-D03-A09-T045 - Nyahururu",
      route: "PFL1003 - Nyahururu Town",
      gpsCoordinate: "36.3633646,0.039607",
      status: "ACTIVE",
      ...overrides,
    };
  }

  it("produces the full shape with a derived principal, derived route, and parsed coordinates", () => {
    const [result] = transformEablCustomers([row({})]);
    expect(result).toEqual({
      customerId: "KE0159645",
      principal: "EABL-Nyahururu",
      outletName: "Nyahururu town Stockist",
      channel: "001 - On Trade",
      subChannel: "034 - On Trade",
      territory: "DGO-D03-A09-T045 - Nyahururu",
      route: "EABL-Nyahururu Town",
      latitude: 0.039607,
      longitude: 36.3633646,
      status: "ACTIVE",
    });
  });

  it("normalizes status to a strict ACTIVE/INACTIVE, defaulting anything else to INACTIVE", () => {
    expect(transformEablCustomers([row({ status: "active" })])[0].status).toBe("ACTIVE");
    expect(transformEablCustomers([row({ status: "INACTIVE" })])[0].status).toBe("INACTIVE");
    expect(transformEablCustomers([row({ status: "Suspended" })])[0].status).toBe("INACTIVE");
  });

  it("falls back to the customerId as the outlet name when the source name is blank", () => {
    expect(transformEablCustomers([row({ outletName: "  " })])[0].outletName).toBe("KE0159645");
  });
});
