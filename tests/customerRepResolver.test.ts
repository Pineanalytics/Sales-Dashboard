import { describe, expect, it } from "vitest";
import { buildCustomerRepResolver, buildGlobalAgeingReport, describeFilters, NO_REP, parseGlobalAgeingFilters } from "@/lib/globalAgeing";

const SAP_REPS = [
  { slpCode: 281, name: "Florence Ouma", active: true },
  { slpCode: 33, name: " Charles Kibe ", active: false },
];

describe("buildCustomerRepResolver", () => {
  it("returns nothing for a customer with no assigned SAP employee (null, missing or SAP's -1)", () => {
    const resolve = buildCustomerRepResolver(SAP_REPS);
    expect(resolve(null)).toEqual(NO_REP);
    expect(resolve(undefined)).toEqual(NO_REP);
    expect(resolve(-1)).toEqual(NO_REP);
  });

  it("gives the SAP employee code and name, straight from the salesperson list, flagged active", () => {
    expect(buildCustomerRepResolver(SAP_REPS)(281)).toEqual({ employeeCode: "281", employeeName: "Florence Ouma", sapStatus: "Active" });
  });

  it("flags a switched-off or locked salesperson as Inactive, trimming the name", () => {
    expect(buildCustomerRepResolver(SAP_REPS)(33)).toEqual({ employeeCode: "33", employeeName: "Charles Kibe", sapStatus: "Inactive" });
  });

  it("keeps the code and marks the status Unknown when the salesperson list has no such code", () => {
    expect(buildCustomerRepResolver(SAP_REPS)(999)).toEqual({ employeeCode: "999", employeeName: "", sapStatus: "Unknown" });
  });
});

describe("buildGlobalAgeingReport with a rep resolver", () => {
  it("puts the SAP employee on the customer and cheque rows, and nothing when no resolver is given", () => {
    const asOf = new Date(Date.UTC(2026, 10, 14));
    const items = [{ customerCode: "C-1", taxDate: new Date(Date.UTC(2026, 10, 1)), postingDate: new Date(Date.UTC(2026, 10, 1)), openBalance: 100 }];
    const customers = [{ customerCode: "C-1", customerName: "Alpha", principal: "UPFIELD", slpCode: 281 }];
    const cheques = [{ customerCode: "C-1", paymentNo: 1, chequeNumber: 5, bankCode: "B", dueDate: new Date(Date.UTC(2026, 11, 1)), amount: 50 }];
    const withRep = buildGlobalAgeingReport(asOf, items, customers, cheques, undefined, buildCustomerRepResolver(SAP_REPS));
    expect(withRep.byCustomer[0].rep).toEqual({ employeeCode: "281", employeeName: "Florence Ouma", sapStatus: "Active" });
    expect(withRep.cheques[0].rep.employeeName).toBe("Florence Ouma");
    expect(buildGlobalAgeingReport(asOf, items, customers, cheques).byCustomer[0].rep).toEqual(NO_REP);
  });
});

describe("SAP rep status on the pivot", () => {
  const asOf = new Date(Date.UTC(2026, 10, 14));
  const day = new Date(Date.UTC(2026, 10, 1));
  const item = (customerCode: string, openBalance: number) => ({ customerCode, taxDate: day, postingDate: day, openBalance });
  const items = [item("C-1", 100), item("C-2", 200), item("C-3", 400), item("C-4", 800)];
  const customers = [
    { customerCode: "C-1", customerName: "A", principal: "UPFIELD", slpCode: 281 },
    { customerCode: "C-2", customerName: "B", principal: "UPFIELD", slpCode: 33 },
    { customerCode: "C-3", customerName: "C", principal: "MARS", slpCode: null },
    { customerCode: "C-4", customerName: "D", principal: "MARS", slpCode: 999 },
  ];
  const repOf = buildCustomerRepResolver(SAP_REPS);

  it("groups the totals by rep status and counts the debts held with inactive reps per principal", () => {
    const report = buildGlobalAgeingReport(asOf, items, customers, [], undefined, repOf);
    expect(report.byRepStatus.map((r) => [r.status, r.customers, r.totalDebts])).toEqual([
      ["Active", 1, 100],
      ["Inactive", 1, 200],
      ["Unknown", 1, 800],
      ["Unassigned", 1, 400],
    ]);
    expect(report.byPrincipal.find((p) => p.principal === "UPFIELD")?.inactiveRepDebts).toBe(200);
    expect(report.byPrincipal.find((p) => p.principal === "MARS")?.inactiveRepDebts).toBe(0);
    expect(report.byRepStatus.reduce((s, r) => s + r.totalDebts, 0)).toBe(report.grandTotal.totalDebts);
  });

  it("narrows everything to the chosen status; 'none' covers both no rep and an unknown code", () => {
    const inactive = buildGlobalAgeingReport(asOf, items, customers, [], { principals: [], from: null, to: null, repStatus: "inactive" }, repOf);
    expect(inactive.byCustomer.map((c) => c.customerCode)).toEqual(["C-2"]);
    expect(inactive.grandTotal.totalDebts).toBe(200);
    expect(inactive.filters.repStatus).toBe("inactive");
    const none = buildGlobalAgeingReport(asOf, items, customers, [], { principals: [], from: null, to: null, repStatus: "none" }, repOf);
    expect(none.byCustomer.map((c) => c.customerCode).sort()).toEqual(["C-3", "C-4"]);
    // The principal list stays complete so the filter never loses options.
    expect(inactive.availablePrincipals).toEqual(["MARS", "UPFIELD"]);
  });

  it("reads and describes the repStatus filter, rejecting anything else", () => {
    expect(parseGlobalAgeingFilters(new URLSearchParams("repStatus=Inactive")).filters.repStatus).toBe("inactive");
    expect(parseGlobalAgeingFilters(new URLSearchParams("repStatus=bogus")).error).toMatch(/rep status/);
    expect(parseGlobalAgeingFilters(new URLSearchParams("")).filters.repStatus).toBeUndefined();
    const described = describeFilters({ principals: [], from: null, to: null, repStatus: "inactive" });
    expect(described.repStatus).toBe("Inactive reps");
    expect(described.slug).toBe("inactive-reps");
  });
});
