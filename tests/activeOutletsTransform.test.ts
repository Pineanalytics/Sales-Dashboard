import { describe, it, expect } from "vitest";
import {
  classifySalesRole,
  resolveCostCentre,
  collapseToPurchaseEvents,
  buildActiveOutletEvents,
  buildActiveOutletsMonthly,
  buildRepCalls,
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

  it("keeps a TDR Secondary when a mixed basket includes Mars", () => {
    expect(classifySalesRole("TDR", "999", "Bic-Nairobi, Mars-Nairobi")).toBe("Secondary Sales");
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

  it("uses the canonical SKU mapping when the live worker cannot reach the optional principal reference database", () => {
    expect(resolveCostCentre("BIC123", [])?.principal).toBe("Bic-Nairobi");
    expect(resolveCostCentre("KBL123", [])?.principal).toBe("EABL-Nyahururu");
  });
});

function outlet(overrides: Partial<OutletRow>): OutletRow {
  return { id: "1", name: "Test Outlet", subChannel: "Retailers", sourceChannel: "Retail", territory: "Nairobi", ...overrides };
}
function user(overrides: Partial<UserRow>): UserRow {
  return { id: "1", employee: "Jane Doe", userGroup: "DSR", region: "Nairobi", ...overrides };
}
function product(overrides: Partial<ProductRow>): ProductRow {
  return { id: "1", sapCode: "BIC12345", unitsPerCase: null, ...overrides };
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

  it("converts pieces to cases from each product UOM and preserves unavailable conversion", () => {
    const productsWithUom = [product({ id: "1", unitsPerCase: 12 }), product({ id: "2", sapCode: "BIC54321", unitsPerCase: 24 })];
    const { events } = collapseToPurchaseEvents(
      [factLine({ itemId: "1", qty: 24 }), factLine({ itemId: "2", qty: 12 })],
      outlets,
      users,
      productsWithUom,
      PRINCIPALS
    );
    expect(events[0].cases).toBe(2.5);

    const unknownUom = collapseToPurchaseEvents([factLine({ itemId: "1", qty: 24 })], outlets, users, products, PRINCIPALS);
    expect(unknownUom.events[0].cases).toBeNull();
  });

  it("keeps two different documents as two separate purchase events", () => {
    const lines = [factLine({ docId: "100" }), factLine({ docId: "101" })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(2);
  });

  it("keeps lines with an unresolvable SKU as a null-Cost-Centre event (still a real call/sale) and counts them as unmatched", () => {
    const lines = [factLine({ itemId: "99" })]; // no product with id "99"
    const { events, unmatchedSkuCount } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(1);
    expect(events[0].costCentre).toBeNull();
    expect(unmatchedSkuCount).toBe(1);
  });

  it("keeps lines whose SKU has no matching Active principal as a null-Cost-Centre event and counts them as unmatched", () => {
    const noMatchProducts = [product({ id: "1", sapCode: "ZZZ12345" })];
    const lines = [factLine({ itemId: "1" })];
    const { events, unmatchedSkuCount } = collapseToPurchaseEvents(lines, outlets, users, noMatchProducts, PRINCIPALS);
    expect(events).toHaveLength(1);
    expect(events[0].costCentre).toBeNull();
    expect(unmatchedSkuCount).toBe(1);
  });

  it("still drops a line when the outlet or user is genuinely unknown", () => {
    const lines = [factLine({ customerId: "unknown-outlet" })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(0);
  });

  it("still drops a line with non-positive qty or price (not a real sale)", () => {
    const lines = [factLine({ qty: 0 }), factLine({ docId: "101", unitPrice: 0 })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    expect(events).toHaveLength(0);
  });
});

describe("Calls Made vs Productive Calls — Cost-Centre resolution must not gate call/productivity status", () => {
  const outlets = [outlet({ id: "1" })];
  const users = [user({ id: "1", userGroup: "DSR" })];
  const noMatchProducts = [product({ id: "1", sapCode: "ZZZ12345" })]; // resolves to no known principal

  it("an unmapped-SKU sale still produces a purchase event with costCentre: null", () => {
    const lines = [factLine({ itemId: "1" })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, noMatchProducts, PRINCIPALS);
    expect(events).toHaveLength(1);
    expect(events[0].costCentre).toBeNull();
  });

  it("buildActiveOutletEvents excludes the null-Cost-Centre event (that module is inherently per-Cost-Centre)", () => {
    const lines = [factLine({ itemId: "1" })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, noMatchProducts, PRINCIPALS);
    const eventRows = buildActiveOutletEvents(events, outlets, users);
    expect(eventRows).toHaveLength(0);
  });

  it("buildRepCalls still counts the null-Cost-Centre event as a call and reports it as a productive Sale", () => {
    const lines = [factLine({ itemId: "1", purchaseTime: new Date("2026-07-10T09:00:00Z") })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, noMatchProducts, PRINCIPALS);
    const calls = buildRepCalls(events, [], outlets, users);
    expect(calls).toHaveLength(1);
    expect(calls[0].callOutcome).toBe("Sale");
    expect(calls[0].productiveInDay).toBe(1);
    expect(calls[0].costCentresBought).toBe(""); // no resolvable Cost Centre, but still a real productive call
  });
});

describe("buildActiveOutletEvents — one ledger row per resolvable purchase event", () => {
  const outlets = [outlet({ id: "1", name: "Corner Shop", subChannel: "Retailers", territory: "Nairobi" })];
  const users = [user({ id: "1", employee: "Jane Doe", userGroup: "DSR" })];
  const products = [product({ id: "1", sapCode: "BIC12345" })];

  it("produces one row per event with docId/isOrder/date/sales/qty/outlet/rep fields populated", () => {
    const lines = [factLine({ docId: "100", isOrder: false, itemId: "1", qty: 10, unitPrice: 5, purchaseTime: new Date("2026-07-10T09:00:00Z") })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    const rows = buildActiveOutletEvents(events, outlets, users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      year: "2026",
      principal: "Bic-Nairobi",
      customerId: "1",
      docId: "100",
      isOrder: false,
      sales: 50,
      qty: 10,
      salesRole: "Primary Sales",
      outletName: "Corner Shop",
      subChannel: "Retailers",
      territory: "Nairobi",
      repName: "Jane Doe",
      repGroup: "DSR",
    });
  });

  it("keeps two different documents as two separate ledger rows", () => {
    const lines = [factLine({ docId: "100" }), factLine({ docId: "101" })];
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    const rows = buildActiveOutletEvents(events, outlets, users);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.docId))).toEqual(new Set(["100", "101"]));
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

describe("buildRepCalls sales-role assignment", () => {
  it("uses all products on a call when assigning a TDR sales role", () => {
    const outlets = [outlet({ id: "1" })];
    const users = [user({ id: "1", userGroup: "TDR" })];
    const products = [product({ id: "1", sapCode: "BIC12345" }), product({ id: "2", sapCode: "MARS12345" })];
    const lines = [
      factLine({ docId: "100", itemId: "1", purchaseTime: new Date("2026-07-10T09:00:00Z") }),
      factLine({ docId: "101", itemId: "2", purchaseTime: new Date("2026-07-10T09:30:00Z") }),
    ];

    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, PRINCIPALS);
    const calls = buildRepCalls(events, [], outlets, users);

    expect(calls).toHaveLength(1);
    expect(calls[0].costCentresBought).toBe("Bic-Nairobi, Mars-Nairobi");
    expect(calls[0].salesRole).toBe("Secondary Sales");
  });
});
