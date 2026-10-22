import { describe, expect, it } from "vitest";
import { computeCoverageDistinct } from "../lib/coverageDistinct";
import { filterDatasetToPrincipals } from "../lib/datasetFilters";
import { summarizeCoverageForPeriod } from "../lib/timeIntelligence";
import type { CoverageDistinctRow, Dataset, MonthlyCoverageRow } from "../lib/types";

const cust = (principal: string, salesRole: string, customerId: string, productiveCalls: number) => ({ principal, salesRole, customerId, productiveCalls });

describe("distinct customer coverage rollup", () => {
  // c1 is called on by two Mars reps and also buys Suntory; c2 buys Mars only; c3 buys Suntory (Secondary) and has no sale.
  const rows = [
    cust("Mars-Nairobi", "Primary Sales", "c1", 2),
    cust("Mars-Nairobi", "Primary Sales", "c2", 0),
    cust("Suntory-Nairobi", "Primary Sales", "c1", 1),
    cust("Suntory-Nairobi", "Secondary Sales", "c3", 0),
  ];
  const rollup = computeCoverageDistinct("2026", 8, rows);
  const get = (principalKey: string, roleCategory: string) => rollup.find((r) => r.principalKey === principalKey && r.roleCategory === roleCategory);

  it("counts a customer once however many principals it buys from", () => {
    expect(get("*", "*")).toMatchObject({ customers: 3, productiveCustomers: 1 });
    expect(get("*", "primary")).toMatchObject({ customers: 2, productiveCustomers: 1 });
    expect(get("*", "secondary")).toMatchObject({ customers: 1, productiveCustomers: 0 });
  });

  it("keeps each brand and role separate", () => {
    expect(get("mars", "*")).toMatchObject({ customers: 2, productiveCustomers: 1 });
    expect(get("suntory", "*")).toMatchObject({ customers: 2, productiveCustomers: 1 });
    expect(get("suntory", "secondary")).toMatchObject({ customers: 1, productiveCustomers: 0 });
    expect(get("mars", "secondary")).toBeUndefined();
  });
});

function coverageRow(overrides: Partial<MonthlyCoverageRow>): MonthlyCoverageRow {
  return { year: "2026", month: "July", monthIndex: 6, salesRole: "Primary Sales", employeeName: "Rep A", principal: "Mars-Nairobi", principalKey: "mars", coverage: 0, productiveCalls: 0, productivityPct: 0, ...overrides };
}

function dataset(monthlyCoverage: MonthlyCoverageRow[], monthlyCoverageDistinct?: CoverageDistinctRow[]): Dataset {
  return { monthlySales: [], monthlyCoverage, monthlyCoverageDistinct, monthlyBrandCustomer: [], monthlyPL: [], stockItems: [] } as unknown as Dataset;
}

const d = (monthIndex: number, principalKey: string, roleCategory: string, customers: number, productiveCustomers: number): CoverageDistinctRow => ({ year: "2026", monthIndex, principalKey, roleCategory, customers, productiveCustomers });

// Two reps each count the same 100 Mars outlets (one shop served by two reps), and 50 Suntory outlets, 40 of them also Mars outlets.
const repRows = (monthIndex: number) => [
  coverageRow({ monthIndex, employeeName: "Rep A", coverage: 100, productiveCalls: 80 }),
  coverageRow({ monthIndex, employeeName: "Rep B", coverage: 100, productiveCalls: 70 }),
  coverageRow({ monthIndex, employeeName: "Rep C", principal: "Suntory-Nairobi", principalKey: "suntory", coverage: 50, productiveCalls: 40 }),
];
const distinctRows = (monthIndex: number) => [
  d(monthIndex, "*", "*", 110, 95), d(monthIndex, "*", "primary", 110, 95),
  d(monthIndex, "mars", "*", 100, 85), d(monthIndex, "mars", "primary", 100, 85),
  d(monthIndex, "suntory", "*", 50, 40), d(monthIndex, "suntory", "primary", 50, 40),
];
const july = { kind: "MONTH", year: "2026", month: "July" } as const;
const quarter = { kind: "Q3", year: "2026" } as const;

describe("period coverage counts each customer once", () => {
  it("keeps the old rep sum when there is no customer-level data", () => {
    const s = summarizeCoverageForPeriod(dataset(repRows(6)), july, null);
    expect(s).toMatchObject({ coverage: 250, productiveCalls: 190, basis: "rep-sum" });
  });

  it("uses the distinct count for every principal and for one principal", () => {
    const ds = dataset(repRows(6), distinctRows(6));
    expect(summarizeCoverageForPeriod(ds, july, null)).toMatchObject({ coverage: 110, productiveCalls: 95, productivityPct: 86.4, basis: "distinct" });
    expect(summarizeCoverageForPeriod(ds, july, "mars")).toMatchObject({ coverage: 100, productiveCalls: 85, basis: "distinct" });
    expect(summarizeCoverageForPeriod(ds, july, "Mars-Nairobi")).toMatchObject({ coverage: 100 });
  });

  it("applies a role to the distinct count, and a role with no customers is zero", () => {
    const ds = dataset(repRows(6), distinctRows(6));
    expect(summarizeCoverageForPeriod(ds, july, null, "primary")).toMatchObject({ coverage: 110 });
    expect(summarizeCoverageForPeriod(ds, july, "mars", "secondary")).toMatchObject({ coverage: 0, basis: "distinct" });
  });

  it("adds the rep sum of a principal with no customer data and calls the result mixed", () => {
    const eabl = coverageRow({ principal: "EABL-Nyeri", principalKey: "eabl", employeeName: "Rep E", coverage: 30, productiveCalls: 20 });
    const ds = dataset([...repRows(6), eabl], distinctRows(6));
    expect(summarizeCoverageForPeriod(ds, july, null)).toMatchObject({ coverage: 140, productiveCalls: 115, basis: "mixed" });
    expect(summarizeCoverageForPeriod(ds, july, "eabl")).toMatchObject({ coverage: 30, basis: "rep-sum" });
  });

  it("averages the months of a quarter, using the rep sum for a month with no customer data", () => {
    // July and August have distinct rows (110 each); September only has rep rows (250).
    const ds = dataset([...repRows(6), ...repRows(7), ...repRows(8)], [...distinctRows(6), ...distinctRows(7)]);
    const s = summarizeCoverageForPeriod(ds, quarter, null);
    expect(s.monthsIncluded).toBe(3);
    expect(s.coverage).toBe(Math.round((110 + 110 + 250) / 3));
    expect(s.basis).toBe("mixed");
  });
});

describe("scoping the distinct rows to the selected principals", () => {
  const ds = dataset(repRows(6), distinctRows(6));

  it("drops the all-principals rows when several principals are kept", () => {
    const scoped = filterDatasetToPrincipals(ds, new Set(["mars", "suntory"]));
    expect(scoped.monthlyCoverageDistinct?.some((row) => row.principalKey === "*")).toBe(false);
    expect(summarizeCoverageForPeriod(scoped, july, null)).toMatchObject({ coverage: 250, basis: "rep-sum" });
    expect(summarizeCoverageForPeriod(scoped, july, "mars")).toMatchObject({ coverage: 100, basis: "distinct" });
  });

  it("lets a single kept principal stand for the whole selection", () => {
    const scoped = filterDatasetToPrincipals(ds, new Set(["mars"]));
    expect(summarizeCoverageForPeriod(scoped, july, null)).toMatchObject({ coverage: 100, productiveCalls: 85, basis: "distinct" });
  });
});
