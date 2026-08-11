import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { getLatestSnapshot } from "../datasetStore";
import { getSyncHealth } from "../syncHealth";
import { prisma } from "../db";
import {
  summarizeSalesByPrincipal,
  summarizeCoverageByRep,
  summarizePLForPeriod,
  summarizeSalesForPeriod,
  summarizeBrandCustomerByRepAndPrincipal,
  getCurrentMonthPeriod,
  getPriorYearPeriod,
  getPreviousMonthPeriod,
  resolvePeriodMonths,
  CANONICAL_MONTHS,
  type PeriodSelection,
} from "../timeIntelligence";
import { getWeeksInMonth } from "../weeklyTargets";
import { buildTlRanking, buildSupervisorRanking, buildManagerRanking } from "../tlRanking";
import { getMtdTargetByTeamLeader } from "../mtdTarget";
import { resolveKeywordPeriod, PERIOD_KEYWORDS } from "./period";
import type { PageKey } from "../pageAccess";
import { loadTeamLeaderScope, loadViewerPrincipalScope, loadSupervisorScope, type TeamLeaderScope } from "../teamLeaderScope";
import { getJpAdherenceSummary } from "../jpAdherence";
import { getOrder360Summary } from "../order360Summary";
import { normalizePrincipalKey } from "../normalize";

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
      const repRevenue = summarizeBrandCustomerByRepAndPrincipal(dataset, currentMonth, args.principal ?? null).map((r) => ({ salesEmployee: r.salesEmployee, principal: r.principal, revenue: r.revenue }));

      const [assignments, teamLeaders, mtdTargets] = await Promise.all([
        prisma.teamLeaderAssignment.findMany({ select: { teamLeaderId: true, employeeName: true, sapName: true, principal: true, active: true } }),
        prisma.teamLeader.findMany({ select: { id: true, name: true } }),
        getMtdTargetByTeamLeader(currentMonth.year, currentMonth.month),
      ]);

      const result = buildTlRanking(repRevenue, assignments, teamLeaders, mtdTargets);
      if (!scope) return JSON.stringify(result);

      if (scope.teamLeaderId) {
        const rankings = result.rankings.filter((r) => r.teamLeaderId === scope.teamLeaderId);
        return JSON.stringify({ rankings, unmatchedReps: [] });
      }
      // Principal-restricted VIEWER: every Team Leader with an active assignment
      // under an allowed principal — see the matching comment in the /api/dashboard/
      // tl-ranking route for why mtdTarget/mtdRevenue stay un-narrowed by principal.
      const allowedTeamLeaderIds = new Set(
        assignments.filter((a) => a.active && scope.principals.includes(a.principal)).map((a) => a.teamLeaderId)
      );
      const rankings = result.rankings.filter((r) => allowedTeamLeaderIds.has(r.teamLeaderId));
      return JSON.stringify({ rankings, unmatchedReps: [] });
    },
  });
}

/** Shared setup for the two ranking-rollup tools below — dataset revenue +
 *  assignments/teamLeaders/mtdTargets, same fetch makeTlRankingTool already
 *  does, plus Supervisor/Manager reference lists. Returns null when there's no
 *  dataset or no current-month data (callers turn that into the tool's error JSON). */
async function loadRankingInputs(principal: string | undefined) {
  const dataset = await getLatestSnapshot();
  if (!dataset) return null;
  const currentMonth = getCurrentMonthPeriod(dataset);
  if (!currentMonth.month) return null;
  const repRevenue = summarizeBrandCustomerByRepAndPrincipal(dataset, currentMonth, principal ?? null).map((r) => ({ salesEmployee: r.salesEmployee, principal: r.principal, revenue: r.revenue }));

  const [assignments, teamLeaders, supervisors, managers, mtdTargets] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({ select: { teamLeaderId: true, employeeName: true, sapName: true, principal: true, active: true, supervisorId: true, managerId: true } }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.supervisor.findMany({ select: { id: true, name: true } }),
    prisma.manager.findMany({ select: { id: true, name: true } }),
    getMtdTargetByTeamLeader(currentMonth.year, currentMonth.month),
  ]);
  const tlRanking = buildTlRanking(repRevenue, assignments, teamLeaders, mtdTargets);
  return { assignments, supervisors, managers, tlRanking };
}

function makeSupervisorRankingTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_supervisor_ranking",
    description: scope
      ? "Your own Sales Supervisor group's MTD Target vs MTD Revenue achievement, for the current calendar month (several Team Leaders can report to one Supervisor)."
      : "MTD Target vs MTD Revenue achievement per Sales Supervisor, for the current calendar month, ranked from best to poorest — the primary Team Leader Ranking grouping (each Supervisor typically oversees several Team Leaders).",
    inputSchema: {
      type: "object",
      properties: {
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const inputs = await loadRankingInputs(args.principal);
      if (!inputs) return JSON.stringify({ error: "No dataset or no current-month data available." });

      const supervisorRanking = buildSupervisorRanking(inputs.tlRanking.rankings, inputs.assignments, inputs.supervisors);
      if (scope?.supervisorId) {
        return JSON.stringify({ rankings: supervisorRanking.rankings.filter((r) => r.supervisorId === scope.supervisorId), unassignedTeamLeaders: [] });
      }
      if (scope?.teamLeaderId) {
        // A single Team Leader session has no supervisor grouping of its own —
        // just their one row's context (which Supervisor they report to, if any).
        const own = supervisorRanking.rankings.find((r) => r.teamLeaders.some((tl) => tl.teamLeaderId === scope.teamLeaderId));
        return JSON.stringify({ rankings: own ? [own] : [], unassignedTeamLeaders: [] });
      }
      return JSON.stringify(supervisorRanking);
    },
  });
}

function makeManagerRankingTool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_manager_ranking",
    description:
      "MTD Target vs MTD Revenue achievement per Manager, for the current calendar month, ranked from best to poorest — one tier above Sales Supervisor (a Manager can span several Supervisors and even several principals). Reporting dimension only, admin/unrestricted view.",
    inputSchema: {
      type: "object",
      properties: {
        principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal you can see." },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      if (scope && args.principal && !scope.principals.includes(args.principal)) return refusal(args.principal);
      const inputs = await loadRankingInputs(args.principal);
      if (!inputs) return JSON.stringify({ error: "No dataset or no current-month data available." });

      const supervisorRanking = buildSupervisorRanking(inputs.tlRanking.rankings, inputs.assignments, inputs.supervisors);
      const scopedSupervisors = scope?.supervisorId ? supervisorRanking.rankings.filter((r) => r.supervisorId === scope.supervisorId) : supervisorRanking.rankings;
      return JSON.stringify(buildManagerRanking(scopedSupervisors, inputs.assignments, inputs.managers));
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
      // scope.teamLeaderIds (not the singular teamLeaderId) so a SUPERVISOR session
      // narrows to every Team Leader in their own group, not just principal — a
      // TEAM_LEADER session's teamLeaderIds is always exactly [their own id].
      if (scope && scope.teamLeaderIds.length > 0) weeklyTargetWhere.teamLeaderId = { in: scope.teamLeaderIds };

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
      // See makeWeeklyTargetTool's matching comment on scope.teamLeaderIds vs teamLeaderId.
      if (scope && scope.teamLeaderIds.length > 0) dailyTargetWhere.teamLeaderId = { in: scope.teamLeaderIds };

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
      const start = new Date(Date.UTC(Number(months[0].year), months[0].monthIndex, 1));
      const lastMonth = months[months.length - 1];
      const end = new Date(Date.UTC(Number(lastMonth.year), lastMonth.monthIndex + 1, 1));

      const summary = await getJpAdherenceSummary(
        { start, end },
        scope,
        { principalKey: args.principal ? normalizePrincipalKey(args.principal) : null, date: null, dayNames: null, roleFilter: "all", employeeCode: null, teamLeader: null }
      );
      if (summary.repDaySummary.length === 0) return JSON.stringify({ error: "No JP Adherence data for that period/scope." });

      const byRep = new Map<string, { employeeName: string; adherenceSum: number; strikeSum: number; days: number }>();
      for (const r of summary.repDaySummary) {
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
        totalPlannedOutlets: summary.kpis.outletsPlanned,
        totalVisitedOutlets: summary.kpis.outletsVisited,
        totalProductiveOutlets: summary.kpis.productiveOutlets,
        avgAdherencePct: summary.kpis.jpAdherencePct,
        avgStrikeRatePct: summary.kpis.strikeRatePct,
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

/** Order 360's own "Critical findings" panel on the dashboard is a fixed set of
 *  template callouts, each hidden when its underlying figure is zero (see
 *  app/(protected)/(analytics)/order-360/page.tsx) — but a fixed template
 *  can't adapt its framing to what's actually notable in a given window. This
 *  tool hands Frost the same underlying numbers instead, so it can reason
 *  about what's actually worth flagging (or correctly say "nothing stuck"
 *  rather than templating a finding out of an all-zero backlog). */
function makeOrder360Tool(scope: TeamLeaderScope | null) {
  return betaTool({
    name: "get_order_360_summary",
    description:
      "Order fulfillment pipeline health (SAP_Orders synced from Pine): funnel counts per stage (Invoiced/Cleared/Picked/Dispatched/Audited/Delivered), open backlog per gate, POD/payment delivery-confirmation split, top at-risk delivery vans, returns, and STK payment coverage.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: 'A specific loaded month as "YYYY-MM". Omit for the full loaded history (up to the last 3 months).' },
      },
      additionalProperties: false,
    },
    run: async (args) => {
      const month = typeof args.month === "string" && /^\d{4}-\d{2}$/.test(args.month) ? args.month : null;
      const summary = await getOrder360Summary(new Date(), scope, { month, weekLabel: null, dateFrom: null, dateTo: null, dayNames: null });
      if (summary.meta.totalOrders === 0) return JSON.stringify({ error: "No Order 360 data for that window." });

      const pendingDeliveryDrivers = summary.perf.deliveryDrivers
        .filter((d) => d.pendingOrders > 0)
        .sort((a, b) => b.pendingValue - a.pendingValue)
        .slice(0, MAX_ROWS)
        .map((d) => ({ name: d.name, pendingOrders: d.pendingOrders, pendingValue: d.pendingValue, avgAgePendingDays: d.avgAgePending, unconfirmedDeliveredOrders: d.unconfirmedOrders }));

      return JSON.stringify({
        range: summary.meta.range,
        totalOrders: summary.meta.totalOrders,
        totalValue: summary.meta.totalValue,
        funnel: summary.funnel,
        openBacklogByGate: {
          clearance: summary.backlog.clearance.length,
          pick: summary.backlog.pick.length,
          dispatch: summary.backlog.dispatch.length,
          audit: summary.backlog.audit.length,
          delivery: summary.backlog.delivery.length,
        },
        podConfirmedPct: summary.meta.podConfirmedPct,
        podConfirmedCount: summary.meta.podConfirmedCount,
        podUnconfirmedCount: summary.meta.podUnconfirmedCount,
        podUnconfirmedDisclaimer:
          "Orders counted as Delivered without a POD/payment record are dispatched-only with no return logged - could be a credit sale (paid outside STK) or a genuinely unconfirmed/lost delivery. Pine's data alone can't tell which, so frame this as needing manual verification, not a confirmed loss.",
        pendingDeliveryDrivers,
        returns: { totalCount: summary.returns.totalCount, totalValue: summary.returns.totalValue },
        payments: { stkCount: summary.payments.stkCount, noStkCount: summary.payments.noStkCount, mismatchCount: summary.payments.mismatchCount },
      });
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

/** Anthropic's server-executed web search — not a betaTool() wrapper, since
 *  there's no local run() to call: Claude issues the search and reads the
 *  results itself, server-side, and only the final answer comes back to us.
 *  This is the one Frost tool that reaches outside this app's own data, so
 *  it's a different trust tier from everything above (see SYSTEM_PROMPT in
 *  agent.ts for the usage/labeling rules that keep it from being confused
 *  with the app's "never invent, only report what's real" data). max_uses
 *  caps searches per turn, both for cost and because each search's raw
 *  result content shares the same reply token budget as the synthesized
 *  answer itself — too many searches in one turn was observed cutting
 *  answers off mid-sentence before there was any room left to write them. */
const webSearchTool = {
  type: "web_search_20250305" as const,
  name: "web_search" as const,
  max_uses: 2,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous
// tool array: each tool above is fully typed against its own schema at its
// definition site; this registry only needs to hold and filter/build them.
const TOOL_REGISTRY: { create: (scope: TeamLeaderScope | null) => any; requiresPage: PageKey | "admin" }[] = [
  { create: () => listPrincipalsTool, requiresPage: "dashboard" },
  { create: makeSalesVsTargetTool, requiresPage: "sales" },
  { create: makeCoverageByRepTool, requiresPage: "coverage" },
  { create: makePLSummaryTool, requiresPage: "profitability" },
  { create: makeTlRankingTool, requiresPage: "dashboard" },
  { create: makeSupervisorRankingTool, requiresPage: "dashboard" },
  { create: makeManagerRankingTool, requiresPage: "dashboard" },
  { create: makeWeeklyTargetTool, requiresPage: "dashboard" },
  { create: makeDailyProjectionTool, requiresPage: "dashboard" },
  { create: makeJpAdherenceTool, requiresPage: "jp-adherence" },
  { create: makeActiveOutletsSummaryTool, requiresPage: "active-outlets" },
  { create: makeOrder360Tool, requiresPage: "order-360" },
  { create: makeComparePeriodsTool, requiresPage: "sales" },
  { create: () => syncHealthTool, requiresPage: "admin" },
  { create: () => webSearchTool, requiresPage: "frost" },
];

/** Scopes Frost's toolset to whatever the requesting user is already allowed
 *  to see on the live dashboard — a user without Profitability access doesn't
 *  get a P&L tool just because they can phrase a question about it. A
 *  TEAM_LEADER additionally gets every principal/rep-scoped tool rebuilt
 *  against their own TeamLeaderAssignment rows, and a principal-restricted
 *  VIEWER gets the same rebuilt against their own User.allowedPrincipals — so
 *  (e.g.) get_sales_vs_target reflects only what that session can see,
 *  matching how /weekly-targets and every Prisma-backed dashboard route
 *  already restrict these two session kinds. */
export async function toolsForUser(
  allowedPages: readonly string[],
  isAdmin: boolean,
  teamLeaderId: string | null,
  allowedPrincipals: readonly string[] = [],
  supervisorId: string | null = null
) {
  const scope = isAdmin
    ? null
    : supervisorId
      ? await loadSupervisorScope(supervisorId)
      : teamLeaderId
        ? await loadTeamLeaderScope(teamLeaderId)
        : allowedPrincipals.length > 0
          ? await loadViewerPrincipalScope([...allowedPrincipals])
          : null;
  return TOOL_REGISTRY.filter((entry) => (entry.requiresPage === "admin" ? isAdmin : isAdmin || allowedPages.includes(entry.requiresPage))).map((entry) =>
    entry.create(scope)
  );
}
