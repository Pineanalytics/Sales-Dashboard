import { describe, expect, it } from "vitest";
import { averageRepCoverage, buildRepPerformanceRows, computeRepTarget, type RepPerformanceEmployee, type PrincipalMonthTarget } from "@/lib/repPerformance";

const months = [{ year: "2026", monthIndex: 6 }];

describe("computeRepTarget", () => {
  const targets: PrincipalMonthTarget[] = [{ principal: "Bic-Nairobi", year: "2026", monthIndex: 6, valueTarget: 1_000_000 }];

  it("splits a principal's target across contributing reps proportionally to their declared %", () => {
    const repA = computeRepTarget([{ principal: "Bic-Nairobi", contributionPct: 0.6 }], targets, months, null);
    const repB = computeRepTarget([{ principal: "Bic-Nairobi", contributionPct: 0.4 }], targets, months, null);
    expect(repA).toBe(600_000);
    expect(repB).toBe(400_000);
    expect(repA + repB).toBe(1_000_000);
  });

  it("sums across every principal a rep contributes to when no principal filter is active", () => {
    const multiTargets: PrincipalMonthTarget[] = [
      { principal: "Bic-Nairobi", year: "2026", monthIndex: 6, valueTarget: 1_000_000 },
      { principal: "Mars-Nairobi", year: "2026", monthIndex: 6, valueTarget: 500_000 },
    ];
    const total = computeRepTarget(
      [
        { principal: "Bic-Nairobi", contributionPct: 0.5 },
        { principal: "Mars-Nairobi", contributionPct: 0.2 },
      ],
      multiTargets,
      months,
      null
    );
    expect(total).toBe(500_000 + 100_000);
  });

  it("narrows to only the matching principal's contribution when a principal filter is active", () => {
    const contributions = [
      { principal: "Bic-Nairobi", contributionPct: 0.5 },
      { principal: "Mars-Nairobi", contributionPct: 0.2 },
    ];
    const multiTargets: PrincipalMonthTarget[] = [
      { principal: "Bic-Nairobi", year: "2026", monthIndex: 6, valueTarget: 1_000_000 },
      { principal: "Mars-Nairobi", year: "2026", monthIndex: 6, valueTarget: 500_000 },
    ];
    expect(computeRepTarget(contributions, multiTargets, months, "mars")).toBe(100_000);
  });

  it("ignores target rows outside the selected months", () => {
    const otherMonthTargets: PrincipalMonthTarget[] = [{ principal: "Bic-Nairobi", year: "2026", monthIndex: 5, valueTarget: 1_000_000 }];
    expect(computeRepTarget([{ principal: "Bic-Nairobi", contributionPct: 1 }], otherMonthTargets, months, null)).toBe(0);
  });
});

describe("averageRepCoverage", () => {
  it("averages coverage/productiveCalls across months rather than summing them", () => {
    const result = averageRepCoverage([
      { coverage: 40, productiveCalls: 30 },
      { coverage: 60, productiveCalls: 50 },
    ]);
    expect(result.coverage).toBe(50);
    expect(result.productiveCalls).toBe(40);
    expect(result.productivityPct).toBe(80);
  });

  it("returns zeros for an empty month set instead of dividing by zero", () => {
    expect(averageRepCoverage([])).toEqual({ coverage: 0, productiveCalls: 0, productivityPct: 0 });
  });
});

function employee(overrides: Partial<RepPerformanceEmployee>): RepPerformanceEmployee {
  return {
    employeeCode: "E1",
    pineName: "Test Rep",
    sapName: "Test Rep",
    teamLeader: "Eve",
    salesRole: "Primary Sales",
    absolutePrincipal: "Bic-Nairobi",
    active: true,
    contributions: [{ principal: "Bic-Nairobi", contributionPct: 1 }],
    ...overrides,
  };
}

describe("buildRepPerformanceRows", () => {
  const targets: PrincipalMonthTarget[] = [{ principal: "Bic-Nairobi", year: "2026", monthIndex: 6, valueTarget: 1_000_000 }];
  const coverageByRepMonth = [{ employeeCode: "E1", year: "2026", monthIndex: 6, coverage: 50, productiveCalls: 40, totalCalls: 45 }];

  it("computes a Primary rep's target and achievement %", () => {
    const rows = buildRepPerformanceRows({
      employees: [employee({})],
      coverageByRepMonth,
      targets,
      sapRows: [{ year: "2026", monthIndex: 6, principal: "Bic-Nairobi", sapName: "Test Rep", employeeCode: "E1", employeeName: "Test Rep", salesRole: "Primary Sales", volume: 10, revenue: 500_000, grossProfit: 100_000 }],
      months,
      principalKey: null,
      teamLeaderFilter: null,
      salesRoleFilter: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe(1_000_000);
    expect(rows[0].achievementPct).toBe(50);
    expect(rows[0].coverage).toBe(50);
    expect(rows[0].productivityPct).toBe(80);
  });

  it("leaves target null for Secondary Sales reps but still computes coverage", () => {
    const rows = buildRepPerformanceRows({
      employees: [employee({ salesRole: "Secondary Sales" })],
      coverageByRepMonth,
      targets,
      sapRows: [],
      months,
      principalKey: null,
      teamLeaderFilter: null,
      salesRoleFilter: null,
    });
    expect(rows[0].target).toBeNull();
    expect(rows[0].achievementPct).toBeNull();
    expect(rows[0].coverage).toBe(50);
  });

  it("nulls out coverage when the principal filter doesn't match the rep's absolute principal, but still shows their target for a matching contribution", () => {
    const rows = buildRepPerformanceRows({
      employees: [
        employee({
          absolutePrincipal: "Suntory-Nairobi",
          contributions: [
            { principal: "Suntory-Nairobi", contributionPct: 0.8 },
            { principal: "Bic-Nairobi", contributionPct: 0.5 },
          ],
        }),
      ],
      coverageByRepMonth,
      targets,
      sapRows: [],
      months,
      principalKey: "bic",
      teamLeaderFilter: null,
      salesRoleFilter: null,
    });
    expect(rows[0].coverage).toBeNull();
    expect(rows[0].target).toBe(500_000);
  });

  it("excludes a rep entirely when neither their absolute principal nor any contribution matches the filter", () => {
    const rows = buildRepPerformanceRows({
      employees: [employee({ absolutePrincipal: "Suntory-Nairobi", contributions: [{ principal: "Suntory-Nairobi", contributionPct: 1 }] })],
      coverageByRepMonth,
      targets,
      sapRows: [],
      months,
      principalKey: "bic",
      teamLeaderFilter: null,
      salesRoleFilter: null,
    });
    expect(rows).toHaveLength(0);
  });

  it("filters by team leader and sales role", () => {
    const employees = [employee({ employeeCode: "E1", teamLeader: "Eve" }), employee({ employeeCode: "E2", teamLeader: "Josephat", salesRole: "Secondary Sales" })];
    const byTeamLeader = buildRepPerformanceRows({
      employees,
      coverageByRepMonth: [],
      targets: [],
      sapRows: [],
      months,
      principalKey: null,
      teamLeaderFilter: "Eve",
      salesRoleFilter: null,
    });
    expect(byTeamLeader.map((r) => r.employeeCode)).toEqual(["E1"]);

    const byRole = buildRepPerformanceRows({
      employees,
      coverageByRepMonth: [],
      targets: [],
      sapRows: [],
      months,
      principalKey: null,
      teamLeaderFilter: null,
      salesRoleFilter: "Secondary Sales",
    });
    expect(byRole.map((r) => r.employeeCode)).toEqual(["E2"]);
  });

  it("keeps unmatched SAP revenue visible with no team leader, excluded once a team leader filter is active", () => {
    const sapRows = [{ year: "2026", monthIndex: 6, principal: "Bic-Nairobi", sapName: "Ghost Rep", employeeCode: null, employeeName: "Ghost Rep", salesRole: null, volume: 1, revenue: 10_000, grossProfit: 1_000 }];
    const withoutFilter = buildRepPerformanceRows({ employees: [], coverageByRepMonth: [], targets: [], sapRows, months, principalKey: null, teamLeaderFilter: null, salesRoleFilter: null });
    expect(withoutFilter).toHaveLength(1);
    expect(withoutFilter[0].employeeCode).toBeNull();

    const withFilter = buildRepPerformanceRows({ employees: [], coverageByRepMonth: [], targets: [], sapRows, months, principalKey: null, teamLeaderFilter: "Eve", salesRoleFilter: null });
    expect(withFilter).toHaveLength(0);
  });
});
