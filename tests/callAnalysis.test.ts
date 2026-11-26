import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  repCall: { updateMany: vi.fn() },
  employeeMaster: { findMany: vi.fn(async () => []) },
  teamLeaderAssignment: { findMany: vi.fn(async () => []) },
  teamLeader: { findMany: vi.fn(async () => []) },
}));
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { dayLabel, filterFacts, filterOptions, groupFacts, measure, weekStart } from "@/lib/callAnalysis/aggregate";
import { mergeLeverage, teamLeaderByName } from "@/lib/callAnalysis/facts";
import { clockTime, monthRange, nairobiToday, partialNote, presetRange, toReport } from "@/lib/callAnalysis/present";
import type { CallAnalysisResult, RepDayFact } from "@/lib/callAnalysis/types";
import { GET } from "@/app/api/coverage/call-analysis/route";
import { POST as uploadCalls } from "@/app/api/timestamps/upload/route";
import { buildRepCalls, collapseToPurchaseEvents, countCallLines } from "@/scripts/db-bridge/active-outlets/transform";
import type { FactLineRow, OutletRow, ProductRow, UserRow } from "@/scripts/db-bridge/active-outlets/query";
import { CallAnalysisView } from "@/components/views/CallAnalysisView";

const fact = (over: Partial<RepDayFact> = {}): RepDayFact => ({
  source: "pine",
  date: "2026-11-02", // a Monday
  repKey: "pine:1",
  repName: "Asha",
  principalKey: "mars",
  principal: "Mars",
  teamLeader: "Lucy",
  role: "Primary Sales",
  firstMinutes: 9 * 60,
  lastMinutes: 17 * 60,
  calls: 4,
  productive: 2,
  outlets: ["a", "b", "c", "d"],
  productiveOutlets: ["a", "b"],
  lines: 10,
  linesCalls: 2,
  value: 3000,
  cases: 6,
  casesCalls: 2,
  intervalSum: 60,
  intervalCount: 3,
  ...over,
});

describe("measure", () => {
  it("works out strike rate, LPPC and drop size per productive call", () => {
    const m = measure([fact()]);
    expect(m).toMatchObject({ calls: 4, productive: 2, strikeRatePct: 50, lppc: 5, lppcDataPct: 100, value: 3000, dropSizeValue: 1500, dropSizeCases: 3, avgStartMinutes: 540, avgCloseMinutes: 1020, avgHours: 8, avgIntervalMins: 20, lateStartPct: 0, coverage: 4, productiveCoverage: 2 });
  });

  it("works LPPC and cases from the calls that record them, and says how many that is", () => {
    const m = measure([fact(), fact({ repKey: "pine:2", productive: 2, lines: 0, linesCalls: 0, cases: 0, casesCalls: 0 })]);
    expect(m.lppc).toBe(5);
    expect(m.lppcDataPct).toBe(50);
    expect(m.casesDataPct).toBe(50);
    expect(m.dropSizeValue).toBe(1500);
  });

  it("gives no LPPC or cases, rather than zero, when nothing records them", () => {
    const m = measure([fact({ source: "eabl", lines: 0, linesCalls: 0, cases: 0, casesCalls: 0 })]);
    expect(m.lppc).toBeNull();
    expect(m.cases).toBeNull();
    expect(m.dropSizeCases).toBeNull();
  });

  it("leaves a system with no call count out of the strike rate but keeps its productive calls", () => {
    const m = measure([fact(), fact({ source: "unilever", repKey: "unilever:x", calls: null, productive: 8, outlets: ["z"], productiveOutlets: ["z"] })]);
    expect(m).toMatchObject({ calls: 4, productive: 10, strikeRatePct: 50 });
    expect(measure([fact({ calls: null })])).toMatchObject({ calls: null, strikeRatePct: null, callsPerRepDay: null });
  });

  it("counts an outlet once a month across reps and days, and averages months instead of adding them", () => {
    const november = [fact(), fact({ repKey: "pine:2", date: "2026-11-03", outlets: ["a", "e"], productiveOutlets: ["e"] })];
    expect(measure(november)).toMatchObject({ coverage: 5, productiveCoverage: 3 });
    const withDecember = [...november, fact({ date: "2026-12-01", outlets: ["a"], productiveOutlets: ["a"] })];
    expect(measure(withDecember)).toMatchObject({ coverage: 3, productiveCoverage: 2 });
  });

  it("keeps the same outlet id from two systems apart", () => {
    expect(measure([fact({ outlets: ["1"] }), fact({ source: "eabl", outlets: ["1"] })]).coverage).toBe(2);
  });

  it("averages times over working days, falling back to the weekend when that is all there is", () => {
    const saturday = fact({ date: "2026-11-07", firstMinutes: 12 * 60, lastMinutes: 13 * 60 });
    expect(measure([fact(), saturday])).toMatchObject({ avgStartMinutes: 540, lateStartPct: 0, repDays: 2 });
    expect(measure([saturday])).toMatchObject({ avgStartMinutes: 720, lateStartPct: 100 });
  });

  it("is empty, not zero-divided, with no facts", () => {
    expect(measure([])).toMatchObject({ calls: null, productive: 0, strikeRatePct: null, lppc: null, dropSizeValue: null, avgStartMinutes: null, coverage: 0 });
  });
});

describe("grouping and filtering", () => {
  const facts = [
    fact(),
    fact({ date: "2026-11-10", productive: 1 }),
    fact({ repKey: "pine:2", repName: "Ben", teamLeader: "Otis", role: "Secondary Sales", principalKey: "bidco", principal: "Bidco", productive: 9 }),
  ];

  it("groups by day, week and month in date order", () => {
    expect(groupFacts(facts, "day").map((r) => r.key)).toEqual(["2026-11-02", "2026-11-10"]);
    expect(groupFacts(facts, "week").map((r) => r.key)).toEqual(["2026-11-02", "2026-11-09"]);
    expect(groupFacts(facts, "month").map((r) => [r.label, r.productive])).toEqual([["Nov 2026", 12]]);
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(dayLabel("2026-11-02")).toBe("Mon 2 Nov 2026");
  });

  it("leads rep, principal and team leader groups with the most productive", () => {
    expect(groupFacts(facts, "rep").map((r) => r.label)).toEqual(["Ben", "Asha"]);
    expect(groupFacts(facts, "principal").map((r) => r.label)).toEqual(["Bidco", "Mars"]);
    expect(groupFacts(facts, "teamLeader").map((r) => r.label)).toEqual(["Otis", "Lucy"]);
    expect(groupFacts(facts, "source").map((r) => r.label)).toEqual(["Pine SalesEdge"]);
  });

  it("lists rep days newest first with the date under the name", () => {
    const rows = groupFacts(facts, "repDay");
    expect(rows.map((r) => r.key)).toEqual(["2026-11-10|pine:1", "2026-11-02|pine:1", "2026-11-02|pine:2"]);
    expect(rows[0].detail).toBe("Tue 10 Nov 2026 · Mars");
  });

  it("filters by rep, team leader and role, and offers choices from everything loaded", () => {
    expect(filterFacts(facts, { repKey: "pine:2", teamLeader: null, role: "all" })).toHaveLength(1);
    expect(filterFacts(facts, { repKey: null, teamLeader: "Lucy", role: "all" })).toHaveLength(2);
    expect(filterFacts(facts, { repKey: null, teamLeader: null, role: "Secondary Sales" })).toHaveLength(1);
    expect(filterOptions(facts)).toMatchObject({ teamLeaders: ["Lucy", "Otis"], reps: [{ key: "pine:1", label: "Asha (Mars)" }, { key: "pine:2", label: "Ben (Bidco)" }] });
  });
});

describe("Leverage and team leaders", () => {
  it("joins times and invoices per branch, rep and day, keeping a day only one feed has", () => {
    const rows = mergeLeverage(
      [{ date: "2026-11-02", distributor: "18048241", dsr: "7", dsrName: "Jane", firstEntry: new Date("2026-11-02T08:15:00Z"), lastEntry: new Date("2026-11-02T15:00:00Z") }],
      [
        { date: "2026-11-02", distributor: "18048241", dsr: "7", dsrName: "Jane_18048241", productive: 2, outlets: ["o1", "o2"], lines: 7, value: 900, cases: 3, casesCalls: 2 },
        { date: "2026-11-03", distributor: "18048241", dsr: "7", dsrName: "Jane", productive: 1, outlets: ["o1"], lines: 1, value: 100, cases: null, casesCalls: 0 },
      ],
      new Map([["jane", "Lucy"]])
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ repKey: "unilever:18048241:7", repName: "Jane (Nairobi)", teamLeader: "Lucy", calls: null, productive: 2, lines: 7, linesCalls: 2, firstMinutes: 495, lastMinutes: 900 });
    expect(rows[1]).toMatchObject({ firstMinutes: null, productive: 1, cases: 0, casesCalls: 0 });
  });

  it("leaves a name two team leaders claim unassigned", () => {
    const map = teamLeaderByName([
      { names: ["Sam  Otieno", null], teamLeader: "Lucy" },
      { names: ["sam otieno"], teamLeader: "Otis" },
      { names: ["Ann"], teamLeader: "Otis" },
      { names: ["Zed"], teamLeader: " " },
    ]);
    expect([...map]).toEqual([["ann", "Otis"]]);
  });
});

describe("product lines from Pine", () => {
  const line = (over: Partial<FactLineRow> = {}): FactLineRow => ({ docId: "1", isOrder: false, purchaseTime: new Date("2026-11-02T09:00:00Z"), userId: "u", customerId: "o", itemId: "i1", qty: 2, unitPrice: 10, ...over });
  const lines = [
    line(),
    line({ itemId: "i2" }),
    line({ docId: "2", isOrder: true }), // the same product ordered as well: one line
    line({ docId: "3", itemId: "i3", qty: -1 }), // a return is not a line
    line({ docId: "3", itemId: "i4", unitPrice: 0 }), // a free line is not either
  ];
  const outlets = [{ id: "o", name: "Shop", subChannel: "Retailers", sourceChannel: "", territory: "Nairobi", latitude: null, longitude: null, pjpUserId: null, pjpRepName: null, pjpRepGroup: null, pjpRegion: null }] as OutletRow[];
  const users = [{ id: "u", employee: "Asha", userGroup: "DSR", region: "Nairobi" }] as UserRow[];
  const products: ProductRow[] = [];

  it("counts the different products sold or ordered on the call", () => {
    const { events } = collapseToPurchaseEvents(lines, outlets, users, products, []);
    const calls = buildRepCalls(events, [], outlets, users);
    expect(calls).toHaveLength(1);
    expect(calls[0].lines).toBe(2);
  });

  it("counts none on a call without a sale, and the line-only backfill agrees with the live calls", () => {
    const noSale = buildRepCalls([], [{ visitId: "v", visitTime: new Date("2026-11-02T10:00:00Z"), userId: "u", customerId: "o", noSaleReason: null }], outlets, users);
    expect(noSale[0].lines).toBe(0);
    expect(countCallLines(lines)).toEqual([{ date: "2026-11-02", employeeCode: "u", outletId: "o", lines: 2 }]);
  });

  it("the upload's line-count mode changes only line counts", async () => {
    process.env.UPLOAD_API_KEY = "test-key";
    prismaMock.$executeRaw.mockResolvedValue(1);
    const send = (body: unknown) => uploadCalls(new Request("http://x/api/timestamps/upload", { method: "POST", headers: { "x-upload-api-key": "test-key" }, body: JSON.stringify(body) }) as never);
    const ok = await send({ lineCounts: [{ date: "2026-11-02", employeeCode: "u", outletId: "o", lines: 2 }] });
    expect(await ok.json()).toEqual({ count: 1, updated: 1 });
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = (prismaMock.$executeRaw.mock.calls[0][0] as unknown as string[]).join(" ");
    expect(sql).toContain('UPDATE "RepCall"');
    expect(sql).not.toContain("DELETE");
    expect(prismaMock.repCall.updateMany).toHaveBeenCalledWith({ where: { date: { in: [new Date("2026-11-02T00:00:00.000Z")] }, callOutcome: "No Sale", lines: null }, data: { lines: 0 } });
    expect((await send({ lineCounts: [{ date: "2026-11-02", employeeCode: "u", outletId: "o", lines: -1 }] })).status).toBe(400);
  });
});

describe("dates and display", () => {
  it("works out the preset ranges", () => {
    expect(presetRange("today", "2026-11-26")).toEqual({ from: "2026-11-26", to: "2026-11-26" });
    expect(presetRange("yesterday", "2026-11-01")).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(presetRange("week", "2026-11-26")).toEqual({ from: "2026-11-23", to: "2026-11-26" });
    expect(presetRange("last7", "2026-11-26")).toEqual({ from: "2026-11-20", to: "2026-11-26" });
    expect(presetRange("month", "2026-11-26")).toEqual({ from: "2026-11-01", to: "2026-11-26" });
    expect(presetRange("lastMonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(monthRange("2026-02", "2026-11-26")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(nairobiToday(new Date("2026-11-25T22:00:00Z"))).toBe("2026-11-26");
  });

  it("formats times and flags partial data", () => {
    expect(clockTime(9 * 60 + 5)).toBe("9:05 AM");
    expect(clockTime(12 * 60)).toBe("12:00 PM");
    expect(clockTime(null)).toBe("—");
    expect(partialNote(100, "Lines")).toBeNull();
    expect(partialNote(40, "Lines")).toContain("40%");
  });

  it("exports the grouping, the daily table and the definitions, each with a total", () => {
    const facts = [fact()];
    const result: CallAnalysisResult = { from: "2026-11-01", to: "2026-11-02", groupBy: "rep", total: measure(facts), rows: groupFacts(facts, "rep"), trend: groupFacts(facts, "day"), options: filterOptions(facts), availability: [{ source: "pine", first: "2026-09-01", last: "2026-11-26" }] };
    const report = toReport(result, [["Principal", "All"]]);
    expect(report.sections.map((s) => s.title)).toEqual(["By rep", "By day", "Definitions"]);
    const [byRep] = report.sections;
    expect(byRep.columns).toContain("LPPC");
    expect(byRep.columns).toContain("Drop size (KES)");
    expect(byRep.rows.at(-1)![0]).toBe("Total");
    for (const row of byRep.rows) expect(row).toHaveLength(byRep.columns.length);
    expect(toReport({ ...result, groupBy: "day", rows: result.trend }, []).sections.map((s) => s.title)).toEqual(["By day", "Definitions"]);
  });
});

describe("GET /api/coverage/call-analysis", () => {
  const get = (query: string) => GET(new (class { nextUrl = new URL(`http://x/api/coverage/call-analysis?${query}`); })() as never);
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([]);
    authMock.mockResolvedValue({ user: { role: "ADMIN", allowedPages: [] } });
  });

  it("needs a sign-in and both the coverage and timestamps grants", async () => {
    authMock.mockResolvedValue(null);
    expect((await get("from=2026-11-01&to=2026-11-02")).status).toBe(401);
    authMock.mockResolvedValue({ user: { role: "VIEWER", allowedPages: ["coverage"] } });
    expect((await get("from=2026-11-01&to=2026-11-02")).status).toBe(403);
    authMock.mockResolvedValue({ user: { role: "VIEWER", allowedPages: ["coverage", "timestamps"] } });
    expect((await get("from=2026-11-01&to=2026-11-02")).status).toBe(200);
  });

  it("rejects bad dates, ranges and filters", async () => {
    for (const query of ["", "from=2026-11-02&to=2026-11-01", "from=2026-02-31&to=2026-03-02", "from=2025-01-01&to=2026-11-01", "from=2026-11-01&to=2026-11-02&group=x", "from=2026-11-01&to=2026-11-02&role=x", "from=2026-11-01&to=2026-11-02&source=x"]) {
      expect((await get(query)).status, query).toBe(400);
    }
  });

  it("answers with totals, rows, a daily trend and what each system holds", async () => {
    const body = await (await get("from=2026-11-01&to=2026-11-02&group=principal")).json();
    expect(body).toMatchObject({ groupBy: "principal", rows: [], trend: [], total: { productive: 0 } });
    expect(body.availability.map((a: { source: string }) => a.source)).toEqual(["pine", "eabl", "upfield", "unilever"]);
  });
});

describe("the page", () => {
  it("opens with its own filters and loads", () => {
    const html = renderToString(createElement(CallAnalysisView));
    for (const text of ["Today", "Last month", "From", "Whole month", "Team leader", "All systems", "Export Excel", "Loading the call analysis"]) expect(html).toContain(text);
  });
});
