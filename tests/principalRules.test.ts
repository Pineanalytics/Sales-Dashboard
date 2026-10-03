import { describe, it, expect } from "vitest";
import { allocatePrincipal, findProductPrincipalConflicts, UNALLOCATED_PRINCIPAL } from "../lib/principalRules";

describe("allocatePrincipal", () => {
  it("maps an item code by its prefix", () => {
    expect(allocatePrincipal("SUN00001", "Lucozade NRG Boost").principal).toBe("Suntory");
    expect(allocatePrincipal("WEET0012", "Weetabix 430g").principal).toBe("Weetabix");
    expect(allocatePrincipal("  mars0004", null).principal).toBe("Mars");
  });

  it("splits Bidco's Afripop out of Suntory's SUN-coded range by item name", () => {
    expect(allocatePrincipal("SUN00030", "Afripop Black currant 12 x 300ml").principal).toBe("Bidco");
    expect(allocatePrincipal("SUN00030", "  afripop mango").principal).toBe("Bidco");
    expect(allocatePrincipal("SUN00030", "Ribena DIL BC 300ml GLA x12").principal).toBe("Suntory");
  });

  it("uses the longest code prefix and whole-word matching", () => {
    expect(allocatePrincipal("UP00012", "Blue Band").principal).toBe("Upfield");
    expect(allocatePrincipal("UPLIFT01", "Something else").principal).toBe(UNALLOCATED_PRINCIPAL);
    expect(allocatePrincipal("UKL1234", "Omo").principal).toBe("Unilever");
    expect(allocatePrincipal("KMFY001", "Imported").principal).toBe("Ukl-Intl");
  });

  it("returns Unallocated with no rule for unknown series", () => {
    const allocation = allocatePrincipal("SERV0001", "Delivery service");
    expect(allocation.principal).toBe(UNALLOCATED_PRINCIPAL);
    expect(allocation.rule).toBeNull();
  });
});

describe("findProductPrincipalConflicts", () => {
  it("flags products whose Product Master principal disagrees with a rule", () => {
    const conflicts = findProductPrincipalConflicts([
      { itemNo: "SUN00030", itemDescription: "Afripop Black currant 12 x 300ml", principal: "Suntory" },
      { itemNo: "SUN00001", itemDescription: "Lucozade NRG Boost", principal: "Suntory" },
      { itemNo: "WEET0001", itemDescription: "Weetabix", principal: "Weetabix-Nairobi" },
      { itemNo: "SERV0001", itemDescription: "Service", principal: "Suntory" },
      { itemNo: "SUN00099", itemDescription: "Unmapped", principal: "" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ itemNo: "SUN00030", currentPrincipal: "Suntory", suggestedPrincipal: "Bidco" });
  });

  it("treats hyphenated brand/location forms as the same principal", () => {
    expect(
      findProductPrincipalConflicts([{ itemNo: "KMFY001", itemDescription: "x", principal: "Ukl-Intl." }])
    ).toHaveLength(0);
  });
});
