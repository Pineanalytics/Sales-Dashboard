import { describe, it, expect } from "vitest";
import {
  classifySalesRole,
  resolveCostCentre,
  collapseToPurchaseEvents,
  buildActiveOutletsMonthly,
  type PrincipalRow,
} from "../scripts/db-bridge/active-outlets/transform";
import type { FactLineRow, OutletRow, ProductRow, UserRow } from "../scripts/db-bridge/active-outlets/query";

function principal(overrides: Partial<PrincipalRow>): PrincipalRow {
  return {
    key: "1",
    principal: "Bic-Nairobi",
    mainPrincipal: "Bic",
    location: "Nairobi",
    locationCode: "1",
    status: "Active",
    teamLeader: "Someone",
    ...overrides,
  };
}

const PRINCIPALS: PrincipalRow[] = [
  principal({ principal: "Bic-Nairobi", mainPrincipal: "Bic" }),
  principal({ principal: "Mars-Nairobi", mainPrincipal: "Mars" }),
];

describe("classifySalesRole", () => {
  it("classifies DSR/KAMS/TDR/Admin as Primary Sales by default", () => {
    expect(classifySalesRole("DSR", "999", "Bic-Nairobi")).toBe("Primary Sales");
    expect(classifySalesRole("KAMS", "999", "Bic-Nairobi")).toBe("Primary Sales");
    expect(classifySalesRole("TDR", "999", "Bic-Nairobi")).toBe("Primary Sales");
    expect(classifySalesRole("ADMIN", "999", "Bic-Nairobi")).toBe("Primary Sales");
  });

  it("classifies everything outside the primary groups as Secondary Sales", () => {
    expect(classifySalesRole("MBSR", "999", "Bic-Nairobi")).toBe("Secondary Sales");
    expect(classifySalesRole("", "999", "Bic-Nairobi")).toBe("Secondary Sales");
  });

  it("TDR selling to Mars is Secondary Sales (the one exception to TDR being Primary)", () => {
    expect(classifySalesRole("TDR", "999", "Mars-Nairobi")).toBe("Secondary Sales");
    expect(classifySalesRole("TDR", "999", "mars-nairobi")).toBe("Secondary Sales"); // case-insensitive Cost Centre check
  });

  it("TDR selling to a non-Mars Cost Centre stays Primary Sales", () => {
    expect(classifySalesRole("TDR", "999", "Bic-Nairobi")).toBe("Primary Sales");
  });

  it("DSR employee codes 1172 and 1032 are Secondary Sales regardless of Cost Centre", () => {
    expect(classifySalesRole("DSR", "1172", "Bic-Nairobi")).toBe("Secondary Sales");
    expect(classifySalesRole("DSR", "1032", "Bic-Nairobi")).toBe("Secondary Sales");
  });

  it("other DSR employee codes stay Primary Sales", () => {
    expect(classifySalesRole("DSR", "1173", "Bic-Nairobi")).toBe("Primary Sales");
  });
});

describe("resolveCostCentre", () => {
  it("resolves a SKU to its Cost Centre via the longest matching prefix", () => {
    const row = resolveCostCentre("BIC12345", PRINCIPALS);
    expect(row?.principal).toBe("Bic-Nairobi");
  });

  it("returns null for a SKU with no known brand prefix", () => {
    expect(resolveCostCentre("ZZZ99999", PRINCIPALS)).toBeNull();
  });

  it("returns null when the resolved brand has no matching Active principal", () => {
    expect(resolveCostCentre("MARS123", [principal({ principal: "Mars-Nairobi", status: "Past" })])).toBeNull();
  });
});

function outlet(overrides: Partial<OutletRow>): OutletRow {
  return { id: "1", name: "Test Outlet", subChannel: "Retailers", sourceChannel: "Retail", territory: "Nairobi", ...overrides };
}
function user(overrides: Partial<UserRow>): UserRow {
  return { id: "1", employee: "Jane Doe", userGroup: "DSR", region: "Nairobi", ...overrides };
}
function product(overrides: Partial<ProductRow>): ProductRow {
  return { id: "1", sapCode: "BIC12345", ...overrides };
}
function factLine(overrides: Partial<FactLineRow>): FactLineRow {
  return {
    docId: "100",
    isOrder: false,
    purchaseTime: new Date("2026-01-15T10:00:00Z"),
    userId: "1",
    customerId: "1",
    itemId: "1",
    qty: 10,
    unitPrice: 5,
    ...overrides,
  };
}

describe("collapseToPurchaseEvents", () => {
  const outlets = [outlet({ id: "1" })];
  const users = [user({ id: "1" })];
  const products = [product({ id: "1", sapCode: "BIC12345" }), product({ id: "2", sapCode: "BIC54321" })];

  it("collapses multiple SKU lines from the same document + Cost Centre into one purchase event", () => {
    const lines = [
      factLine({ docId: "100", itemId: "1", qty: 10, unitPrice: 5 }),
      factLine({ docId: "100", itemId: "2", qty: 4, unitPrice: 2.5 }),
    ];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(1);
    expect(events[0].revenue).toBe(10 * 5 + 4 * 2.5);
    expect(events[0].qty).toBe(14);
  });

  it("keeps two different documents as two separate purchase events", () => {
    const lines = [factLine({ docId: "100" }), factLine({ docId: "101" })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(2);
  });

  it("drops lines with an unresolvable SKU and reports the count", () => {
    const lines = [factLine({ itemId: "99" })]; // no product with id "99"
    const { events, unmatchedSkuCount } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(0);
    expect(unmatchedSkuCount).toBe(0); // dropped before Cost Centre resolution (unknown product), not counted as an unmatched SKU
  });

  it("drops lines whose SKU has no matching Active principal and counts them as unmatched", () => {
    const noMatchProducts = [product({ id: "1", sapCode: "ZZZ12345" })];
    const lines = [factLine({ itemId: "1" })];
    const { events, unmatchedSkuCount } = collapseToPurchaseEvents(lines, outlets, users, noMatchProducts, PRINCIPALS);
    expect(events).toHaveLength(0);
    expect(unmatchedSkuCount).toBe(1);
  });
});

describe("buildActiveOutletsMonthly — distinct outlets, never summed across months", () => {
  const outlets = [outlet({ id: "1" }), outlet({ id: "2" })];
  const users = [user({ id: "1" })];
  const products = [product({ id: "1", sapCode: "BIC12345" })];

  it("re-counts distinct outlets per month rather than accumulating a running total", () => {
    const lines = [
      // Outlet 1 buys in both January and February — should count once per month, not twice in Feb.
      factLine({ docId: "100", customerId: "1", purchaseTime: new Date("2026-01-10T09:00:00Z") }),
      factLine({ docId: "101", customerId: "1", purchaseTime: new Date("2026-02-10T09:00:00Z") }),
      factLine({ docId: "102", customerId: "2", purchaseTime: new Date("2026-02-11T09:00:00Z") }),
    ];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    const monthly = buildActiveOutletsMonthly(events);

    const jan = monthly.find((m) => m.month === "January");
    const feb = monthly.find((m) => m.month === "February");
    expect(jan?.distinctOutlets).toBe(1);
    expect(feb?.distinctOutlets).toBe(2);
  });
});
