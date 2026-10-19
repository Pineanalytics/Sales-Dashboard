import { describe, expect, it } from "vitest";
import {
  assignToBucket,
  buildGlobalAgeingReport,
  currentMonthLabel,
  describeFilters,
  monthLabels,
  monthsBetween,
  parseGlobalAgeingFilters,
  toSummary,
  UNCLASSIFIED_PRINCIPAL,
  withinPeriod,
  type GlobalAgeingChequeInput,
} from "../lib/globalAgeing";

const ASOF = new Date(Date.UTC(2026, 9, 13)); // 13 Oct 2026
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

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

const customers = [
  { customerCode: "C-1", customerName: "Alpha Traders", principal: "UPFIELD" },
  { customerCode: "C-2", customerName: "Beta Stores", principal: "UPFIELD" },
  { customerCode: "C-3", customerName: "Gamma Wholesale", principal: null },
  { customerCode: "C-4", customerName: "Delta Mart", principal: "EABL" },
];
const openItems = [
  { customerCode: "C-1", taxDate: day(2026, 10, 5), postingDate: day(2026, 10, 5), openBalance: 1000 }, // current month
  { customerCode: "C-1", taxDate: day(2026, 9, 1), postingDate: day(2026, 9, 1), openBalance: 500 }, // 1 month ago
  { customerCode: "C-2", taxDate: null, postingDate: day(2026, 10, 1), openBalance: 300 }, // falls back to postingDate (current month)
  { customerCode: "C-3", taxDate: day(2026, 10, 2), postingDate: day(2026, 10, 2), openBalance: -50 }, // a credit
  { customerCode: "C-4", taxDate: day(2026, 8, 15), postingDate: day(2026, 8, 15), openBalance: 700 }, // 2 months ago
];
const cheque = (over: Partial<GlobalAgeingChequeInput> = {}): GlobalAgeingChequeInput => ({ customerCode: "C-1", paymentNo: 5001, chequeNumber: 77, bankCode: "Equity", dueDate: day(2026, 10, 25), amount: 200, ...over });

describe("buildGlobalAgeingReport", () => {
  it("aggregates per customer, adds the post-dated cheques held, and rolls up per principal", () => {
    const report = buildGlobalAgeingReport(ASOF, openItems, customers, [cheque()]);

    const c1 = report.byCustomer.find((r) => r.customerCode === "C-1")!;
    expect(c1.balanceDue).toBe(1500);
    expect(c1.pdqCheques).toBe(200);
    expect(c1.totalDebts).toBe(1700); // Total Debts = Balance Due + PDQ Cheques
    expect(c1.buckets.currentMonth).toBe(1000);
    expect(c1.buckets.monthsAgo[0]).toBe(500);

    const c3 = report.byCustomer.find((r) => r.customerCode === "C-3")!;
    expect(c3.principal).toBe(UNCLASSIFIED_PRINCIPAL);
    expect(c3.balanceDue).toBe(-50);

    const upfield = report.byPrincipal.find((r) => r.principal === "UPFIELD")!;
    expect(upfield.balanceDue).toBe(1800); // C-1 1500 + C-2 300
    expect(upfield.totalDebts).toBe(2000); // + the 200 cheque
    expect(report.grandTotal.balanceDue).toBe(2450); // 1500 + 300 - 50 + 700
    expect(report.grandTotal.totalDebts).toBe(2650);
  });

  it("sums several cheques per customer and lists each of them with its customer and principal", () => {
    const report = buildGlobalAgeingReport(ASOF, openItems, customers, [cheque({ amount: 200 }), cheque({ paymentNo: 5002, chequeNumber: 78, amount: 300, dueDate: day(2026, 11, 3) })]);
    expect(report.byCustomer.find((r) => r.customerCode === "C-1")!.pdqCheques).toBe(500);
    expect(report.cheques).toHaveLength(2);
    expect(report.cheques[0]).toMatchObject({ customerName: "Alpha Traders", principal: "UPFIELD", bankCode: "Equity", dueDate: "2026-10-25" });
  });

  it("drops a customer with zero balance due and zero cheques", () => {
    const report = buildGlobalAgeingReport(ASOF, [{ customerCode: "C-9", taxDate: ASOF, postingDate: ASOF, openBalance: 0 }], [{ customerCode: "C-9", customerName: "Zero Co", principal: "EABL" }], []);
    expect(report.byCustomer).toHaveLength(0);
    expect(report.byPrincipal).toHaveLength(0);
  });

  it("keeps a customer whose balance nets to zero but still holds a cheque", () => {
    const report = buildGlobalAgeingReport(
      ASOF,
      [{ customerCode: "C-9", taxDate: ASOF, postingDate: ASOF, openBalance: -200 }],
      [{ customerCode: "C-9", customerName: "Zero Co", principal: "EABL" }],
      [cheque({ customerCode: "C-9", amount: 200 })]
    );
    expect(report.byCustomer).toHaveLength(1);
    expect(report.byCustomer[0].totalDebts).toBe(0);
  });

  it("keeps a customer that only holds a cheque (no open balance)", () => {
    const report = buildGlobalAgeingReport(ASOF, [], customers, [cheque({ customerCode: "C-4", amount: 900 })]);
    expect(report.byCustomer).toHaveLength(1);
    expect(report.byCustomer[0]).toMatchObject({ customerCode: "C-4", balanceDue: 0, pdqCheques: 900, totalDebts: 900 });
  });
});

describe("filters", () => {
  it("narrows to the chosen principals, case-insensitively, but still offers every principal", () => {
    const report = buildGlobalAgeingReport(ASOF, openItems, customers, [cheque()], { principals: ["upfield"], from: null, to: null });
    expect(report.byPrincipal.map((p) => p.principal)).toEqual(["UPFIELD"]);
    expect(report.byCustomer.map((c) => c.customerCode).sort()).toEqual(["C-1", "C-2"]);
    expect(report.grandTotal.totalDebts).toBe(2000);
    expect(report.availablePrincipals).toEqual(["EABL", UNCLASSIFIED_PRINCIPAL, "UPFIELD"]);
  });

  it("filters Unclassified like any principal", () => {
    const report = buildGlobalAgeingReport(ASOF, openItems, customers, [], { principals: [UNCLASSIFIED_PRINCIPAL], from: null, to: null });
    expect(report.byCustomer.map((c) => c.customerCode)).toEqual(["C-3"]);
  });

  it("filters open items by tax date and cheques by due date, inclusive of both ends, leaving the month buckets relative to the as-of date", () => {
    const sept = buildGlobalAgeingReport(ASOF, openItems, customers, [cheque({ dueDate: day(2026, 9, 30) }), cheque({ paymentNo: 5002, dueDate: day(2026, 10, 25), amount: 999 })], { principals: [], from: day(2026, 9, 1), to: day(2026, 9, 30) });
    expect(sept.grandTotal.balanceDue).toBe(500); // only C-1's 1 Sep item
    expect(sept.grandTotal.pdqCheques).toBe(200); // only the cheque due 30 Sep
    expect(sept.byCustomer[0].buckets.monthsAgo[0]).toBe(500); // still "1 month ago" against 13 Oct
  });

  it("supports an open-ended period", () => {
    const fromAugust = buildGlobalAgeingReport(ASOF, openItems, customers, [], { principals: [], from: day(2026, 8, 1), to: null });
    expect(fromAugust.grandTotal.balanceDue).toBe(2450);
    const upToAugust = buildGlobalAgeingReport(ASOF, openItems, customers, [], { principals: [], from: null, to: day(2026, 8, 31) });
    expect(upToAugust.grandTotal.balanceDue).toBe(700);
  });

  it("withinPeriod counts both end days", () => {
    expect(withinPeriod(day(2026, 9, 1), day(2026, 9, 1), day(2026, 9, 30))).toBe(true);
    expect(withinPeriod(day(2026, 9, 30), day(2026, 9, 1), day(2026, 9, 30))).toBe(true);
    expect(withinPeriod(day(2026, 10, 1), day(2026, 9, 1), day(2026, 9, 30))).toBe(false);
    expect(withinPeriod(day(2026, 8, 31), day(2026, 9, 1), day(2026, 9, 30))).toBe(false);
  });
});

describe("parseGlobalAgeingFilters", () => {
  const parse = (query: string) => parseGlobalAgeingFilters(new URLSearchParams(query));

  it("reads repeated and comma-separated principals", () => {
    expect(parse("principal=EABL&principal=Mars,UPFIELD&principal=EABL").filters.principals).toEqual(["EABL", "Mars", "UPFIELD"]);
  });

  it("turns a month into its first and last day", () => {
    const { filters, error } = parse("month=2026-02");
    expect(error).toBeNull();
    expect(filters.from?.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(filters.to?.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("reads a from and to date, either of which may be left out", () => {
    const both = parse("from=2026-09-01&to=2026-09-30").filters;
    expect([both.from?.toISOString().slice(0, 10), both.to?.toISOString().slice(0, 10)]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(parse("from=2026-09-01").filters.to).toBeNull();
    expect(parse("to=2026-09-30").filters.from).toBeNull();
  });

  it("lets a month win over from and to", () => {
    expect(parse("month=2026-03&from=2026-01-01&to=2026-01-31").filters.from?.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("rejects bad dates, a bad month and a reversed range", () => {
    expect(parse("month=2026-13").error).toMatch(/month/);
    expect(parse("from=2026-02-30").error).toMatch(/from date/);
    expect(parse("to=09/30/2026").error).toMatch(/to date/);
    expect(parse("from=2026-10-01&to=2026-09-01").error).toMatch(/after/);
  });

  it("has no filters by default", () => {
    expect(parse("").filters).toEqual({ principals: [], from: null, to: null });
  });
});

describe("describeFilters and toSummary", () => {
  it("describes the filters for the cover sheet and the file name", () => {
    expect(describeFilters({ principals: [], from: null, to: null })).toEqual({ principals: "All principals", period: "All dates", slug: "" });
    expect(describeFilters({ principals: ["Mars"], from: day(2026, 9, 1), to: day(2026, 9, 30) })).toEqual({ principals: "Mars", period: "2026-09-01 to 2026-09-30", slug: "mars-2026-09-01_2026-09-30" });
    expect(describeFilters({ principals: ["A", "B"], from: null, to: day(2026, 9, 30) }).slug).toBe("2-principals-start_2026-09-30");
  });

  it("gives the screen the pivot and the counts, without the customer and cheque rows", () => {
    const summary = toSummary(buildGlobalAgeingReport(ASOF, openItems, customers, [cheque()]));
    expect(summary.customerCount).toBe(4);
    expect(summary.chequeCount).toBe(1);
    expect(summary.byPrincipal.length).toBeGreaterThan(0);
    expect("byCustomer" in summary).toBe(false);
    expect("cheques" in summary).toBe(false);
  });
});
