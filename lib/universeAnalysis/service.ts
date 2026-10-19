// Universe analysis service: builds the analysis once per scope and month (cached), and serves each section of the screen from it.
import type { OutletScope } from "@/lib/outletUniverse/query";
import { DEFAULT_ASSUMPTIONS, DEFAULT_REP_FLAGS, LOW_STRIKE_MIN_CALLS, LOW_STRIKE_THRESHOLD, TARGET_LIST_SIZE, type Assumptions } from "./config";
import { buildInsights } from "./insights";
import { applyFilters, concentration, coverageDetail, crossBuyMatrix, DIMENSIONS, health, principalScorecard, repProductivity, summarise, teamLeaderScorecard, universe, type DimensionName, type Filters } from "./metrics";
import { loadMonthlyStrike, type MonthlyStrike } from "./monthlyStrike";
import { sizeOpportunities, targetLists, type TargetAction } from "./opportunities";
import { runPipeline, type PipelineResult } from "./pipeline";
import { qualityChecks } from "./quality";
import { loadExtractRows, MONTH_NAMES, monthsWithStrikeData } from "./source";

const TTL_MS = 10 * 60_000;

export interface AnalysisContext {
  year: number;
  monthIndex: number;
  monthLabel: string;
  availableMonths: { monthIndex: number; label: string }[];
  defaultMonthIndex: number;
  sourcesWithoutCalls: string[];
  result: PipelineResult;
  strike: MonthlyStrike;
  builtAt: string;
}

let strikeCache: { at: number; value: Promise<MonthlyStrike> } | null = null;
const contextCache = new Map<string, { at: number; value: Promise<AnalysisContext> }>();

function cachedStrike(): Promise<MonthlyStrike> {
  if (!strikeCache || Date.now() - strikeCache.at > TTL_MS) {
    const value = loadMonthlyStrike();
    value.catch(() => { strikeCache = null; });
    strikeCache = { at: Date.now(), value };
  }
  return strikeCache.value;
}

/** The last complete month with call data (the current month is still filling), else the latest month with data. */
function defaultMonth(months: number[], now: Date): number {
  if (months.length === 0) return now.getMonth();
  const earlier = months.filter((m) => m < now.getMonth());
  return earlier.length ? earlier[earlier.length - 1] : months[months.length - 1];
}

export async function getAnalysisContext(scope: OutletScope, requestedMonth: number | null): Promise<AnalysisContext> {
  const strike = await cachedStrike();
  const now = new Date();
  const months = monthsWithStrikeData(strike);
  const fallback = defaultMonth(months, now);
  const monthIndex = requestedMonth !== null && months.includes(requestedMonth) ? requestedMonth : fallback;
  const scopeKey = scope ? [...scope.principals].sort().join("|") : "all";
  const key = `${scopeKey}#${monthIndex}`;
  const hit = contextCache.get(key);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.value;
  const value = (async (): Promise<AnalysisContext> => {
    const { rows, sourcesWithoutCalls } = await loadExtractRows(scope, strike, monthIndex);
    const result = runPipeline(rows);
    return {
      year: strike.year,
      monthIndex,
      monthLabel: `${MONTH_NAMES[monthIndex]} ${strike.year}`,
      availableMonths: months.map((m) => ({ monthIndex: m, label: MONTH_NAMES[m] })),
      defaultMonthIndex: fallback,
      sourcesWithoutCalls,
      result,
      strike,
      builtAt: new Date().toISOString(),
    };
  })();
  value.catch(() => contextCache.delete(key));
  contextCache.set(key, { at: Date.now(), value });
  // Keep the cache small: a handful of months per scope is plenty.
  if (contextCache.size > 24) for (const k of [...contextCache.keys()].slice(0, contextCache.size - 24)) contextCache.delete(k);
  return value;
}

export type SectionName = "overview" | "strike" | "universe" | "scorecards" | "opportunities" | "targets" | "duplicates" | "quality" | "filters" | "outlets";

export interface SectionParams {
  filters: Filters;
  assumptions: Partial<Assumptions>;
  action: TargetAction | null;
  status: "merged" | "review";
  limit: number;
}

const FILTER_DIMENSIONS: DimensionName[] = ["principal", "route_class", "channel", "region", "segment", "team_leader", "rep", "coverage", "tier", "recency", "tenure", "source"];

function monthlyTrend(ctx: AnalysisContext, principals: Set<string>, principalFilter: string[] | undefined) {
  const months = ctx.availableMonths.map((m) => m.monthIndex);
  const wanted = (principal: string) => principals.has(principal) && (!principalFilter || principalFilter.length === 0 || principalFilter.includes(principal));
  const perPrincipal = new Map<string, { calls: number[]; productive: number[] }>();
  const total = { calls: new Array(12).fill(0) as number[], productive: new Array(12).fill(0) as number[] };
  for (const [key, e] of ctx.strike.byPrincipal) {
    const [source, principal] = key.split("\u0000");
    if (source === "LEVERAGE" || !wanted(principal)) continue;
    const own = perPrincipal.get(principal) ?? { calls: new Array(12).fill(0), productive: new Array(12).fill(0) };
    for (const m of months) {
      if (e.productive[m] === null) continue;
      own.calls[m] += e.calls[m];
      own.productive[m] += e.productive[m] as number;
      total.calls[m] += e.calls[m];
      total.productive[m] += e.productive[m] as number;
    }
    perPrincipal.set(principal, own);
  }
  const point = (c: number, p: number) => (c > 0 ? Math.round((p / c) * 1000) / 10 : null);
  const topPrincipals = [...perPrincipal.entries()].sort((a, b) => b[1].calls.reduce((s, v) => s + v, 0) - a[1].calls.reduce((s, v) => s + v, 0)).slice(0, 8).map(([p]) => p);
  return {
    months: months.map((m) => ({ monthIndex: m, label: MONTH_NAMES[m], calls: total.calls[m], productive: total.productive[m], strikeRate: point(total.calls[m], total.productive[m]) })),
    byPrincipal: topPrincipals.map((p) => ({ principal: p, points: months.map((m) => ({ monthIndex: m, label: MONTH_NAMES[m], calls: perPrincipal.get(p)!.calls[m], productive: perPrincipal.get(p)!.productive[m], strikeRate: point(perPrincipal.get(p)!.calls[m], perPrincipal.get(p)!.productive[m]) })) })),
  };
}

export function buildSection(ctx: AnalysisContext, section: SectionName, params: SectionParams): unknown {
  const all = ctx.result.fact;
  const rows = applyFilters(all, params.filters);
  const meta = { month: { monthIndex: ctx.monthIndex, label: ctx.monthLabel }, availableMonths: ctx.availableMonths, defaultMonthIndex: ctx.defaultMonthIndex, builtAt: ctx.builtAt, rowCount: rows.length, sourcesWithoutCalls: ctx.sourcesWithoutCalls };
  const assumptions: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...params.assumptions };
  switch (section) {
    case "filters":
      return { meta, options: Object.fromEntries(FILTER_DIMENSIONS.map((d) => [d, [...new Set(all.map((r) => DIMENSIONS[d](r)).filter((v): v is string => v !== null && v !== ""))].sort()])) };
    case "overview": {
      const opp = sizeOpportunities(rows, assumptions);
      return {
        meta,
        universe: universe(rows),
        total: summarise(rows)[0],
        direct: summarise(rows.filter((r) => r.isDirect))[0],
        distributor: summarise(rows.filter((r) => !r.isDirect))[0],
        opportunities: {
          distributorToDirect: { pool: opp.distributorToDirect.pool, annualValue: opp.distributorToDirect.annualValue },
          crossSell: { pool: opp.crossSell.pool, annualValue: opp.crossSell.annualValue },
          frequency: { pool: opp.frequency.pool, annualValue: opp.frequency.annualValue },
          lapsing: { pool: opp.lapsing.pool, annualValue: opp.lapsing.annualValue },
          unproductiveCalls: opp.unproductiveCalls,
          routeOverlap: opp.routeOverlap,
          totalNewRevenue: opp.totalNewRevenue,
        },
        insights: buildInsights(rows, ctx.monthLabel, ctx.sourcesWithoutCalls),
        dedup: { records: ctx.result.records.length, merged: ctx.result.records.filter((r) => !r.isMaster).length, groups: new Set(ctx.result.records.filter((r) => r.clusterSize > 1).map((r) => r.cluster)).size, toReview: ctx.result.pairs.filter((p) => p.confidence === "Review").length },
      };
    }
    case "strike": {
      const principals = new Set(all.map((r) => r.principal));
      return {
        meta,
        total: summarise(rows)[0],
        byPrincipal: summarise(rows, ["principal"]),
        byRouteChannel: summarise(rows, ["route_class", "channel"]),
        byRegion: summarise(rows, ["region"]),
        byRepRegion: summarise(rows, ["rep_region", "rep_subregion"]),
        byTeamLeader: summarise(rows, ["team_leader"]),
        byRecency: summarise(rows, ["recency"]),
        byConsistency: summarise(rows, ["consistency"]),
        byTenure: summarise(rows, ["tenure"]),
        bySegment: summarise(rows, ["segment"]),
        byTier: summarise(rows, ["tier"]),
        trend: monthlyTrend(ctx, principals, params.filters.principal),
        lowStrike: targetLists(rows, params.limit, LOW_STRIKE_MIN_CALLS, LOW_STRIKE_THRESHOLD).filter((t) => t.action === "Fix strike rate"),
        lowStrikeRule: { windowMonths: 3, minCalls: LOW_STRIKE_MIN_CALLS, thresholdPct: LOW_STRIKE_THRESHOLD },
      };
    }
    case "universe":
      return {
        meta,
        summary: universe(rows),
        bySegment: coverageDetail(rows, "segment"),
        byRegion: coverageDetail(rows, "region"),
        healthRecency: health(rows, "recency"),
        healthTenure: health(rows, "tenure"),
        healthConsistency: health(rows, "consistency"),
        concentration: concentration(rows),
        concentrationWholesale: concentration(rows, "Wholesale"),
        crossBuy: crossBuyMatrix(rows, assumptions.nairobiPrincipals),
      };
    case "scorecards":
      return { meta, principals: principalScorecard(rows), teamLeaders: teamLeaderScorecard(rows), reps: repProductivity(rows, DEFAULT_REP_FLAGS) };
    case "opportunities":
      return { meta, assumptions, opportunities: sizeOpportunities(rows, assumptions) };
    case "targets": {
      const list = targetLists(rows, params.limit || TARGET_LIST_SIZE, LOW_STRIKE_MIN_CALLS, LOW_STRIKE_THRESHOLD);
      const counts: Record<string, number> = {};
      for (const t of list) counts[t.action] = (counts[t.action] ?? 0) + 1;
      return { meta, counts, rows: params.action ? list.filter((t) => t.action === params.action) : list };
    }
    case "duplicates": {
      const byKey = new Map(ctx.result.records.map((r) => [r.recKey, r]));
      if (params.status === "review") {
        const pairs = ctx.result.pairs
          .filter((p) => p.confidence === "Review")
          .sort((a, b) => b.nameSim - a.nameSim)
          .slice(0, params.limit)
          .map((p) => ({ ...p, outletA: byKey.get(p.a)?.outlet ?? "", sourceA: byKey.get(p.a)?.source ?? "", outletB: byKey.get(p.b)?.outlet ?? "", sourceB: byKey.get(p.b)?.source ?? "" }));
        return { meta, total: ctx.result.pairs.filter((p) => p.confidence === "Review").length, pairs };
      }
      const merged = ctx.result.records
        .filter((r) => r.clusterSize > 1)
        .sort((a, b) => (a.masterId < b.masterId ? -1 : a.masterId > b.masterId ? 1 : Number(b.isMaster) - Number(a.isMaster)))
        .map((r) => ({ recKey: r.recKey, source: r.source, outlet: r.outlet, principals: r.principals, region: r.region, masterId: r.masterId, isMaster: r.isMaster, clusterSize: r.clusterSize, matchType: r.matchType, confidence: r.confidence, method: r.method, metresFromMaster: r.metresFromMaster === null ? null : Math.round(r.metresFromMaster), simToMaster: r.simToMaster, sales: r.sales }));
      return { meta, total: merged.length, records: merged.slice(0, params.limit) };
    }
    case "outlets":
      // The rows behind every table (one per master outlet x principal x route class): the analysis' "Outlet Data", for pivoting.
      return {
        meta,
        rows: rows.slice(0, params.limit).map((r) => ({
          masterId: r.masterId, source: r.source, outletId: r.outletId, outlet: r.outlet, principal: r.principal, routeClass: r.routeClass, channel: r.channel, segment: r.segment, regionClean: r.regionClean,
          territory: r.territory, rep: r.rep, teamLeader: r.teamLeader, repRegion: r.repRegion, repSubregion: r.repSubregion, salesYtd: r.sales, transactionsYtd: r.tx, avgInvoiceUniqueOutlet: r.avgInvoiceUnique,
          tierCorrected: r.tierCorrected, monthlyRunRate: r.monthlyRunRate, daysSincePurchase: r.daysSince, recencyBand: r.recencyBand, buyingTenure: r.tenure, periodsBoughtLast3: r.periods3, coverageRoute: r.coverageRoute,
          callsWithOutcome: r.callsWithOutcome, productiveCalls: r.productiveCalls, unproductiveCalls: r.unproductiveCalls, strikeRatePct: r.strike, strikeBand: r.strikeBand, unproductiveCallValue: r.unproductiveValue,
        })),
      };
    case "quality":
      return { meta, checks: qualityChecks(ctx.result.raw, all, ctx.result.records, ctx.result.pairs, { monthLabel: ctx.monthLabel, sourcesWithoutCalls: ctx.sourcesWithoutCalls }) };
  }
}
