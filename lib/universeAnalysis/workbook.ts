// The analysis as an Excel workbook, one sheet per section (the same sections as the screen), for sharing and for pivoting.
import * as XLSX from "xlsx";
import { DEFAULT_ASSUMPTIONS } from "./config";
import { buildSection, type AnalysisContext, type SectionParams } from "./service";
import type { Insight } from "./insights";
import type { CoverageDetailRow, PrincipalScore, RepRow, SummaryGroup, SummaryRow, TeamLeaderScore, UniverseSummary } from "./metrics";
import type { Opportunities, TargetRow } from "./opportunities";
import type { QualityCheck } from "./quality";
import type { DedupPair } from "./types";

type Cell = string | number | null | { v: number; t: "n"; z: string };

const blank = (v: number | null | undefined) => v === null || v === undefined || Number.isNaN(v);
const pct = (v: number | null | undefined): Cell => (blank(v) ? "" : { v: v as number, t: "n", z: "0.0%" });
const plain = (v: number | null | undefined): Cell => (blank(v) ? "" : { v: (v as number) / 100, t: "n", z: "0.0%" });
const mil = (v: number | null | undefined): Cell => (blank(v) ? "" : { v: (v as number) / 1e6, t: "n", z: "#,##0.0" });
const num = (v: number | null | undefined): Cell => (blank(v) ? "" : { v: v as number, t: "n", z: "#,##0" });
const text = (v: string | null | undefined): Cell => v ?? "";

function sheet(rows: Cell[][], widths: number[] = []): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows as unknown as unknown[][]);
  ws["!cols"] = widths.length ? widths.map((wch) => ({ wch })) : [{ wch: 34 }, ...Array.from({ length: 14 }, () => ({ wch: 16 }))];
  return ws;
}

const STRIKE_HEADERS = ["Outlet-principal pairs", "Calls with outcome", "Productive calls", "Unproductive calls", "Strike rate", "Unproductive value (KES M)", "YTD sales (KES M)"];
const strikeCells = (g: SummaryRow): Cell[] => [num(g.outletPrincipalPairs), num(g.callsWithOutcome), num(g.productiveCalls), num(g.unproductiveCalls), pct(g.strikeRate), mil(g.unproductiveValue), mil(g.sales)];

function strikeBlock(title: string, labelHeader: string, groups: SummaryGroup[], label: (k: SummaryGroup["key"]) => string): Cell[][] {
  const calls = groups.reduce((s, g) => s + g.callsWithOutcome, 0);
  const productive = groups.reduce((s, g) => s + g.productiveCalls, 0);
  const total: Cell[] = [
    "Total",
    num(groups.reduce((s, g) => s + g.outletPrincipalPairs, 0)),
    num(calls),
    num(productive),
    num(groups.reduce((s, g) => s + g.unproductiveCalls, 0)),
    pct(calls ? productive / calls : null),
    mil(groups.reduce((s, g) => s + g.unproductiveValue, 0)),
    mil(groups.reduce((s, g) => s + g.sales, 0)),
  ];
  return [[title], [labelHeader, ...STRIKE_HEADERS], ...groups.map((g) => [label(g.key), ...strikeCells(g)] as Cell[]), total, []];
}

const k = (key: SummaryGroup["key"], ...names: string[]) => names.map((n) => (key[n] === null || key[n] === undefined || key[n] === "" ? "Unassigned" : String(key[n]))).join(" · ");

export function buildWorkbook(ctx: AnalysisContext, params: SectionParams): Buffer {
  const section = <T,>(name: Parameters<typeof buildSection>[1], overrides: Partial<SectionParams> = {}) => buildSection(ctx, name, { ...params, ...overrides }) as T;
  const wb = XLSX.utils.book_new();
  const add = (name: string, ws: XLSX.WorkSheet) => XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  const month = ctx.monthLabel;

  // Executive Diagnosis
  const overview = section<{ universe: UniverseSummary; total: SummaryRow; direct: SummaryRow; opportunities: { distributorToDirect: { pool: number; annualValue: number }; crossSell: { pool: number; annualValue: number }; frequency: { pool: number; annualValue: number }; lapsing: { pool: number; annualValue: number }; unproductiveCalls: { pool: number; recoverable: number }; routeOverlap: { duplicateAssignments: number; repRoutesFreed: number }; totalNewRevenue: number }; insights: Insight[]; dedup: { records: number; merged: number; groups: number } }>("overview");
  const o = overview.opportunities;
  add("Executive Diagnosis", sheet([
    [`Active Outlets per Principal: Executive Diagnosis (${month})`],
    [`Active universe = outlets that bought in the last 90 days. Strike rate is for ${month} only, never the year to date.`],
    [],
    ["Unique active outlets", num(overview.universe.uniqueOutlets), `${overview.dedup.records.toLocaleString("en-KE")} IDs; ${overview.dedup.merged.toLocaleString("en-KE")} duplicates merged in ${overview.dedup.groups.toLocaleString("en-KE")} groups`],
    ["Direct reach", pct(overview.universe.directReach), `${overview.universe.directOutlets.toLocaleString("en-KE")} outlets served by Pinefrost reps`],
    ["Distributor-only outlets", num(overview.universe.distributorOnly)],
    ["YTD sales (KES M)", mil(overview.total.sales)],
    [`Strike rate (${month})`, pct(overview.total.strikeRate), "productive ÷ calls with outcome"],
    ["Unproductive calls", num(overview.total.unproductiveCalls)],
    ["Value of unproductive calls (KES M)", mil(overview.total.unproductiveValue)],
    ["Sized new revenue / yr (KES M)", mil(o.totalNewRevenue)],
    [],
    ["What the data says"],
    ...overview.insights.map((i, n) => [`${n + 1}. ${i.title}`, i.text] as Cell[]),
    [],
    ["Where the money is", "Pool", "Value (KES M)"],
    ["1. Convert distributor-only outlets to direct", num(o.distributorToDirect.pool), mil(o.distributorToDirect.annualValue)],
    ["2. Cross-sell inside the direct base", num(o.crossSell.pool), mil(o.crossSell.annualValue)],
    ["3. Lift ordering frequency", num(o.frequency.pool), mil(o.frequency.annualValue)],
    ["4. Win back lapsing outlets (protect)", num(o.lapsing.pool), mil(o.lapsing.annualValue)],
    ["5. Convert more unproductive calls (this month)", num(o.unproductiveCalls.pool), mil(o.unproductiveCalls.recoverable)],
    ["6. Merge overlapping routes (rep-routes freed)", num(o.routeOverlap.duplicateAssignments), { v: o.routeOverlap.repRoutesFreed, t: "n", z: "0.0" }],
  ], [46, 18, 60]));

  // Strike Rate Analysis
  const strike = section<{ total: SummaryRow; byPrincipal: SummaryGroup[]; byRouteChannel: SummaryGroup[]; byRegion: SummaryGroup[]; byRepRegion: SummaryGroup[]; byTeamLeader: SummaryGroup[]; byRecency: SummaryGroup[]; byConsistency: SummaryGroup[]; byTenure: SummaryGroup[]; bySegment: SummaryGroup[]; byTier: SummaryGroup[]; trend: { months: { label: string; calls: number; productive: number; strikeRate: number | null }[]; byPrincipal: { principal: string; points: { label: string; strikeRate: number | null }[] }[] } }>("strike");
  add("Strike Rate Analysis", sheet([
    [`Strike Rate Analysis: how many calls turn into orders (${month})`],
    ["Strike rate = productive calls ÷ calls with a recorded outcome, for the month. A call is a customer-month, counted by the same rules as the Coverage page."],
    [],
    ...strikeBlock("A. By principal", "Principal", strike.byPrincipal, (key) => k(key, "principal")),
    ...strikeBlock("B. Direct vs distributor, by channel", "Route · channel", strike.byRouteChannel, (key) => `${k(key, "route_class")} · ${k(key, "channel")}`),
    ...strikeBlock("C. By region (GPS-cleaned)", "Region", strike.byRegion, (key) => k(key, "region")),
    ...strikeBlock("D. By rep region and sub-region", "Rep region · sub-region", strike.byRepRegion, (key) => k(key, "rep_region", "rep_subregion")),
    ...strikeBlock("E. By team leader", "Team leader", strike.byTeamLeader, (key) => k(key, "team_leader")),
    ...strikeBlock("F. By recency", "Recency", strike.byRecency, (key) => k(key, "recency")),
    ...strikeBlock("G. By ordering consistency (periods bought of the last 3)", "Periods bought", strike.byConsistency, (key) => `${k(key, "consistency")} of 3`),
    ...strikeBlock("H. By buying tenure", "Buying tenure", strike.byTenure, (key) => k(key, "tenure")),
    ...strikeBlock("I. By outlet segment", "Segment", strike.bySegment, (key) => k(key, "segment")),
    ...strikeBlock("J. By tier (true average invoice)", "Tier", strike.byTier, (key) => k(key, "tier")),
  ]));
  add("Strike Trend", sheet([
    ["Strike rate by month (Pine, EABL DMS, Upfield DataEdge)"],
    ["Month", "Calls with outcome", "Productive calls", "Strike rate", ...strike.trend.byPrincipal.map((p) => p.principal)],
    ...strike.trend.months.map((m, i) => [m.label, num(m.calls), num(m.productive), pct(m.strikeRate === null ? null : m.strikeRate / 100), ...strike.trend.byPrincipal.map((p) => plain(p.points[i]?.strikeRate))] as Cell[]),
  ]));

  // Universe Diagnosis
  const universe = section<{ summary: UniverseSummary; bySegment: CoverageDetailRow[]; byRegion: CoverageDetailRow[]; concentration: { topShareOfOutlets: number; outlets: number; shareOfSales: number }[]; crossBuy: { principals: string[]; matrix: number[][] } }>("universe");
  const coverageRows = (rows: CoverageDetailRow[], label: string): Cell[][] => [
    [label, "Universe (outlets)", "Direct reach (outlets)", "Direct reach %", "Also via distributor", "Distributor-only", "Direct sales (KES M)", "Distributor sales (KES M)", "Avg direct invoice (KES)", "Median direct monthly / outlet (KES)", "Direct reps", "Reach"],
    ...rows.map((r) => [text(r.value ?? "Unassigned"), num(r.universe), num(r.direct), pct(r.directReach), num(r.alsoViaDistributor), num(r.distributorOnly), mil(r.directSales), mil(r.distributorSales), num(r.avgDirectInvoice), num(r.medianDirectMonthly), num(r.directReps), r.status] as Cell[]),
    [],
  ];
  add("Universe Diagnosis", sheet([
    [`Universe Diagnosis: active outlet universe (${month})`],
    [],
    ["A. How the universe is reached"],
    ["Coverage route", "Outlets", "% of universe", "YTD sales (KES M)", "% of sales", "Monthly run-rate (KES M)", "Median monthly per outlet (KES)"],
    ...universe.summary.coverage.map((c) => [c.route, num(c.outlets), pct(universe.summary.uniqueOutlets ? c.outlets / universe.summary.uniqueOutlets : null), mil(c.sales), pct(universe.summary.sales ? c.sales / universe.summary.sales : null), mil(c.monthlyRunRate), num(c.medianMonthly)] as Cell[]),
    ["Total unique active outlets", num(universe.summary.uniqueOutlets), pct(1), mil(universe.summary.sales)],
    [],
    ["B. Universe by outlet segment"],
    ...coverageRows(universe.bySegment, "Segment"),
    ["C. Universe by region"],
    ...coverageRows(universe.byRegion, "Region"),
    ["E. Concentration of value"],
    ["Top share of outlets", "Outlets", "Share of YTD sales"],
    ...universe.concentration.map((c) => [`Top ${(c.topShareOfOutlets * 100).toFixed(0)}%`, num(c.outlets), pct(c.shareOfSales)] as Cell[]),
    [],
    ["F. Cross-buying (direct outlets): of the outlets buying the row principal, the share also buying the column principal"],
    ["", ...universe.crossBuy.principals],
    ...universe.crossBuy.principals.map((p, i) => [p, ...universe.crossBuy.matrix[i].map((v) => pct(v))] as Cell[]),
  ], [34, 16, 16, 14, 16, 16, 16, 18, 18, 22, 12, 16]));

  // Scorecards
  const cards = section<{ principals: PrincipalScore[]; teamLeaders: TeamLeaderScore[]; reps: RepRow[] }>("scorecards");
  add("Principal Scorecard", sheet([
    ["Principal", "Outlets", "Direct outlets", "Direct reps", "YTD sales (KES M)", "Share of sales", "Avg invoice (KES)", "Strike (active)", "Strike (SFA-wide)", "Unproductive value (KES M)", "Consistent", "Lapsing", "Cross-buy", "Wholesale share"],
    ...cards.principals.map((p) => [text(p.principal), num(p.outlets), num(p.directOutlets), num(p.directReps), mil(p.sales), pct(p.shareOfSales), num(p.avgInvoice), pct(p.strikeRate), pct(p.sfaStrikeRate), mil(p.unproductiveValue), pct(p.consistentShare), pct(p.lapsingShare), pct(p.crossBuyRate), pct(p.wholesaleShareOfSales)] as Cell[]),
  ]));
  add("Team Leader Scorecard", sheet([
    ["Team leader", "Principals", "Reps", "Outlets", "YTD sales (KES M)", "Strike rate", "Unproductive value (KES M)", "Consistent", "Lapsing"],
    ...cards.teamLeaders.map((t) => [text(t.teamLeader ?? "Unassigned"), t.principals, num(t.reps), num(t.outlets), mil(t.sales), pct(t.strikeRate), mil(t.unproductiveValue), pct(t.consistentShare), pct(t.lapsingShare)] as Cell[]),
  ], [26, 44, 10, 12, 18, 12, 24, 12, 12]));
  add("Rep Productivity", sheet([
    ["Rep", "Route", "Team leader", "Region", "Principals", "Outlets", "YTD sales (KES M)", "Strike rate", "Consistent", "Lapsing", "Flag"],
    ...cards.reps.map((r) => [text(r.rep ?? "Unassigned"), r.routeType, text(r.teamLeader), text(r.region), r.principals, num(r.outlets), mil(r.sales), pct(r.strikeRate), pct(r.consistentShare), pct(r.lapsingShare), r.flag] as Cell[]),
  ], [28, 12, 22, 14, 40, 10, 16, 12, 12, 12, 18]));

  // Opportunity Sizing
  const opp = section<{ assumptions: typeof DEFAULT_ASSUMPTIONS; opportunities: Opportunities }>("opportunities");
  const op = opp.opportunities;
  add("Opportunity Sizing", sheet([
    ["Opportunity Sizing: where the next shilling comes from"],
    ["Estimates, not forecasts. Pools are counted from the data; capture rates are assumptions."],
    [],
    ["Assumption", "Value"],
    ["Distributor-only → direct conversion rate", pct(opp.assumptions.distributorToDirect)],
    ["Cross-sell conversion rate", pct(opp.assumptions.crossSell)],
    ["Frequency recovery rate", pct(opp.assumptions.frequencyRecovery)],
    ["Lapsing win-back rate", pct(opp.assumptions.lapsingWinback)],
    ["Unproductive-call conversion", pct(opp.assumptions.unproductiveCallConversion)],
    [],
    ["Opportunity", "Pool", "Annual value (KES M)"],
    ["1. Distributor-only → direct", num(op.distributorToDirect.pool), mil(op.distributorToDirect.annualValue)],
    ["2. Cross-sell in the direct base", num(op.crossSell.pool), mil(op.crossSell.annualValue)],
    ["3. Ordering frequency", num(op.frequency.pool), mil(op.frequency.annualValue)],
    ["4. Lapsing win-back", num(op.lapsing.pool), mil(op.lapsing.annualValue)],
    ["Total new revenue (items 1–3)", "", mil(op.totalNewRevenue)],
    [],
    ["1. Distributor-only → direct, by segment"],
    ["Segment", "Distributor-only outlets", "Benchmark monthly / direct outlet (KES)", "Pool value, monthly (KES M)", "Annual capture (KES M)", "Direct outlets behind benchmark"],
    ...op.distributorToDirect.bySegment.map((p) => [p.segment, num(p.outlets), num(p.benchmarkMonthly), mil(p.poolMonthly), mil(p.annualValue), num(p.directOutletsBehindBenchmark)] as Cell[]),
    [],
    ["2. Cross-sell inside the direct base"],
    ["Target principal", "Segment", "Outlets already buying", "White-space outlets", "Benchmark monthly / outlet (KES)", "Annual capture (KES M)"],
    ...op.crossSell.rows.map((r) => [r.principal, r.segment, num(r.buying), num(r.whiteSpace), num(r.benchmarkMonthly), mil(r.annualValue)] as Cell[]),
  ], [44, 20, 28, 24, 24, 24]));

  // Target Lists
  const targets = section<{ rows: TargetRow[] }>("targets", { action: null, limit: 300 });
  add("Target Lists", sheet([
    ["Action", "Master outlet ID", "Outlet", "Principal(s)", "Segment", "Region", "Rep", "Days since purchase", "YTD sales (KES)", "Monthly run-rate (KES)", "Strike %", "Why"],
    ...targets.rows.map((t) => [t.action, t.masterOutletId, t.outlet, t.principals, text(t.segment), t.region, text(t.rep), num(t.daysSincePurchase), num(t.salesYtd), num(t.monthlyRunRate), plain(t.strikeRatePct), t.why] as Cell[]),
  ], [20, 22, 34, 30, 16, 14, 24, 12, 16, 18, 10, 50]));

  // Duplicates
  const merged = section<{ records: { masterId: string; recKey: string; isMaster: boolean; source: string; outlet: string; principals: string; matchType: string; confidence: string; method: string; metresFromMaster: number | null; simToMaster: number | null; sales: number }[] }>("duplicates", { status: "merged", limit: 5000 });
  add("Duplicate Outlets", sheet([
    ["Master ID", "Record", "Master?", "Source", "Outlet", "Principals", "Match", "Confidence", "Method", "Metres from master", "Name similarity", "YTD sales (KES)"],
    ...merged.records.map((r) => [r.masterId, r.recKey, r.isMaster ? "Yes" : "", r.source, r.outlet, r.principals, r.matchType, r.confidence, r.method, num(r.metresFromMaster), r.simToMaster === null ? "" : { v: r.simToMaster, t: "n", z: "0.00" }, num(r.sales)] as Cell[]),
  ], [26, 26, 10, 16, 36, 30, 16, 12, 28, 14, 14, 16]));
  const review = section<{ pairs: (DedupPair & { outletA: string; sourceA: string; outletB: string; sourceB: string })[] }>("duplicates", { status: "review", limit: 5000 });
  add("Duplicates to Review", sheet([
    ["Outlet A", "System A", "Outlet B", "System B", "Name similarity", "Metres apart", "Why not merged", "Method"],
    ...review.pairs.map((p) => [p.outletA, p.sourceA, p.outletB, p.sourceB, { v: p.nameSim, t: "n", z: "0.00" }, num(p.distM), p.reason, p.method] as Cell[]),
  ], [36, 16, 36, 16, 14, 12, 40, 28]));

  // Data Quality
  const quality = section<{ checks: QualityCheck[] }>("quality");
  add("Data Quality", sheet([
    ["#", "Area", "Issue", "Evidence", "Severity"],
    ...quality.checks.map((c, i) => [i + 1, c.area, c.issue, c.evidence, c.severity] as Cell[]),
  ], [5, 24, 60, 70, 12]));

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
