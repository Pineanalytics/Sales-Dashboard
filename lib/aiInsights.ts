import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { getLiveDataset } from "./datasetStore";
import { getSyncHealth } from "./syncHealth";
import {
  summarizeSalesByPrincipal,
  getPreviousMonthPeriod,
  getPriorYearPeriod,
  CANONICAL_MONTHS,
  type PeriodSelection,
} from "./timeIntelligence";
import { normalizePrincipalKey } from "./normalize";

const MODEL = "claude-sonnet-5";

// Mirrors app/api/active-outlets/upload/route.ts's own STALE_AFTER_DAYS — an
// outlet with no purchase in this many days is swept to "Inactive" by the
// Active Outlets bridge. Kept in sync manually since the two live in
// different sync pipelines with no shared constant today.
const OUTLET_STALE_AFTER_DAYS = 60;
const NEWLY_DORMANT_WINDOW_DAYS = 30;

// A cached digest younger than this is served as-is instead of triggering a
// fresh Claude call — keeps rapid period-pill clicking cheap while still
// feeling "live" to a user who changes period every few minutes.
const CACHE_FRESHNESS_MS = 30 * 60 * 1000;

export type FindingSeverity = "info" | "warning" | "critical";

export interface AiInsightFinding {
  severity: FindingSeverity;
  title: string;
  detail: string;
}

export interface AiInsightRecord {
  id: string;
  generatedAt: string;
  summary: string;
  findings: AiInsightFinding[];
  model: string;
  period: PeriodSelection;
  principalKey: string | null;
}

/** Default selection when a caller doesn't supply one (the daily cron script,
 *  or any request predating the period/principal-aware API) — "this month to
 *  date," matching the app-wide default period a fresh page load lands on. */
export function defaultInsightsPeriod(): PeriodSelection {
  const now = new Date();
  return { kind: "MTD", year: String(now.getFullYear()), month: CANONICAL_MONTHS[now.getMonth()] };
}

function periodCacheKey(selection: PeriodSelection, principalKey: string | null): string {
  return [selection.kind, selection.year, selection.month ?? "", selection.toYear ?? "", selection.toMonth ?? "", principalKey ?? ""].join("|");
}

/** Human-readable label for the model's prompt and the stored record — every
 *  PeriodKind the top PeriodSelector can produce, so the digest always names
 *  the period it's actually reporting on instead of assuming "this month." */
function describePeriod(selection: PeriodSelection): string {
  switch (selection.kind) {
    case "MTD":
      return `Month to date (${selection.month} ${selection.year})`;
    case "MONTH":
      return `${selection.month} ${selection.year}`;
    case "QTD":
      return `Quarter to date (${selection.year})`;
    case "YTD":
      return `Year to date (${selection.year})`;
    case "H1":
      return `H1 ${selection.year}`;
    case "H2":
      return `H2 ${selection.year}`;
    case "Q1":
    case "Q2":
    case "Q3":
    case "Q4":
      return `${selection.kind} ${selection.year}`;
    case "CUSTOM":
      return `${selection.month} ${selection.year} through ${selection.toMonth} ${selection.toYear}`;
    default:
      return `${selection.kind} ${selection.year}`;
  }
}

/** A principal counts as dormant when it has zero revenue across the trailing
 *  3 calendar months as of right now (independent of whatever period is being
 *  viewed — dormancy is a live status, not a period-relative one) — e.g. a
 *  principal like Promasidor/Bic with no live sales activity but a stale
 *  target row still on file. Comparing a flat line against target is noise,
 *  not a finding, so these get excluded from every Insights comparison below
 *  rather than commented on. */
function trailingThreeMonthsSelection(anchor: PeriodSelection): PeriodSelection {
  let from = anchor;
  for (let i = 0; i < 2; i++) {
    const prev = getPreviousMonthPeriod(from);
    if (!prev) break;
    from = prev;
  }
  return { kind: "CUSTOM", year: from.year, month: from.month, toYear: anchor.year, toMonth: anchor.month };
}

interface CustomerDormancySignal {
  newlyDormantOutlets: number;
  byPrincipal: { principal: string; count: number; lostSalesValue: number }[];
}

/** Outlets that just crossed into "Inactive" (per the Active Outlets bridge's
 *  own 60-day no-purchase rule, app/api/active-outlets/upload/route.ts) within
 *  the last 30 days — a grounded, data-derived "customers going quiet" signal
 *  for the digest, not a propensity model. Only ever reads ActiveOutlet's
 *  already-computed status/lastPurchaseDate fields, never estimates anything
 *  itself. Excludes principals already flagged dormant on the Sales side —
 *  noise, since there's nothing left to lose there. principalKey (raw Sales
 *  principal string) narrows to one brand when the viewer has one selected;
 *  ActiveOutlet.principal is a Cost Centre string in a different raw format,
 *  so the match is done on the normalized brand key, same as everywhere else
 *  Sales-side and Active-Outlets-side principals get cross-referenced. */
async function buildCustomerDormancySignal(dormantBrandKeys: Set<string>, principalKey: string | null): Promise<CustomerDormancySignal | null> {
  const year = String(new Date().getFullYear());
  const now = Date.now();
  const windowStart = new Date(now - (OUTLET_STALE_AFTER_DAYS + NEWLY_DORMANT_WINDOW_DAYS) * 86400000);
  const windowEnd = new Date(now - OUTLET_STALE_AFTER_DAYS * 86400000);
  const selectedBrandKey = principalKey ? normalizePrincipalKey(principalKey) : null;

  const rows = await prisma.activeOutlet.findMany({
    where: { year, status: "Inactive", lastPurchaseDate: { gte: windowStart, lte: windowEnd } },
    select: { principal: true, sales: true },
  });
  if (rows.length === 0) return null;

  const byPrincipal = new Map<string, { principal: string; count: number; lostSalesValue: number }>();
  for (const r of rows) {
    const brandKey = normalizePrincipalKey(r.principal);
    if (dormantBrandKeys.has(brandKey)) continue;
    if (selectedBrandKey && brandKey !== selectedBrandKey) continue;
    const existing = byPrincipal.get(r.principal);
    if (existing) {
      existing.count += 1;
      existing.lostSalesValue += r.sales;
    } else {
      byPrincipal.set(r.principal, { principal: r.principal, count: 1, lostSalesValue: r.sales });
    }
  }

  const full = Array.from(byPrincipal.values()).sort((a, b) => b.count - a.count);
  const newlyDormantOutlets = full.reduce((sum, p) => sum + p.count, 0);
  if (newlyDormantOutlets === 0) return null;

  return {
    newlyDormantOutlets,
    byPrincipal: full.slice(0, 5).map((p) => ({ ...p, lostSalesValue: Math.round(p.lostSalesValue) })),
  };
}

/** Compact, token-cheap context for the model — every figure here is already
 *  computed by lib/timeIntelligence.ts / lib/syncHealth.ts / the Active
 *  Outlets bridge, never re-derived or estimated by the model itself. Caps
 *  principal lists at 5 each way so a large dataset doesn't blow up the
 *  prompt. `selection`/`principalKey` mirror whatever the viewer currently
 *  has picked on the top PeriodSelector/PrincipalSelector — see
 *  app/api/ai-insights/route.ts. */
async function buildContext(selection: PeriodSelection, principalKey: string | null): Promise<{ hasData: boolean; text: string }> {
  // Customer dormancy signals need the large customer/brand detail; normal
  // dashboard loads intentionally omit it.
  const dataset = await getLiveDataset({ includeBrandCustomer: true });
  const syncHealth = await getSyncHealth();

  if (!dataset) {
    return {
      hasData: false,
      text: JSON.stringify({ note: "No dataset uploaded yet.", syncHealth: syncHealth.map((s) => ({ source: s.label, stale: s.isStale })) }),
    };
  }

  // Dormancy is anchored to the real current month regardless of the viewed
  // period — a principal with no live activity is dormant whether you're
  // looking at MTD or last year's Q2.
  const trailingByPrincipal = summarizeSalesByPrincipal(dataset, trailingThreeMonthsSelection(defaultInsightsPeriod()));
  const dormantPrincipals = new Set(
    Array.from(trailingByPrincipal.values())
      .filter((p) => p.revenue <= 0)
      .map((p) => p.principal)
  );
  const dormantBrandKeys = new Set(Array.from(dormantPrincipals).map(normalizePrincipalKey));

  const currentByPrincipal = summarizeSalesByPrincipal(dataset, selection);

  // A single calendar month reads best against the prior month (MoM); every
  // other period kind (QTD/YTD/H1/H2/Q1-Q4/CUSTOM) reads best against the
  // same period last year (YoY) — "the previous month" isn't a meaningful
  // comparison for a quarter or a half.
  const comparisonBasis: "mom" | "yoy" = selection.kind === "MTD" || selection.kind === "MONTH" ? "mom" : "yoy";
  const comparisonPeriod = comparisonBasis === "mom" ? getPreviousMonthPeriod(selection) : getPriorYearPeriod(selection);
  const comparisonByPrincipal = comparisonPeriod ? summarizeSalesByPrincipal(dataset, comparisonPeriod) : null;

  function trendGrowthPct(principal: string, currentRevenue: number): number | null {
    const prev = comparisonByPrincipal?.get(principal);
    if (!prev || prev.revenue <= 0) return null;
    return Math.round(((currentRevenue - prev.revenue) / prev.revenue) * 1000) / 10;
  }

  let activePrincipals = Array.from(currentByPrincipal.values()).filter((p) => !dormantPrincipals.has(p.principal));
  if (principalKey) activePrincipals = activePrincipals.filter((p) => p.principal === principalKey);

  const withTarget = activePrincipals.filter((p) => p.target !== null && p.target > 0);

  const sorted = [...withTarget].sort((a, b) => (a.achievementPct ?? 0) - (b.achievementPct ?? 0));
  const behindTarget = sorted.slice(0, 5).map((p) => ({
    principal: p.principal,
    revenue: Math.round(p.revenue),
    target: Math.round(p.target ?? 0),
    achievementPct: p.achievementPct,
    growthPct: trendGrowthPct(p.principal, p.revenue),
  }));
  const aheadOfTarget = sorted
    .slice(-5)
    .reverse()
    .map((p) => ({
      principal: p.principal,
      revenue: Math.round(p.revenue),
      target: Math.round(p.target ?? 0),
      achievementPct: p.achievementPct,
      growthPct: trendGrowthPct(p.principal, p.revenue),
    }));

  // Own-brand trend: top gainers/decliners by growth %, independent of
  // whether a target is on file — the comparison figure is real either way.
  const trended = activePrincipals
    .map((p) => ({ principal: p.principal, revenue: Math.round(p.revenue), growthPct: trendGrowthPct(p.principal, p.revenue) }))
    .filter((p): p is { principal: string; revenue: number; growthPct: number } => p.growthPct !== null);
  const byGrowth = [...trended].sort((a, b) => b.growthPct - a.growthPct);
  const topGainers = byGrowth.slice(0, 3);
  const topDecliners = byGrowth
    .slice(-3)
    .reverse()
    .filter((p) => !topGainers.includes(p));

  const customerDormancy = await buildCustomerDormancySignal(dormantBrandKeys, principalKey);

  const context = {
    period: describePeriod(selection),
    principalScope: principalKey ?? "All Principals",
    reportTitle: dataset.reportMeta.title,
    principalsWithTarget: withTarget.length,
    dormantPrincipalsExcluded:
      dormantPrincipals.size > 0
        ? {
            count: dormantPrincipals.size,
            principals: Array.from(dormantPrincipals),
            note: "No sales activity in the trailing 3 months — already excluded from every comparison below. Do not comment on these principals.",
          }
        : null,
    mostBehindTarget: behindTarget,
    mostAheadOfTarget: aheadOfTarget,
    brandTrends: {
      topGainers,
      topDecliners,
      comparisonBasis,
      note: `growthPct is that principal's revenue change vs ${comparisonBasis === "mom" ? "the previous calendar month" : "the same period last year"}.`,
    },
    customerDormancy,
    syncHealth: syncHealth.map((s) => ({
      source: s.label,
      cadence: s.cadenceLabel,
      stale: s.isStale,
      lastUpdated: s.lastUpdated ? s.lastUpdated.toISOString() : null,
    })),
  };

  return { hasData: true, text: JSON.stringify(context) };
}

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string",
      description: "3-5 sentence executive digest of the most important things happening right now, in plain business language.",
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string", description: "Short headline, under 10 words." },
          detail: { type: "string", description: "One or two sentences of supporting detail." },
        },
        required: ["severity", "title", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "findings"],
  additionalProperties: false,
};

/** Generates one AI Insights digest for the given period/principal selection
 *  and persists it. Called from /api/ai-insights/generate — either the daily
 *  cron trigger (scripts/ai-insights/trigger.ts, no selection supplied,
 *  defaults to "this month to date" / all principals) or on-demand from
 *  app/api/ai-insights/route.ts when a viewer's current PeriodSelector/
 *  PrincipalSelector choice has no fresh cached digest yet. Every figure the
 *  model sees is pre-computed here; the model only writes the narrative and
 *  flags severity, never the underlying numbers. */
export async function generateAiInsights(
  selection: PeriodSelection = defaultInsightsPeriod(),
  principalKey: string | null = null
): Promise<AiInsightRecord> {
  const { hasData, text } = await buildContext(selection, principalKey);
  const cacheKey = periodCacheKey(selection, principalKey);
  const periodFields = {
    periodKind: selection.kind,
    periodYear: selection.year,
    periodMonth: selection.month ?? null,
    periodToYear: selection.toYear ?? null,
    periodToMonth: selection.toMonth ?? null,
    principalKey,
    cacheKey,
  };

  if (!hasData) {
    const record = await prisma.aiInsight.create({
      data: {
        summary: "No dataset has been uploaded yet — nothing to analyze.",
        findings: JSON.stringify([]),
        model: MODEL,
        ...periodFields,
      },
    });
    return toRecord(record);
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system:
      "You are a sales operations analyst for a Kenyan FMCG distributor. You are given pre-computed " +
      "figures only — never invent or adjust a number, only interpret the ones provided. Write in plain, " +
      "direct business language for a busy executive skimming on a phone. The context's `period` field names " +
      "the exact period you're reporting on and `principalScope` names whether it's company-wide or one " +
      "principal — always write as if describing that period/scope, never assume 'this month' or 'all " +
      "principals' if the fields say otherwise. If dormantPrincipalsExcluded is present, those principals " +
      "have already been left out of every comparison because they have no live sales activity — never " +
      "mention them or imply they were compared. Use brandTrends (real revenue growth per principal, versus " +
      "the comparison period named in comparisonBasis) to speak to how our own brands are actually trending, " +
      "and customerDormancy (outlets that just stopped buying, grouped by principal) to flag real customer " +
      "churn risk when present — both are already-computed figures, not estimates you're making.",
    messages: [
      {
        role: "user",
        content: `Here is the dashboard data for the currently selected view:\n\n${text}\n\nWrite an executive digest and list any findings worth flagging (target misses, stale data syncs, notable brand trends, customers going quiet). If everything looks healthy, say so plainly rather than manufacturing a finding.`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Claude returned no text content.");
  const parsed = JSON.parse(textBlock.text) as { summary: string; findings: AiInsightFinding[] };

  const record = await prisma.aiInsight.create({
    data: {
      summary: parsed.summary,
      findings: JSON.stringify(parsed.findings),
      model: MODEL,
      ...periodFields,
    },
  });
  return toRecord(record);
}

/** Returns the most recent digest for this exact period/principal selection,
 *  or null if none exists or the newest one is older than CACHE_FRESHNESS_MS
 *  — the caller (app/api/ai-insights/route.ts) generates a fresh one in that
 *  case rather than showing a stale mismatch. */
export async function findCachedAiInsight(selection: PeriodSelection, principalKey: string | null): Promise<AiInsightRecord | null> {
  const cacheKey = periodCacheKey(selection, principalKey);
  const record = await prisma.aiInsight.findFirst({ where: { cacheKey }, orderBy: { generatedAt: "desc" } });
  if (!record) return null;
  if (Date.now() - record.generatedAt.getTime() > CACHE_FRESHNESS_MS) return null;
  return toRecord(record);
}

export async function getLatestAiInsight(): Promise<AiInsightRecord | null> {
  const record = await prisma.aiInsight.findFirst({ orderBy: { generatedAt: "desc" } });
  return record ? toRecord(record) : null;
}

function toRecord(row: {
  id: string;
  generatedAt: Date;
  summary: string;
  findings: string;
  model: string;
  periodKind: string;
  periodYear: string;
  periodMonth: string | null;
  periodToYear: string | null;
  periodToMonth: string | null;
  principalKey: string | null;
}): AiInsightRecord {
  return {
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    summary: row.summary,
    findings: JSON.parse(row.findings) as AiInsightFinding[],
    model: row.model,
    period: {
      kind: row.periodKind as PeriodSelection["kind"],
      year: row.periodYear,
      month: row.periodMonth ?? undefined,
      toYear: row.periodToYear ?? undefined,
      toMonth: row.periodToMonth ?? undefined,
    },
    principalKey: row.principalKey,
  };
}
