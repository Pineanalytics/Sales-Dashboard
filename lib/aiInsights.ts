import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { getLatestSnapshot } from "./datasetStore";
import { getSyncHealth } from "./syncHealth";
import { summarizeSalesByPrincipal, getPreviousMonthPeriod, CANONICAL_MONTHS, type PeriodSelection } from "./timeIntelligence";
import { normalizePrincipalKey } from "./normalize";

const MODEL = "claude-sonnet-5";

// Mirrors app/api/active-outlets/upload/route.ts's own STALE_AFTER_DAYS — an
// outlet with no purchase in this many days is swept to "Inactive" by the
// Active Outlets bridge. Kept in sync manually since the two live in
// different sync pipelines with no shared constant today.
const OUTLET_STALE_AFTER_DAYS = 60;
const NEWLY_DORMANT_WINDOW_DAYS = 30;

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
}

function currentMonthPeriod(): PeriodSelection {
  const now = new Date();
  return { kind: "MTD", year: String(now.getFullYear()), month: CANONICAL_MONTHS[now.getMonth()] };
}

/** A principal counts as dormant when it has zero revenue across the trailing
 *  3 calendar months (including the current one) — e.g. a principal like
 *  Promasidor/Bic with no live sales activity but a stale target row still on
 *  file. Comparing a flat line against target is noise, not a finding, so
 *  these get excluded from every Insights comparison below rather than
 *  commented on. */
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
 *  noise, since there's nothing left to lose there. */
async function buildCustomerDormancySignal(dormantBrandKeys: Set<string>): Promise<CustomerDormancySignal | null> {
  const year = String(new Date().getFullYear());
  const now = Date.now();
  const windowStart = new Date(now - (OUTLET_STALE_AFTER_DAYS + NEWLY_DORMANT_WINDOW_DAYS) * 86400000);
  const windowEnd = new Date(now - OUTLET_STALE_AFTER_DAYS * 86400000);

  const rows = await prisma.activeOutlet.findMany({
    where: { year, status: "Inactive", lastPurchaseDate: { gte: windowStart, lte: windowEnd } },
    select: { principal: true, sales: true },
  });
  if (rows.length === 0) return null;

  const byPrincipal = new Map<string, { principal: string; count: number; lostSalesValue: number }>();
  for (const r of rows) {
    if (dormantBrandKeys.has(normalizePrincipalKey(r.principal))) continue;
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
 *  prompt. */
async function buildContext(): Promise<{ hasData: boolean; text: string }> {
  const dataset = await getLatestSnapshot();
  const syncHealth = await getSyncHealth();

  if (!dataset) {
    return {
      hasData: false,
      text: JSON.stringify({ note: "No dataset uploaded yet.", syncHealth: syncHealth.map((s) => ({ source: s.label, stale: s.isStale })) }),
    };
  }

  const currentPeriod = currentMonthPeriod();
  const previousPeriod = getPreviousMonthPeriod(currentPeriod);

  const trailingByPrincipal = summarizeSalesByPrincipal(dataset, trailingThreeMonthsSelection(currentPeriod));
  const dormantPrincipals = new Set(
    Array.from(trailingByPrincipal.values())
      .filter((p) => p.revenue <= 0)
      .map((p) => p.principal)
  );
  const dormantBrandKeys = new Set(Array.from(dormantPrincipals).map(normalizePrincipalKey));

  const currentByPrincipal = summarizeSalesByPrincipal(dataset, currentPeriod);
  const previousByPrincipal = previousPeriod ? summarizeSalesByPrincipal(dataset, previousPeriod) : null;

  function momGrowthPct(principal: string, currentRevenue: number): number | null {
    const prev = previousByPrincipal?.get(principal);
    if (!prev || prev.revenue <= 0) return null;
    return Math.round(((currentRevenue - prev.revenue) / prev.revenue) * 1000) / 10;
  }

  const activePrincipals = Array.from(currentByPrincipal.values()).filter((p) => !dormantPrincipals.has(p.principal));
  const withTarget = activePrincipals.filter((p) => p.target !== null && p.target > 0);

  const sorted = [...withTarget].sort((a, b) => (a.achievementPct ?? 0) - (b.achievementPct ?? 0));
  const behindTarget = sorted.slice(0, 5).map((p) => ({
    principal: p.principal,
    revenue: Math.round(p.revenue),
    target: Math.round(p.target ?? 0),
    achievementPct: p.achievementPct,
    momGrowthPct: momGrowthPct(p.principal, p.revenue),
  }));
  const aheadOfTarget = sorted
    .slice(-5)
    .reverse()
    .map((p) => ({
      principal: p.principal,
      revenue: Math.round(p.revenue),
      target: Math.round(p.target ?? 0),
      achievementPct: p.achievementPct,
      momGrowthPct: momGrowthPct(p.principal, p.revenue),
    }));

  // Own-brand trend: top gainers/decliners by MoM %, independent of whether a
  // target is on file — month-over-month revenue is a real, comparable
  // figure even for a principal without a configured target.
  const trended = activePrincipals
    .map((p) => ({ principal: p.principal, revenue: Math.round(p.revenue), momGrowthPct: momGrowthPct(p.principal, p.revenue) }))
    .filter((p): p is { principal: string; revenue: number; momGrowthPct: number } => p.momGrowthPct !== null);
  const byGrowth = [...trended].sort((a, b) => b.momGrowthPct - a.momGrowthPct);
  const topGainers = byGrowth.slice(0, 3);
  const topDecliners = byGrowth
    .slice(-3)
    .reverse()
    .filter((p) => !topGainers.includes(p));

  const customerDormancy = await buildCustomerDormancySignal(dormantBrandKeys);

  const context = {
    period: "current month to date",
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
      note: "momGrowthPct is that principal's own month-over-month revenue growth.",
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

/** Generates one AI Insights digest from current Sales-vs-Target and Sync
 *  Health data and persists it. Called from /api/ai-insights/generate, itself
 *  triggered daily by scripts/ai-insights-sync.ps1 (Task Scheduler) — same
 *  headless-trigger pattern as the other scheduled syncs. Every figure the
 *  model sees is pre-computed here; the model only writes the narrative and
 *  flags severity, never the underlying numbers. */
export async function generateAiInsights(): Promise<AiInsightRecord> {
  const { hasData, text } = await buildContext();

  if (!hasData) {
    const record = await prisma.aiInsight.create({
      data: {
        summary: "No dataset has been uploaded yet — nothing to analyze.",
        findings: JSON.stringify([]),
        model: MODEL,
      },
    });
    return toRecord(record);
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You are a sales operations analyst for a Kenyan FMCG distributor. You are given pre-computed " +
      "figures only — never invent or adjust a number, only interpret the ones provided. Write in plain, " +
      "direct business language for a busy executive skimming on a phone. If dormantPrincipalsExcluded is " +
      "present, those principals have already been left out of every comparison because they have no live " +
      "sales activity — never mention them or imply they were compared. Use brandTrends (real month-over-month " +
      "revenue growth per principal) to speak to how our own brands are actually trending, and customerDormancy " +
      "(outlets that just stopped buying, grouped by principal) to flag real customer churn risk when present — " +
      "both are already-computed figures, not estimates you're making.",
    messages: [
      {
        role: "user",
        content: `Here is today's dashboard data:\n\n${text}\n\nWrite an executive digest and list any findings worth flagging (target misses, stale data syncs, notable brand trends, customers going quiet). If everything looks healthy, say so plainly rather than manufacturing a finding.`,
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
    },
  });
  return toRecord(record);
}

export async function getLatestAiInsight(): Promise<AiInsightRecord | null> {
  const record = await prisma.aiInsight.findFirst({ orderBy: { generatedAt: "desc" } });
  return record ? toRecord(record) : null;
}

function toRecord(row: { id: string; generatedAt: Date; summary: string; findings: string; model: string }): AiInsightRecord {
  return {
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    summary: row.summary,
    findings: JSON.parse(row.findings) as AiInsightFinding[],
    model: row.model,
  };
}
