import { describe, expect, it } from "vitest";
import { buildCustomerRepResolver, buildGlobalAgeingReport, NO_REP } from "@/lib/globalAgeing";

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
