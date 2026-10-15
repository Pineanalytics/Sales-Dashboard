import { describe, expect, it } from "vitest";
import { assignToBucket, buildGlobalAgeingReport, currentMonthLabel, monthLabels, monthsBetween, UNCLASSIFIED_PRINCIPAL } from "../lib/globalAgeing";

const ASOF = new Date(Date.UTC(2026, 9, 13)); // 13 Oct 2026

describe("monthsBetween", () => {
  it("is 0 for the same calendar month", () => {
    expect(monthsBetween(ASOF, new Date(Date.UTC(2026, 9, 1)))).toBe(0);
  });
  it("is positive for a past month, negative for a future one", () => {
    expect(monthsBetween(ASOF, new Date(Date.UTC(2026, 8, 30)))).toBe(1); // Sept -> 1 month ago
    expect(monthsBetween(ASOF, new Date(Date.UTC(2025, 9, 1)))).toBe(12); // a year ago
    expect(monthsBetween(ASOF, new Date(Date.UTC(2026, 10, 1)))).toBe(-1); // next month
  });
});

describe("assignToBucket", () => {
  it("routes future/current/N-months-ago/over-12 to the right slot", () => {
    const buckets = { future: 0, currentMonth: 0, monthsAgo: new Array(12).fill(0), over12: 0 };
    assignToBucket(buckets, ASOF, new Date(Date.UTC(2026, 10, 1)), 100); // future
    assignToBucket(buckets, ASOF, new Date(Date.UTC(2026, 9, 5)), 200); // current month
    assignToBucket(buckets, ASOF, new Date(Date.UTC(2026, 8, 20)), 300); // 1 month ago
    assignToBucket(buckets, ASOF, new Date(Date.UTC(2025, 9, 1)), 400); // 12 months ago
    assignToBucket(buckets, ASOF, new Date(Date.UTC(2024, 0, 1)), 500); // over 12
    expect(buckets.future).toBe(100);
    expect(buckets.currentMonth).toBe(200);
    expect(buckets.monthsAgo[0]).toBe(300);
    expect(buckets.monthsAgo[11]).toBe(400);
    expect(buckets.over12).toBe(500);
  });
});

describe("monthLabels / currentMonthLabel", () => {
  it("produces 12 oldest-first-indexed labels plus the current month's own label", () => {
    const labels = monthLabels(ASOF);
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe("Sep 2026");
    expect(labels[11]).toBe("Oct 2025");
    expect(currentMonthLabel(ASOF)).toBe("Oct 2026");
  });
});

describe("buildGlobalAgeingReport", () => {
  const customers = [
    { customerCode: "C-1", customerName: "Alpha Traders", principal: "UPFIELD" },
    { customerCode: "C-2", customerName: "Beta Stores", principal: "UPFIELD" },
    { customerCode: "C-3", customerName: "Gamma Wholesale", principal: null },
  ];
  const openItems = [
    { customerCode: "C-1", taxDate: new Date(Date.UTC(2026, 9, 5)), postingDate: new Date(Date.UTC(2026, 9, 5)), openBalance: 1000 }, // current month
    { customerCode: "C-1", taxDate: new Date(Date.UTC(2026, 8, 1)), postingDate: new Date(Date.UTC(2026, 8, 1)), openBalance: 500 }, // 1 month ago
    { customerCode: "C-2", taxDate: null, postingDate: new Date(Date.UTC(2026, 9, 1)), openBalance: 300 }, // falls back to postingDate (current month)
    { customerCode: "C-3", taxDate: new Date(Date.UTC(2026, 9, 2)), postingDate: new Date(Date.UTC(2026, 9, 2)), openBalance: -50 }, // a credit
  ];

  it("aggregates per customer, merges PDQ cheques, and rolls up per principal", () => {
    const report = buildGlobalAgeingReport(ASOF, openItems, customers, [{ customerCode: "C-1", amount: 200 }]);

    const c1 = report.byCustomer.find((r) => r.customerCode === "C-1")!;
    expect(c1.balanceDue).toBe(1500);
    expect(c1.pdqCheques).toBe(200);
    expect(c1.totalDebts).toBe(1700);
    expect(c1.buckets.currentMonth).toBe(1000);
    expect(c1.buckets.monthsAgo[0]).toBe(500);

    const c3 = report.byCustomer.find((r) => r.customerCode === "C-3")!;
    expect(c3.principal).toBe(UNCLASSIFIED_PRINCIPAL);
    expect(c3.balanceDue).toBe(-50);

    const upfield = report.byPrincipal.find((r) => r.principal === "UPFIELD")!;
    expect(upfield.balanceDue).toBe(1800); // C-1 1500 + C-2 300
    expect(upfield.totalDebts).toBe(2000); // + the 200 PDQ

    expect(report.grandTotal.balanceDue).toBe(1750); // 1500 + 300 - 50
    expect(report.grandTotal.totalDebts).toBe(1950);
  });

  it("drops a customer with zero balance due and zero PDQ cheques", () => {
    const report = buildGlobalAgeingReport(
      ASOF,
      [{ customerCode: "C-9", taxDate: ASOF, postingDate: ASOF, openBalance: 0 }],
      [{ customerCode: "C-9", customerName: "Zero Co", principal: "EABL" }],
      []
    );
    expect(report.byCustomer).toHaveLength(0);
    expect(report.byPrincipal).toHaveLength(0);
  });

  it("keeps a customer whose balance nets to zero but still carries a nonzero PDQ entry", () => {
    const report = buildGlobalAgeingReport(
      ASOF,
      [{ customerCode: "C-9", taxDate: ASOF, postingDate: ASOF, openBalance: -200 }],
      [{ customerCode: "C-9", customerName: "Zero Co", principal: "EABL" }],
      [{ customerCode: "C-9", amount: 200 }]
    );
    expect(report.byCustomer).toHaveLength(1);
    expect(report.byCustomer[0].totalDebts).toBe(0);
  });
});
