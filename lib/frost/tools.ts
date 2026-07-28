import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { getLatestSnapshot } from "../datasetStore";
import { getSyncHealth } from "../syncHealth";
import { prisma } from "../db";
import {
  summarizeSalesByPrincipal,
  summarizeCoverageByRep,
  summarizePLForPeriod,
  summarizeSalesForPeriod,
  summarizeBrandCustomerByRep,
  getCurrentMonthPeriod,
  getPriorYearPeriod,
  getPreviousMonthPeriod,
  resolvePeriodMonths,
  CANONICAL_MONTHS,
  type PeriodSelection,
} from "../timeIntelligence";
import { getWeeksInMonth } from "../weeklyTargets";
import { buildTlRanking } from "../tlRanking";
import { resolveKeywordPeriod, PERIOD_KEYWORDS } from "./period";
import type { PageKey } from "../pageAccess";
import { loadTeamLeaderScope, type TeamLeaderScope } from "../teamLeaderScope";

const PERIOD_DESCRIPTION = "mtd = this month to date, qtd = this quarter to date, ytd = year to date, last_month = the prior calendar month.";
const MAX_ROWS = 12;

function refusal(label: string) {
  return JSON.stringify({ error: `You're scoped to your own team's data — "${label}" isn't one of your assigned principals.` });
}

/** Every tool here wraps a function lib/timeIntelligence.ts (or a direct,
 *  narrow Prisma read) already exposes to the live dashboard pages — Frost
 *  never computes a figure itself, it only picks which pre-built summary to
 *  fetch and narrates the result. Each tool is tagged with the PageKey that
 *  gates it (see toolsForUser below), so a user only gets tools for data
 *  they'd already be allowed to see on the matching dashboard page.
 *
 *  Tools that can meaningfully leak company-wide figures to a TEAM_LEADER
 *  user (sales/coverage/P&L/TL ranking/targets/JP adherence/active outlets)
 *  are built as factories taking a `TeamLeaderScope | null` so they can be
 *  re-created per request, scoped to that user's own team — see
 *  toolsForUser. `list_principals` and `get_sync_health` stay static: the
 *  former is just a name list (no figures), the latter is admin-only.
 *
 *  The `period` schema's enum is spelled out inline (not passed through a
 *  shared object typed with a widened `string[]`) so betaTool's `const
 *  Schema` type parameter can infer the literal "mtd"|"ytd"|"qtd"|"last_month"
 *  union straight from PERIOD_KEYWORDS — that inferred union is what each
 *  run() callback's `args.period` ends up typed as, with no manual cast. */
export const listPrincipalsTool = betaTool({
  name: "list_principals",
  description: "Lists every principal (brand/Cost Centre) name present in the current dataset, so you can match a user's brand name to the exact string other tools expect.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run: async () => {
    const dataset = await getLatestSnapshot();
    if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
    const principals = Array.from(new Set(dataset.monthlySales.map((r) => r.principal))).sort();
    return JSON.stringify({ principals });
  },
});

function makeSalesVsTargetTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_sales_vs_target",
    description: scope
      ? "Revenue vs target, gross profit, and margin for the given period, for your own assigned principal(s) only."
      : "Revenue vs target, gross profit, and margin for the given period, either overall or for one principal.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      required: ["period"],
      additionalProperties: false,
    },
    run: async (args) => {
      const dataset = await getLatestSnapshot();
      if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const selection = resolveKeywordPeriod(args.period);
      const byPrincipal = summarizeSalesByPrincipal(dataset, selection);

      if (args.principal) {
        const row = byPrincipal.get(args.principal);
        if (!row) return JSON.stringify({ error: `No principal named "${args.principal}" — call list_principals for exact names.` });
        return JSON.stringify(row);
      }

      let rows = Array.from(byPrincipal.values());
      if (scope) rows = rows.filter((r) => scope.principals.includes(r.principal));
      rows.sort((a, b) => b.revenue - a.revenue);
      const truncated = rows.length > MAX_ROWS;
      return JSON.stringify({ principals: rows.slice(0, MAX_ROWS), truncated, totalPrincipals: rows.length });
    },
  });
}

function makeCoverageByRepTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_coverage_by_rep",
    description: scope
      ? "Outlet coverage and productivity (call strike rate) for reps on your own team, for the given period."
      : "Outlet coverage and productivity (call strike rate) per sales rep for the given period, optionally scoped to one principal.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for coverage across every principal you can see." },
      },
      required: ["period"],
      additionalProperties: false,
    },
    run: async (args) => {
      const dataset = await getLatestSnapshot();
      if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const selection = resolveKeywordPeriod(args.period);
      let rows = summarizeCoverageByRep(dataset, selection, args.principal ?? null);
      if (scope) rows = rows.filter((r) => scope.normalizedNames.has(r.employeeName.trim().toLowerCase()));
      rows = rows.sort((a, b) => b.coverage - a.coverage);
      const truncated = rows.length > MAX_ROWS;
      return JSON.stringify({ reps: rows.slice(0, MAX_ROWS), truncated, totalReps: rows.length });
    },
  });
}

function makePLSummaryTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_pl_summary",
    description: scope
      ? "Profit & loss summary for the given period, for your own assigned principal(s) only."
      : "Profit & loss summary (revenue, COGS, gross/net profit, margins) for the given period, optionally scoped to one principal.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      required: ["period"],
      additionalProperties: false,
    },
    run: async (args) => {
      const dataset = await getLatestSnapshot();
      if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const selection = resolveKeywordPeriod(args.period);

      if (args.principal) return JSON.stringify(summarizePLForPeriod(dataset, selection, args.principal));
      if (!scope) return JSON.stringify(summarizePLForPeriod(dataset, selection, null));

      // Scoped, no single principal given: sum the P&L across only this TL's principals.
      let revenue = 0, cogs = 0, grossProfit = 0;
      for (const p of scope.principals) {
        const row = summarizePLForPeriod(dataset, selection, p);
        revenue += row.revenue;
        cogs += row.cogs;
        grossProfit += row.grossProfit;
      }
      return JSON.stringify({ revenue, cogs, grossProfit, grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : null });
    },
  });
}

function makeTlRankingTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_tl_ranking",
    description: scope
      ? "Your own team's MTD Target vs MTD Revenue achievement, for the current calendar month."
      : "MTD Target vs MTD Revenue achievement per Team Leader, for the current calendar month, ranked by achievement %.",
    inputSchema: {
      type: "object",
      properties: {
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const dataset = await getLatestSnapshot();
      if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);

      const currentMonth = getCurrentMonthPeriod(dataset);
      if (!currentMonth.month) return JSON.stringify({ error: "No current-month data available." });
      const repRevenue = summarizeBrandCustomerByRep(dataset, currentMonth, args.principal ?? null).map((r) => ({ salesEmployee: r.salesEmployee, revenue: r.revenue }));

      const [assignments, teamLeaders, weeklyTargets] = await Promise.all([
        prisma.teamLeaderAssignment.findMany({ select: { teamLeaderId: true, employeeName: true, sapName: true, principal: true, active: true } }),
        prisma.teamLeader.findMany({ select: { id: true, name: true } }),
        prisma.weeklyTarget.findMany({ where: { year: currentMonth.year, monthLabel: currentMonth.month }, select: { teamLeaderId: true, targetValue: true } }),
      ]);

      const result = buildTlRanking(repRevenue, assignments, teamLeaders, weeklyTargets, args.principal ?? null);
      if (!scope) return JSON.stringify(result);

      const rankings = result.rankings.filter((r) => r.teamLeaderId === scope.teamLeaderId);
      return JSON.stringify({ rankings, unmatchedReps: [] });
    },
  });
}

function makeWeeklyTargetTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_weekly_target_performance",
    description: "This calendar month's Week 1-N projection vs actual revenue (day-grain sales feed rolled up to each week), optionally scoped to one principal.",
    inputSchema: {
      type: "object",
      properties: {
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const dataset = await getLatestSnapshot();
      if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);

      const currentMonth = getCurrentMonthPeriod(dataset);
      if (!currentMonth.month) return JSON.stringify({ error: "No current-month data available." });
      const monthIndex = CANONICAL_MONTHS.indexOf(currentMonth.month);
      const monthStart = new Date(Date.UTC(Number(currentMonth.year), monthIndex, 1));
      const monthEnd = new Date(Date.UTC(Number(currentMonth.year), monthIndex + 1, 1));
      const today = new Date();
      const effectiveEnd = monthEnd < today ? monthEnd : today;

      const dailySalesWhere: Record<string, unknown> = { date: { gte: monthStart, lt: effectiveEnd } };
      if (args.principal) dailySalesWhere.principal = args.principal;
      else if (scope) dailySalesWhere.principal = { in: scope.principals };

      const weeklyTargetWhere: Record<string, unknown> = { year: currentMonth.year, monthLabel: currentMonth.month };
      if (args.principal) weeklyTargetWhere.principal = args.principal;
      else if (scope) weeklyTargetWhere.principal = { in: scope.principals };
      if (scope) weeklyTargetWhere.teamLeaderId = scope.teamLeaderId;

      const [dailySales, weeklyTargets] = await Promise.all([
        prisma.dailySalesActual.findMany({ where: dailySalesWhere, select: { date: true, revenue: true } }),
        prisma.weeklyTarget.findMany({ where: weeklyTargetWhere, select: { weekLabel: true, targetValue: true } }),
      ]);

      const revenueByDate = new Map<string, number>();
      for (const r of dailySales) {
        const key = r.date.toISOString().slice(0, 10);
        revenueByDate.set(key, (revenueByDate.get(key) ?? 0) + r.revenue);
      }
      const targetByWeek = new Map<string, number>();
      for (const wt of weeklyTargets) targetByWeek.set(wt.weekLabel, (targetByWeek.get(wt.weekLabel) ?? 0) + wt.targetValue);

      const weeks = getWeeksInMonth(Number(currentMonth.year), monthIndex);
      const weekRows = weeks.map((w) => {
        const weekEnd = new Date(w.weekStartDate.getTime() + 6 * 86400000);
        let actual = 0;
        for (const [dateKey, revenue] of revenueByDate) {
          const d = new Date(`${dateKey}T00:00:00Z`);
          if (d >= w.weekStartDate && d <= weekEnd) actual += revenue;
        }
        const projection = targetByWeek.get(w.weekLabel) ?? 0;
        return { week: w.weekLabel, projection, actual, variance: actual - projection, achievedPct: projection > 0 ? (actual / projection) * 100 : null };
      });

      return JSON.stringify({ month: currentMonth.month, year: currentMonth.year, weeks: weekRows });
    },
  });
}

function makeDailyProjectionTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_daily_projection",
    description: "Today's daily revenue projection vs actual revenue so far, optionally scoped to one principal.",
    inputSchema: {
      type: "object",
      properties: {
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart.getTime() + 86400000);

      const dailyTargetWhere: Record<string, unknown> = { date: { gte: todayStart, lt: todayEnd } };
      if (args.principal) dailyTargetWhere.principal = args.principal;
      else if (scope) dailyTargetWhere.principal = { in: scope.principals };
      if (scope) dailyTargetWhere.teamLeaderId = scope.teamLeaderId;

      const dailySalesWhere: Record<string, unknown> = { date: { gte: todayStart, lt: todayEnd } };
      if (args.principal) dailySalesWhere.principal = args.principal;
      else if (scope) dailySalesWhere.principal = { in: scope.principals };

      const [targets, sales] = await Promise.all([
        prisma.dailyTarget.findMany({ where: dailyTargetWhere, select: { targetValue: true } }),
        prisma.dailySalesActual.findMany({ where: dailySalesWhere, select: { revenue: true } }),
      ]);
      const projection = targets.reduce((s, t) => s + t.targetValue, 0);
      const actual = sales.reduce((s, r) => s + r.revenue, 0);
      return JSON.stringify({ date: todayStart.toISOString().slice(0, 10), projection, actual, variance: actual - projection });
    },
  });
}

function makeJpAdherenceTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_jp_adherence",
    description: scope
      ? "Journey Plan adherence (planned vs visited outlets, productive calls, strike rate) for your own team, for the given period."
      : "Journey Plan adherence (planned vs visited outlets, productive calls, strike rate) for the given period, optionally scoped to one Cost Centre.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
        principal: { type: "string", description: "Exact Cost Centre/principal name. Omit for the total across every Cost Centre you can see." },
      },
      required: ["period"],
      additionalProperties: false,
    },
    run: async (args) => {
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const selection = resolveKeywordPeriod(args.period);
      const months = resolvePeriodMonths(selection);
      if (months.length === 0) return JSON.stringify({ error: "Couldn't resolve that period." });
      // JPAdherenceDaily.monthLabel is stored abbreviated ("Jul-2026"), unlike
      // CANONICAL_MONTHS' full names ("July") used elsewhere in this file.
      const monthLabels = Array.from(new Set(months.map((m) => `${CANONICAL_MONTHS[m.monthIndex].slice(0, 3)}-${m.year}`)));

      const where: Record<string, unknown> = { monthLabel: { in: monthLabels } };
      if (args.principal) where.costCentre = args.principal;
      else if (scope) where.costCentre = { in: scope.principals };
      if (scope) where.employeeCode = { in: scope.employeeCodes };

      const rows = await prisma.jPAdherenceDaily.findMany({
        where,
        select: { employeeCode: true, employeeName: true, outletsPlanned: true, outletsVisited: true, productiveOutlets: true, jpAdherencePct: true, strikeRatePct: true },
      });
      if (rows.length === 0) return JSON.stringify({ error: "No JP Adherence data for that period/scope." });

      const totalPlanned = rows.reduce((s, r) => s + r.outletsPlanned, 0);
      const totalVisited = rows.reduce((s, r) => s + r.outletsVisited, 0);
      const totalProductive = rows.reduce((s, r) => s + r.productiveOutlets, 0);
      const avgAdherencePct = rows.reduce((s, r) => s + r.jpAdherencePct, 0) / rows.length;
      const avgStrikeRatePct = rows.reduce((s, r) => s + r.strikeRatePct, 0) / rows.length;

      const byRep = new Map<string, { employeeName: string; adherenceSum: number; strikeSum: number; days: number }>();
      for (const r of rows) {
        const e = byRep.get(r.employeeCode) ?? { employeeName: r.employeeName, adherenceSum: 0, strikeSum: 0, days: 0 };
        e.adherenceSum += r.jpAdherencePct;
        e.strikeSum += r.strikeRatePct;
        e.days += 1;
        byRep.set(r.employeeCode, e);
      }
      const reps = Array.from(byRep.entries())
        .map(([employeeCode, v]) => ({ employeeCode, employeeName: v.employeeName, avgAdherencePct: v.adherenceSum / v.days, avgStrikeRatePct: v.strikeSum / v.days }))
        .sort((a, b) => a.avgAdherencePct - b.avgAdherencePct);
      const truncated = reps.length > MAX_ROWS;

      return JSON.stringify({
        totalPlannedOutlets: totalPlanned,
        totalVisitedOutlets: totalVisited,
        totalProductiveOutlets: totalProductive,
        avgAdherencePct,
        avgStrikeRatePct,
        lowestAdherenceReps: reps.slice(0, MAX_ROWS),
        truncated,
        totalReps: reps.length,
      });
    },
  });
}

function makeActiveOutletsSummaryTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_active_outlets_summary",
    description:
      "Active vs dormant (inactive) outlet counts for the current year, optionally scoped to one principal — includes the highest-historical-value dormant outlets (customers who have stopped buying), for customer-movement/at-risk questions.",
    inputSchema: {
      type: "object",
      properties: {
        principal: { type: "string", description: "Exact principal/Cost Centre name. Omit for totals across every principal you can see." },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const year = String(new Date().getFullYear());
      const where: Record<string, unknown> = { year };
      if (args.principal) where.principal = args.principal;
      else if (scope) where.principal = { in: scope.principals };

      const rows = await prisma.activeOutlet.findMany({
        where,
        select: { outletName: true, principal: true, status: true, sales: true, lastPurchaseDate: true },
      });
      if (rows.length === 0) return JSON.stringify({ error: "No Active Outlets data for that scope." });

      const active = rows.filter((r) => r.status === "Active");
      const inactive = rows.filter((r) => r.status === "Inactive");
      const dormantHighValueOutlets = inactive
        .slice()
        .sort((a, b) => b.sales - a.sales)
        .slice(0, MAX_ROWS)
        .map((r) => ({ outlet: r.outletName, principal: r.principal, historicalSales: r.sales, lastPurchaseDate: r.lastPurchaseDate.toISOString().slice(0, 10) }));

      return JSON.stringify({ totalOutlets: rows.length, activeCount: active.length, inactiveCount: inactive.length, dormantHighValueOutlets });
    },
  });
}

function makeComparePeriodsTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "compare_periods",
    description: "Compares revenue/gross profit for the given period against the same period last year (yoy) or the immediately previous calendar month (mom).",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
        comparison: { type: "string", enum: ["yoy", "mom"], description: "yoy = same period, prior year. mom = the immediately previous calendar month." },
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      required: ["period", "comparison"],
      additionalProperties: false,
    },
    run: async (args) => {
      const dataset = await getLatestSnapshot();
      if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);

      const selection = resolveKeywordPeriod(args.period);
      const comparisonSelection: PeriodSelection | null = args.comparison === "yoy" ? getPriorYearPeriod(selection) : getPreviousMonthPeriod(selection);
      if (!comparisonSelection) return JSON.stringify({ error: "Can't compute a month-over-month comparison for that period." });

      const principals = args.principal ? [args.principal] : scope ? scope.principals : null;
      const summarize = (sel: PeriodSelection) => {
        if (!principals) {
          const s = summarizeSalesForPeriod(dataset, sel, null);
          return { revenue: s.revenue, grossProfit: s.grossProfit };
        }
        const byPrincipal = summarizeSalesByPrincipal(dataset, sel);
        let revenue = 0, grossProfit = 0;
        for (const p of principals) {
          const row = byPrincipal.get(p);
          if (row) { revenue += row.revenue; grossProfit += row.grossProfit; }
        }
        return { revenue, grossProfit };
      };

      const current = summarize(selection);
      const comparison = summarize(comparisonSelection);
      const revenueChange = current.revenue - comparison.revenue;
      const revenueChangePct = comparison.revenue > 0 ? (revenueChange / comparison.revenue) * 100 : null;

      return JSON.stringify({
        current: { period: args.period, revenue: current.revenue, grossProfit: current.grossProfit },
        comparison: { kind: args.comparison, revenue: comparison.revenue, grossProfit: comparison.grossProfit },
        revenueChange,
        revenueChangePct,
      });
    },
  });
}

export const syncHealthTool = betaTool({
  name: "get_sync_health",
  description: "Whether each scheduled data sync (Sales, P&L, Active Outlets, Timestamps, JP Adherence) is currently fresh or stale, and when it last ran.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run: async () => {
    const rows = await getSyncHealth();
    return JSON.stringify(rows.map((r) => ({ source: r.label, cadence: r.cadenceLabel, stale: r.isStale, lastUpdated: r.lastUpdated?.toISOString() ?? null })));
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous
// tool array: each tool above is fully typed against its own schema at its
// definition site; this registry only needs to hold and filter/build them.
const TOOL_REGISTRY: { create: (scope: TeamLeaderScope | null) => any; requiresPage: PageKey | "admin" }[] = [
  { create: () => listPrincipalsTool, requiresPage: "dashboard" },
  { create: makeSalesVsTargetTool, requiresPage: "sales" },
  { create: makeCoverageByRepTool, requiresPage: "coverage" },
  { create: makePLSummaryTool, requiresPage: "profitability" },
  { create: makeTlRankingTool, requiresPage: "dashboard" },
  { create: makeWeeklyTargetTool, requiresPage: "dashboard" },
  { create: makeDailyProjectionTool, requiresPage: "dashboard" },
  { create: makeJpAdherenceTool, requiresPage: "jp-adherence" },
  { create: makeActiveOutletsSummaryTool, requiresPage: "active-outlets" },
  { create: makeComparePeriodsTool, requiresPage: "sales" },
  { create: () => syncHealthTool, requiresPage: "admin" },
];

/** Scopes Frost's toolset to whatever the requesting user is already allowed
 *  to see on the live dashboard — a user without Profitability access doesn't
 *  get a P&L tool just because they can phrase a question about it. A
 *  TEAM_LEADER additionally gets every principal/rep-scoped tool rebuilt
 *  against their own TeamLeaderAssignment rows, so (e.g.) get_sales_vs_target
 *  reflects their own team, not the whole company — matching how
 *  /weekly-targets already restricts a TEAM_LEADER session. */
export async function toolsForUser(allowedPages: readonly string[], isAdmin: boolean, teamLeaderId: string | null) {
  const scope = !isAdmin && teamLeaderId ? await loadTeamLeaderScope(teamLeaderId) : null;
  return TOOL_REGISTRY.filter((entry) => (entry.requiresPage === "admin" ? isAdmin : isAdmin || allowedPages.includes(entry.requiresPage))).map((entry) =>
    entry.create(scope)
  );
}
