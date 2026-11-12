import { describe, expect, it } from "vitest";
import { checkPrincipalSalesMapping, productNameForPrincipal } from "@/lib/principalSalesMapping";
import { allocatePrincipal } from "@/lib/principalRules";

const base = {
  principals: [
    { principal: "Highchem-Nairobi", location: "Nairobi", status: "Active" },
    { principal: "Suntory-Nairobi", location: "Nairobi", status: "Active" },
    { principal: "Ukl-Intl-Nairobi", location: "Nairobi", status: "Active" },
    { principal: "Oldco-Nairobi", location: "Nairobi", status: "Past" },
  ],
  products: [
    { itemNo: "SUN001", principal: "Suntory" },
    { itemNo: "KMFY01", principal: "Ukl-Intl" },
    { itemNo: "OLD001", principal: "Oldco" },
  ],
  unmapped: [
    { itemNo: "HCM0001", itemDescription: "HIGHCHEM BLEACH 1L", revenue: 12000 },
    { itemNo: "HCM0002", itemDescription: "HIGHCHEM SOAP 500G", revenue: 3000 },
  ],
  principalsWithSales: new Set(["Suntory-Nairobi"]),
};

describe("principal sales mapping check", () => {
  it("routes HCM item codes to Highchem", () => {
    expect(allocatePrincipal("HCM0001", "HIGHCHEM BLEACH 1L").principal).toBe("Highchem");
  });

  it("reads the Product Master name a principal row expects", () => {
    expect(productNameForPrincipal({ principal: "Highchem-Nairobi", location: "Nairobi", status: "Active" })).toBe("Highchem");
    expect(productNameForPrincipal({ principal: "Ukl-Intl-Nairobi", location: "Nairobi", status: "Active" })).toBe("Ukl-Intl");
    expect(productNameForPrincipal({ principal: "Highchem", location: "Nairobi", status: "Active" })).toBeNull();
  });

  it("explains a new principal with unmapped SAP items and no products", () => {
    const { principals } = checkPrincipalSalesMapping(base);
    const highchem = principals.find((row) => row.principal === "Highchem-Nairobi")!;
    expect(highchem.hasSales).toBe(false);
    expect(highchem.issues).toEqual([
      { kind: "no-products" },
      { kind: "unmapped-items", itemCount: 2, revenue: 15000, examples: ["HCM0001", "HCM0002"] },
    ]);
    expect(principals.find((row) => row.principal === "Suntory-Nairobi")!.issues).toEqual([]);
    expect(principals.find((row) => row.principal === "Ukl-Intl-Nairobi")!.issues).toEqual([]);
  });

  it("flags a principal row without its -Location suffix", () => {
    const { principals } = checkPrincipalSalesMapping({ ...base, principals: [{ principal: "Highchem", location: "Nairobi", status: "Active" }] });
    expect(principals[0].issues[0]).toEqual({ kind: "missing-location", expectedExample: "Highchem-Nairobi" });
  });

  it("catches products mapped under a different spelling, and lists them as orphans", () => {
    const result = checkPrincipalSalesMapping({ ...base, products: [...base.products, { itemNo: "HCM0001", principal: "HighChem" }], unmapped: [] });
    expect(result.principals.find((row) => row.principal === "Highchem-Nairobi")!.issues).toEqual([
      { kind: "no-products" },
      { kind: "name-mismatch", productPrincipal: "HighChem", productCount: 1 },
    ]);
    expect(result.orphanProductPrincipals).toEqual([{ productPrincipal: "HighChem", productCount: 1, closestPrincipal: "Highchem-Nairobi" }]);
  });

  it("leaves products of a Past principal alone", () => {
    expect(checkPrincipalSalesMapping(base).orphanProductPrincipals).toEqual([]);
  });
});

describe("principal sales mapping check — principals already selling", () => {
  it("does not flag missing products for a principal that already has SAP sales", () => {
    const { principals } = checkPrincipalSalesMapping({ ...base, products: [], unmapped: [] });
    expect(principals.find((row) => row.principal === "Suntory-Nairobi")!.issues).toEqual([]);
    expect(principals.find((row) => row.principal === "Highchem-Nairobi")!.issues).toEqual([{ kind: "no-products" }]);
  });

  it("lists principals with unidentified SAP items first", () => {
    const { principals } = checkPrincipalSalesMapping(base);
    expect(principals[0].principal).toBe("Highchem-Nairobi");
  });
});
