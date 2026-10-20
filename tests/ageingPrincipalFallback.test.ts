import { describe, expect, it } from "vitest";
import { brandKey, inferPrincipals, learnPropertyLabels } from "../lib/ageingPrincipalFallback";
import { buildGlobalAgeingReport } from "../lib/globalAgeing";

const sale = (cardCode: string, principal: string, netSales: number) => ({ cardCode, principal, netSales });

describe("brand of a sales principal", () => {
  it("is the part before the last hyphen, lower case", () => {
    expect(brandKey("Unilever-Nyeri")).toBe("unilever");
    expect(brandKey("Ukl-Intl-Nairobi")).toBe("uklintl");
    expect(brandKey("Mars-Nairobi")).toBe("mars");
    expect(brandKey("Bidco")).toBe("bidco");
  });
});

describe("placing customers that have no SAP Property", () => {
  // Three classified Unilever customers teach that Unilever sales carry the Property label "UKL".
  const classified = [
    { customerCode: "A", principal: "UKL" },
    { customerCode: "B", principal: "UKL" },
    { customerCode: "C", principal: "UKL" },
    { customerCode: "M1", principal: "Mars" },
    { customerCode: "M2", principal: "Mars" },
    { customerCode: "M3", principal: "Mars" },
  ];
  const sales = [
    sale("A", "Unilever-Nyeri", 100), sale("B", "Unilever-Nairobi", 80), sale("C", "Unilever-Nyeri", 60),
    sale("M1", "Mars-Nairobi", 90), sale("M2", "Mars-Nairobi", 70), sale("M3", "Mars-Nairobi", 50),
  ];

  it("learns the Property label a sales brand carries from the customers that have both", () => {
    const learned = learnPropertyLabels(classified, sales);
    expect(learned.get("unilever")).toBe("UKL");
    expect(learned.get("mars")).toBe("Mars");
  });

  it("places a customer under the brand it buys most, in the SAP label", () => {
    const customers = [...classified, { customerCode: "N1", principal: null }, { customerCode: "N2", principal: "" }, { customerCode: "N3", principal: null }];
    const placed = inferPrincipals(customers, [...sales, sale("N1", "Unilever-Nyeri", 300), sale("N1", "Mars-Nairobi", 50), sale("N2", "Bidco-Nairobi", 40)]);
    expect(placed.get("N1")).toEqual({ principal: "UKL", source: "Inferred from sales" });
    expect(placed.get("N2")).toEqual({ principal: "Bidco", source: "Inferred from sales" }); // no label to borrow: the brand itself
    expect(placed.has("N3")).toBe(false); // no sales: stays unclassified
    expect(placed.has("A")).toBe(false); // already has a Property: never overridden
  });

  it("counts returns against a brand and ignores a customer whose net is not positive", () => {
    const placed = inferPrincipals([{ customerCode: "X", principal: null }], [sale("X", "Mars-Nairobi", 100), sale("X", "Mars-Nairobi", -120)]);
    expect(placed.has("X")).toBe(false);
  });
});

describe("the ageing report marks where each principal came from", () => {
  const openItems = [
    { customerCode: "A", taxDate: new Date("2026-10-01"), postingDate: new Date("2026-10-01"), openBalance: 100 },
    { customerCode: "N1", taxDate: new Date("2026-10-02"), postingDate: new Date("2026-10-02"), openBalance: 50 },
    { customerCode: "N3", taxDate: new Date("2026-10-03"), postingDate: new Date("2026-10-03"), openBalance: 10 },
  ];
  const customers = [
    { customerCode: "A", customerName: "A Ltd", principal: "UKL" },
    { customerCode: "N1", customerName: "New One", principal: "UKL", principalSource: "Inferred from sales" as const },
    { customerCode: "N3", customerName: "No History", principal: null },
  ];
  const report = buildGlobalAgeingReport(new Date("2026-10-20"), openItems, customers, []);

  it("labels SAP, inferred and unclassified customers", () => {
    const source = Object.fromEntries(report.byCustomer.map((c) => [c.customerCode, c.principalSource]));
    expect(source).toEqual({ A: "SAP Property", N1: "Inferred from sales", N3: "Unclassified" });
  });

  it("adds an inferred customer to its principal's total and leaves the rest as Unclassified", () => {
    expect(report.byPrincipal.find((p) => p.principal === "UKL")?.totalDebts).toBe(150);
    expect(report.byPrincipal.find((p) => p.principal === "Unclassified")?.totalDebts).toBe(10);
  });
});
