import { describe, expect, it } from "vitest";
import { buildCoverage, type PrincipalRow } from "../scripts/db-bridge/coverage/transform";
import type { PineFactRow } from "../scripts/db-bridge/coverage/query";
import { buildStrikeData, outletStrike, strikeRatePct } from "../lib/outletUniverse/strikeRate";

const principals: PrincipalRow[] = [
  { key: "1", principal: "Mars-Nairobi", mainPrincipal: "Mars", location: "Nairobi", locationCode: "1", status: "Active", teamLeader: "" },
  { key: "2", principal: "EFL-Nairobi", mainPrincipal: "EFL", location: "Nairobi", locationCode: "1", status: "Active", teamLeader: "" },
];

function call(employee: string, customerId: string, type: PineFactRow["type"], sapCode: string | null, revenue = 0, qty = 0): PineFactRow {
  return { type, date: new Date("2026-09-10T08:00:00Z"), userId: employee, employee, userGroup: "TDR", userRegion: null, customerId, customerName: customerId, customerType: null, sourceChannel: null, territory: null, latitude: null, longitude: null, sapCode, productName: null, uom: null, qty, revenue };
}

describe("coverage transform, customer level", () => {
  const raw: PineFactRow[] = [
    // Ann sells Mars at C1 and visits C2 without a sale; Bob also sells Mars at C1; Ann sells Mars at C3.
    call("Ann", "C1", "sale", "MARS-1", 100, 2),
    call("Bob", "C1", "sale", "MARS-1", 50, 1),
    call("Ann", "C2", "nosale", null),
    call("Ann", "C3", "sale", "MARS-2", 80, 4),
    // Eve visits C4 and sells EFL.
    call("Eve", "C4", "sale", "CEY-1", 30, 3),
  ];

  it("counts reps that called and reps that were productive per customer", () => {
    const { customerRows } = buildCoverage(raw, principals);
    const mars = customerRows.filter((r) => r.principal === "Mars-Nairobi");
    const byCustomer = Object.fromEntries(mars.map((r) => [r.customerId, [r.coverage, r.productiveCalls]]));
    expect(byCustomer.C1).toEqual([2, 2]);
    expect(byCustomer.C3).toEqual([1, 1]);
  });

  it("adds up to the per-rep coverage totals of the same principal and month", () => {
    const { rows, customerRows } = buildCoverage(raw, principals);
    for (const principal of ["Mars-Nairobi", "EFL-Nairobi"]) {
      const repCalls = rows.filter((r) => r.principal === principal).reduce((s, r) => s + r.coverage, 0);
      const repProductive = rows.filter((r) => r.principal === principal).reduce((s, r) => s + r.productiveCalls, 0);
      const customers = customerRows.filter((r) => r.principal === principal);
      expect(customers.reduce((s, r) => s + r.coverage, 0)).toBe(repCalls);
      expect(customers.reduce((s, r) => s + r.productiveCalls, 0)).toBe(repProductive);
    }
  });
});

describe("outlet strike rate", () => {
  const data = buildStrikeData("2026", [
    { principal: "Mars-Nairobi", customerId: "C1", calls: 4, productive: 3 },
    { principal: "Mars-Nairobi", customerId: "C2", calls: 4, productive: 1 },
    { principal: "EFL-Nairobi", customerId: "C1", calls: 2, productive: 2 },
  ]);

  it("rounds to one decimal and is null without calls", () => {
    expect(strikeRatePct({ calls: 3, productive: 2 })).toBe(66.7);
    expect(strikeRatePct({ calls: 0, productive: 0 })).toBeNull();
    expect(strikeRatePct(undefined)).toBeNull();
  });

  it("gives a customer's rate and the principal's rate added up over all its customers", () => {
    const row = outletStrike({ source: "PINE", outletKey: "C1", principals: "Mars-Nairobi" }, data);
    expect(row).toMatchObject({ calls: 4, productive: 3, pct: 75, principalPct: 50 }); // Mars: (3+1)/(4+4)
    expect(row.byPrincipal).toBe("Mars-Nairobi: 75.0% (3/4)");
  });

  it("combines an outlet's principals in the general view", () => {
    const row = outletStrike({ source: "PINE", outletKey: "C1", principals: "EFL-Nairobi, Mars-Nairobi" }, data);
    expect(row).toMatchObject({ calls: 6, productive: 5, pct: 83.3 });
    expect(row.byPrincipal).toBe("EFL-Nairobi: 100.0% (2/2); Mars-Nairobi: 75.0% (3/4)");
    expect(row.principalPct).toBe("EFL-Nairobi: 100.0%; Mars-Nairobi: 50.0%");
  });

  it("is blank for other sources, and zero calls for a Pine outlet never called", () => {
    expect(outletStrike({ source: "LEVERAGE", outletKey: "C1", principals: "Mars-Nairobi" }, data).calls).toBeNull();
    expect(outletStrike({ source: "PINE", outletKey: "C9", principals: "Mars-Nairobi" }, data)).toMatchObject({ calls: 0, productive: 0, pct: null });
  });
});
