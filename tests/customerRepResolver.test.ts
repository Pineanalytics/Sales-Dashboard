import { describe, expect, it } from "vitest";
import { buildCustomerRepResolver, buildGlobalAgeingReport, NO_REP, type RepResolverEmployee } from "@/lib/globalAgeing";

const emp = (employeeCode: string, pineName: string, sapName: string, active = true, sapSlpCode: number | null = null): RepResolverEmployee => ({ employeeCode, pineName, sapName, active, sapSlpCode });
const SAP_REPS = [
  { slpCode: 281, name: "Florence Ouma", active: true },
  { slpCode: 21, name: "SHARON MUTINDI", active: true },
  { slpCode: 52, name: "DO NOT USE", active: false },
];

describe("buildCustomerRepResolver", () => {
  it("returns nothing for a customer with no assigned rep", () => {
    const resolve = buildCustomerRepResolver(SAP_REPS, [], []);
    expect(resolve(null)).toEqual(NO_REP);
    expect(resolve(undefined)).toEqual(NO_REP);
    expect(resolve(-1)).toEqual(NO_REP);
  });

  it("uses an explicit link, and shows the roster employee's code and name", () => {
    const resolve = buildCustomerRepResolver(SAP_REPS, [{ employeeCode: "1221", slpCode: 281 }], [emp("1221", "Florence Ouma", "Florence Ouma"), emp("1114", "Florence Ouma", "Florence Ouma", false)]);
    expect(resolve(281)).toEqual({ assignedRep: "Florence Ouma", employeeCode: "1221", employeeName: "Florence Ouma", employeeLink: "Linked", sapStatus: "Active" });
  });

  it("also reads the roster's own SAP code, and shows only the active rows when one rep is several roster codes", () => {
    const employees = [emp("1114", "Florence Ouma", "Florence Ouma", false, 281), emp("1221", "Florence Ouma", "Florence Ouma", true, 281), emp("1300", "Second Code", "Florence Ouma", true, 281)];
    const resolve = buildCustomerRepResolver(SAP_REPS, [], employees);
    expect(resolve(281)).toMatchObject({ employeeCode: "1221 / 1300", employeeName: "Florence Ouma / Second Code", employeeLink: "Linked" });
  });

  it("falls back to an exact, unique SAP-name match when nothing is linked", () => {
    const resolve = buildCustomerRepResolver(SAP_REPS, [], [emp("1500", "Sharon M", "sharon  mutindi")]);
    expect(resolve(21)).toEqual({ assignedRep: "SHARON MUTINDI", employeeCode: "1500", employeeName: "Sharon M", employeeLink: "Name match", sapStatus: "Active" });
  });

  it("does not guess between two active roster rows with the same SAP name", () => {
    const resolve = buildCustomerRepResolver(SAP_REPS, [], [emp("1", "A", "Sharon Mutindi"), emp("2", "B", "Sharon Mutindi")]);
    expect(resolve(21)).toMatchObject({ employeeCode: "", employeeLink: "Not on roster" });
  });

  it("names the SAP rep even when the roster has no one, and handles a code the directory does not know", () => {
    const resolve = buildCustomerRepResolver(SAP_REPS, [], []);
    expect(resolve(52)).toEqual({ assignedRep: "DO NOT USE", employeeCode: "", employeeName: "", employeeLink: "Not on roster", sapStatus: "Inactive" });
    expect(resolve(999)).toMatchObject({ assignedRep: "SlpCode 999", employeeLink: "Not on roster", sapStatus: "Unknown" });
  });

  it("flags an SAP-inactive rep even when a roster employee is linked, and leaves the status blank with no rep", () => {
    const resolve = buildCustomerRepResolver(SAP_REPS, [{ employeeCode: "1", slpCode: 52 }], [emp("1", "Someone", "Someone")]);
    expect(resolve(52)).toMatchObject({ employeeLink: "Linked", sapStatus: "Inactive" });
    expect(resolve(null).sapStatus).toBe("");
  });
});

describe("buildGlobalAgeingReport with a rep resolver", () => {
  it("puts the rep on the customer and cheque rows, and nothing when no resolver is given", () => {
    const asOf = new Date(Date.UTC(2026, 10, 14));
    const items = [{ customerCode: "C-1", taxDate: new Date(Date.UTC(2026, 10, 1)), postingDate: new Date(Date.UTC(2026, 10, 1)), openBalance: 100 }];
    const customers = [{ customerCode: "C-1", customerName: "Alpha", principal: "UPFIELD", slpCode: 281 }];
    const cheques = [{ customerCode: "C-1", paymentNo: 1, chequeNumber: 5, bankCode: "B", dueDate: new Date(Date.UTC(2026, 11, 1)), amount: 50 }];
    const resolve = buildCustomerRepResolver(SAP_REPS, [{ employeeCode: "1221", slpCode: 281 }], [emp("1221", "Florence Ouma", "Florence Ouma")]);
    const withRep = buildGlobalAgeingReport(asOf, items, customers, cheques, undefined, resolve);
    expect(withRep.byCustomer[0].rep).toMatchObject({ assignedRep: "Florence Ouma", employeeCode: "1221" });
    expect(withRep.cheques[0].rep.employeeName).toBe("Florence Ouma");
    expect(buildGlobalAgeingReport(asOf, items, customers, cheques).byCustomer[0].rep).toEqual(NO_REP);
  });
});
