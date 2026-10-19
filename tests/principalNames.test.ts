import { describe, it, expect } from "vitest";
import { buildPrincipalCanonicalizer, findPrincipalVariantGroups, principalNameKey } from "../lib/principalNames";
import { buildTlRanking } from "../lib/tlRanking";

describe("principalNameKey", () => {
  it("ignores case and spacing", () => {
    expect(principalNameKey("  Eabl-Nyeri ")).toBe(principalNameKey("EABL-NYERI"));
    expect(principalNameKey("Ukl  Intl-Nairobi")).toBe("ukl intl-nairobi");
  });
});

describe("buildPrincipalCanonicalizer", () => {
  const canon = buildPrincipalCanonicalizer(["EABL-Nyeri", "Eabl-Nyeri", "Mars-Nairobi"]);

  it("maps any spelling to the oldest known one", () => {
    expect(canon("Eabl-Nyeri")).toBe("EABL-Nyeri");
    expect(canon("eabl-nyeri")).toBe("EABL-Nyeri");
    expect(canon(" MARS-NAIROBI ")).toBe("Mars-Nairobi");
  });

  it("leaves a genuinely new principal alone, only trimmed", () => {
    expect(canon("  Bidco-Nairobi ")).toBe("Bidco-Nairobi");
  });
});

describe("findPrincipalVariantGroups", () => {
  it("picks the oldest row as canonical and lists the rest as variants", () => {
    const groups = findPrincipalVariantGroups([
      { principal: "Eabl-Nyahururu", createdAt: new Date("2026-09-28") },
      { principal: "EABL-Nyahururu", createdAt: new Date("2026-08-11") },
      { principal: "Mars-Nairobi", createdAt: new Date("2026-01-01") },
    ]);
    expect(groups).toEqual([{ canonical: "EABL-Nyahururu", variants: ["Eabl-Nyahururu"] }]);
  });

  it("reports nothing when every principal has one spelling", () => {
    expect(findPrincipalVariantGroups([{ principal: "Mars-Nairobi", createdAt: new Date() }, { principal: "Suntory-Nairobi", createdAt: new Date() }])).toEqual([]);
  });
});

describe("buildTlRanking with two spellings of one principal", () => {
  it("lists the principal once for its Team Leader", () => {
    const result = buildTlRanking(
      [{ principal: "EABL-Nyahururu", revenue: 80 }],
      [
        { principal: "EABL-Nyahururu", teamLeaderId: "tl-erick" },
        { principal: "Eabl-Nyahururu", teamLeaderId: "tl-erick" },
      ],
      [{ id: "tl-erick", name: "Erick" }],
      [{ teamLeaderId: "tl-erick", targetValue: 100 }]
    );
    expect(result.rankings[0].principals).toEqual(["EABL-Nyahururu"]);
    expect(result.rankings[0].mtdRevenue).toBe(80);
  });
});
