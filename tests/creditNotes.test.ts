import { describe, expect, it } from "vitest";
import { aggregateCreditNotes, lineMatchesQuery, priorWindow, shiftMonth } from "@/lib/creditNotes/aggregate";
import { parseCreditNotesParams } from "@/lib/creditNotes/request";
import { earliestNeededMonth } from "@/lib/creditNotes/store";
import { lineInScope, lineScopeFrom } from "@/lib/creditNotes/scope";
import { buildCreditNotesSheets } from "@/lib/creditNotes/workbook";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";
import type { PerfLine } from "@/lib/performanceAnalysis/types";

function line(over: Partial<PerfLine>): PerfLine {
  return { month: "2026-10", doc: "invoice", customerCode: "C1", customerName: "Shop One", rep: "Amina", principal: "Mars", itemCode: "I1", itemName: "Bar", warehouse: "NBO", cases: 10, sales: 1000, gp: 200, ...over };
}
const credit = (over: Partial<PerfLine>) => line({ doc: "credit", cases: -1, sales: -100, gp: -20, ...over });

describe("month helpers", () => {
  it("shifts across year ends in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 3)).toBe("2027-02");
    expect(shiftMonth("2026-05", 0)).toBe("2026-05");
  });
  it("lists the equal-length window before a period, oldest first", () => {
    expect(priorWindow("2026-10", 3)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(priorWindow("2026-02", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
  it("reaches back for whichever of the trend or the comparison starts earlier", () => {
    expect(earliestNeededMonth(["2026-10"])).toBe("2025-11");
    expect(earliestNeededMonth(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"])).toBe("2025-02");
  });
});

describe("the credit-note figures", () => {
  const lines: PerfLine[] = [
    // prior month (September)
    line({ month: "2026-09", sales: 800 }),
    credit({ month: "2026-09", sales: -40, cases: -1, gp: -10 }),
    // selected month (October)
    line({ sales: 1000 }),
    line({ customerCode: "C2", customerName: "Shop Two", rep: "Bruno", principal: "Eabl", itemCode: "I2", itemName: "Beer", sales: 3000, warehouse: "NYR" }),
    credit({ sales: -100, cases: -2, gp: -30 }),
    credit({ customerCode: "C2", customerName: "Shop Two", rep: "Bruno", principal: "Eabl", itemCode: "I2", itemName: "Beer", sales: -300, cases: -5, gp: -90, warehouse: "NYR" }),
    credit({ customerCode: "C2", customerName: "Shop Two", rep: "Bruno", principal: "Eabl", itemCode: "I3", itemName: "Cider", sales: -50, cases: -1, gp: -5, warehouse: "NYR" }),
  ];
  const report = aggregateCreditNotes(lines, { asOf: "2026-10-20", scopeMonths: ["2026-10"] });

  it("reports credit notes as positive amounts against what was invoiced", () => {
    expect(report.kpi.credit).toBe(450);
    expect(report.kpi.invoiced).toBe(4000);
    expect(report.kpi.net).toBe(3550);
    expect(report.kpi.cnPct).toBeCloseTo(11.25, 6);
    expect(report.kpi.cases).toBe(8);
    expect(report.kpi.gpLost).toBe(125);
    expect(report.kpi.creditLines).toBe(3);
    expect(report.kpi.customers).toBe(2);
    expect(report.kpi.items).toBe(3);
    expect(report.kpi.reps).toBe(2);
    expect(report.kpi.avgPerCustomer).toBe(225);
  });

  it("compares with the equal-length period before when it is covered", () => {
    expect(report.priorScope).toEqual(["2026-09"]);
    expect(report.kpi.priorCredit).toBe(40);
    expect(report.kpi.creditChangePct).toBeCloseTo(1025, 6);
    expect(report.kpi.cnPctChange).toBeCloseTo(11.25 - 5, 6);
  });

  it("gives no comparison when the earlier window is not in the stored lines", () => {
    const noPrior = aggregateCreditNotes(lines.filter((l) => l.month === "2026-10"), { asOf: "2026-10-20", scopeMonths: ["2026-10"] });
    expect(noPrior.priorScope).toEqual([]);
    expect(noPrior.kpi.priorCredit).toBeNull();
    expect(noPrior.kpi.creditChangePct).toBeNull();
    expect(noPrior.principals[0].changePct).toBeNull();
  });

  it("does not lose the comparison when a filter leaves the earlier month empty for a small selection", () => {
    const filtered = aggregateCreditNotes(lines.filter((l) => l.principal === "Eabl"), { asOf: "2026-10-20", scopeMonths: ["2026-10"], coveredMonths: ["2026-09", "2026-10"] });
    expect(filtered.priorScope).toEqual(["2026-09"]);
    expect(filtered.kpi.priorCredit).toBe(0);
    expect(filtered.kpi.creditChangePct).toBeNull();
  });

  it("ranks principals, customers, items, reps and branches by credit with shares that add to 100", () => {
    expect(report.principals.map((r) => r.p)).toEqual(["Eabl", "Mars"]);
    expect(report.principals[0]).toMatchObject({ credit: 350, invoiced: 3000, customers: 1, items: 2 });
    expect(report.principals.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 6);
    expect(report.customers.map((r) => r.code)).toEqual(["C2", "C1"]);
    expect(report.customers[0]).toMatchObject({ rank: 1, name: "Shop Two", rep: "Bruno", credit: 350, items: 2 });
    expect(report.customers[1].cum).toBeCloseTo(100, 6);
    expect(report.items.map((r) => r.code)).toEqual(["I2", "I1", "I3"]);
    expect(report.items[0]).toMatchObject({ name: "Beer", p: "Eabl", credit: 300, cases: 5, customers: 1 });
    expect(report.reps.map((r) => r.n)).toEqual(["Bruno", "Amina"]);
    expect(report.warehouses.map((r) => r.n)).toEqual(["NYR", "NBO"]);
    expect(report.kpi.top10CustomerShare).toBeCloseTo(100, 6);
  });

  it("leaves out customers and items that were invoiced but never credited", () => {
    const extra = aggregateCreditNotes([...lines, line({ customerCode: "C9", customerName: "Quiet", itemCode: "I9", sales: 500 })], { asOf: "2026-10-20", scopeMonths: ["2026-10"] });
    expect(extra.customers.some((r) => r.code === "C9")).toBe(false);
    expect(extra.items.some((r) => r.code === "I9")).toBe(false);
    expect(extra.kpi.invoiced).toBe(4500);
  });

  it("keeps a month-by-month trend with the period's months marked", () => {
    expect(report.months).toEqual(["2026-09", "2026-10"]);
    expect(report.monthly.map((m) => [m.m, m.inScope, m.credit])).toEqual([["2026-09", false, 40], ["2026-10", true, 450]]);
    expect(report.principals[0].m).toEqual([0, 350]);
  });

  it("lists the largest credit lines first", () => {
    expect(report.topLines.map((l) => l.credit)).toEqual([300, 100, 50]);
    expect(report.topLines[0]).toMatchObject({ customerCode: "C2", itemCode: "I2", cases: 5, gpLost: 90 });
  });

  it("flags items credited for more than they were invoiced", () => {
    expect(report.kpi.itemsCreditedAboveInvoiced).toBe(1); // I3: credited 50, invoiced nothing
  });

  it("reports an empty selection without failing, and says so", () => {
    const none = aggregateCreditNotes([line({})], { asOf: "2026-10-20", scopeMonths: ["2026-10"] });
    expect(none.kpi.credit).toBe(0);
    expect(none.customers).toEqual([]);
    expect(none.insights).toEqual(["No credit notes were issued in this selection."]);
    const nothing = aggregateCreditNotes([], { asOf: "2026-10-20", scopeMonths: [] });
    expect(nothing.kpi.cnPct).toBeNull();
    expect(nothing.monthly).toEqual([]);
  });

  it("cuts the lists to a display size but not for the export", () => {
    const many = Array.from({ length: 80 }, (_, i) => credit({ customerCode: `K${i}`, itemCode: `T${i}`, sales: -(i + 1) }));
    expect(aggregateCreditNotes(many, { asOf: "2026-10-20", scopeMonths: ["2026-10"] }).customers).toHaveLength(50);
    expect(aggregateCreditNotes(many, { asOf: "2026-10-20", scopeMonths: ["2026-10"] }).customerCount).toBe(80);
    expect(aggregateCreditNotes(many, { asOf: "2026-10-20", scopeMonths: ["2026-10"], topCustomers: Infinity, topItems: Infinity }).customers).toHaveLength(80);
  });

  it("narrows to a customer, item, rep, principal or branch with the text filter", () => {
    const only = aggregateCreditNotes(lines, { asOf: "2026-10-20", scopeMonths: ["2026-10"], query: "cider" });
    expect(only.kpi.credit).toBe(50);
    expect(lineMatchesQuery(line({}), "  SHOP one ")).toBe(true);
    expect(lineMatchesQuery(line({}), "nyr")).toBe(false);
    expect(lineMatchesQuery(line({}), "")).toBe(true);
  });

  it("writes every list to a workbook Excel can open", () => {
    const sheets = buildCreditNotesSheets(report, null, { periodLabel: "MONTH October 2026", principalLabel: "All principals", query: "", generatedAt: new Date("2026-10-20T10:00:00Z"), scoped: false });
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Monthly", "Principals", "Items", "Customers", "Sales Reps", "Branches", "Largest Credit Lines"]);
    for (const s of sheets) for (const row of s.rows) expect(row).toHaveLength(s.columns.length);
    const cover = Object.fromEntries(sheets[0].rows.map((row) => [row[0], row[1]]));
    expect(cover["Credit Notes (KES)"]).toBe(450);
    expect(cover["Credit Notes % of invoiced"]).toBe(11.25);
    expect(extractToXlsxBuffer(sheets).subarray(0, 2).toString()).toBe("PK");
  });
});

describe("who sees which lines", () => {
  const scope = (over: Partial<TeamLeaderScope>): TeamLeaderScope => ({ teamLeaderId: null, supervisorId: null, teamLeaderIds: [], principals: [], employeeCodes: [], normalizedNames: new Set(), ...over });

  it("shows everything to an unrestricted session", () => {
    expect(lineScopeFrom(null)).toBeNull();
    expect(lineInScope(line({}), null)).toBe(true);
  });

  it("holds a principal-restricted login to its principals, whatever the rep", () => {
    const s = lineScopeFrom(scope({ principals: ["Mars-Nairobi"] }));
    expect(lineInScope(line({ principal: "Mars", rep: "Anyone" }), s)).toBe(true);
    expect(lineInScope(line({ principal: "Eabl" }), s)).toBe(false);
  });

  it("holds a team leader to the principals and the reps of the roster", () => {
    const s = lineScopeFrom(scope({ teamLeaderId: "tl1", teamLeaderIds: ["tl1"], principals: ["Mars-Nairobi"], normalizedNames: new Set(["amina"]) }));
    expect(lineInScope(line({ rep: "Amina" }), s)).toBe(true);
    expect(lineInScope(line({ rep: "Bruno" }), s)).toBe(false);
    expect(lineInScope(line({ principal: "Eabl", rep: "Amina" }), s)).toBe(false);
  });

  it("shows a scoped session with an empty roster nothing, rather than everything", () => {
    const s = lineScopeFrom(scope({ teamLeaderId: "tl1", teamLeaderIds: ["tl1"] }));
    expect(lineInScope(line({}), s)).toBe(false);
    expect(lineInScope(line({}), lineScopeFrom(scope({ principals: [] })))).toBe(false);
  });
});

describe("the request", () => {
  const parse = (query: string) => parseCreditNotesParams(new URLSearchParams(query));
  it("accepts months, principals and a search", () => {
    expect(parse("months=2026-09,2026-10&principals=mars,eabl&q=%20shop%20")).toEqual({ value: { months: ["2026-09", "2026-10"], principalKeys: ["mars", "eabl"], query: "shop" } });
    expect(parse("months=2026-10")).toEqual({ value: { months: ["2026-10"], principalKeys: [], query: "" } });
  });
  it("refuses missing or malformed months, too many principals and long searches", () => {
    expect("error" in parse("")).toBe(true);
    expect("error" in parse("months=2026-13")).toBe(true);
    expect("error" in parse("months=2026-1")).toBe(true);
    expect("error" in parse(`months=2026-10&principals=${Array.from({ length: 61 }, (_, i) => `p${i}`).join(",")}`)).toBe(true);
    expect("error" in parse(`months=2026-10&q=${"x".repeat(81)}`)).toBe(true);
  });
});
