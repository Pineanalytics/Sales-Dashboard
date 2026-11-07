import { describe, expect, it } from "vitest";
import { shapeRepActivity } from "@/lib/coachingRepActivity";

type CallFact = Parameters<typeof shapeRepActivity>[0]["calls"][number];

const call = (employeeCode: string, date: string, extra: Partial<CallFact> = {}): CallFact => ({
  employeeCode, date, calls: 10, productiveCalls: 6, sales: 1000, cases: 12, callsWithQty: 6, callsWithCases: 6, lines: 18, ...extra,
});

describe("shapeRepActivity", () => {
  it("uses the SAP value and cases when the rep has SAP rows, and the Pine calls for the rest", () => {
    const [sapRep, pineRep] = shapeRepActivity({
      codes: ["S1", "P1"],
      sap: [{ employeeCode: "S1", date: "2026-11-02", cases: 40, revenue: 50_000 }],
      calls: [call("S1", "2026-11-02"), call("P1", "2026-11-02")],
      jp: [],
    });
    expect(sapRep.source).toBe("sap");
    expect(sapRep.totals.value).toBe(50_000);
    expect(sapRep.totals.cases).toBe(40);
    expect(pineRep.source).toBe("pine_calls");
    expect(pineRep.totals.value).toBe(1000);
    expect(pineRep.totals.cases).toBe(12);
  });

  it("works out drop size and lines per productive call", () => {
    const [rep] = shapeRepActivity({
      codes: ["P1"],
      sap: [],
      calls: [call("P1", "2026-11-02"), call("P1", "2026-11-03", { calls: 10, productiveCalls: 4, cases: 8, lines: 10 })],
      jp: [],
    });
    expect(rep.totals.productiveCalls).toBe(10);
    expect(rep.totals.dropSize).toBe(2); // 20 cases / 10 productive calls
    expect(rep.totals.lppc).toBe(2.8); // 28 lines / 10 productive calls
    expect(rep.totals.strikeRatePct).toBe(50);
    expect(rep.totals.daysWorked).toBe(2);
  });

  it("says how complete the Pine volume is", () => {
    const [rep] = shapeRepActivity({ codes: ["P1"], sap: [], calls: [call("P1", "2026-11-02", { callsWithQty: 8, callsWithCases: 6 })], jp: [] });
    expect(rep.volumeCoveragePct).toBe(75);
  });

  it("leaves volume out rather than showing zero when cases cannot be worked out", () => {
    const [rep] = shapeRepActivity({ codes: ["P1"], sap: [], calls: [call("P1", "2026-11-02", { cases: null, callsWithCases: 0 })], jp: [] });
    expect(rep.totals.cases).toBeNull();
    expect(rep.totals.dropSize).toBeNull();
  });

  it("carries the journey plan figures, and a rep with no activity", () => {
    const [rep, quiet] = shapeRepActivity({
      codes: ["P1", "Q1"],
      sap: [],
      calls: [call("P1", "2026-11-02")],
      jp: [{ employeeCode: "P1", outletsPlanned: 50, outletsVisited: 40, plannedNotVisited: 10, jpAdherencePct: 80 }],
    });
    expect(rep.jp).toEqual({ outletsPlanned: 50, outletsVisited: 40, plannedNotVisited: 10, adherencePct: 80 });
    expect(quiet.source).toBeNull();
    expect(quiet.days).toEqual([]);
    expect(quiet.totals.dropSize).toBeNull();
  });
});
