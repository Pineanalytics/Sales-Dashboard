import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { getLatestSnapshot } from "./datasetStore";
import { getSyncHealth } from "./syncHealth";
import { summarizeSalesByPrincipal, CANONICAL_MONTHS, type PeriodSelection } from "./timeIntelligence";

const MODEL = "claude-sonnet-5";

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

/** Compact, token-cheap context for the model — every figure here is already
 *  computed by lib/timeIntelligence.ts / lib/syncHealth.ts, never re-derived
 *  or estimated by the model itself. Caps principal lists at 5 each way so a
 *  large dataset doesn't blow up the prompt. */
async function buildContext(): Promise<{ hasData: boolean; text: string }> {
  const dataset = await getLatestSnapshot();
  const syncHealth = await getSyncHealth();

  const staleSyncs = syncHealth.filter((s) => s.isStale);

  if (!dataset) {
    return {
      hasData: false,
      text: JSON.stringify({ note: "No dataset uploaded yet.", syncHealth: syncHealth.map((s) => ({ source: s.label, stale: s.isStale })) }),
    };
  }

  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, currentMonthPeriod()).values()).filter(
    (p) => p.target !== null && p.target > 0
  );
  const sorted = [...byPrincipal].sort((a, b) => (a.achievementPct ?? 0) - (b.achievementPct ?? 0));
  const behindTarget = sorted.slice(0, 5).map((p) => ({
    principal: p.principal,
    revenue: Math.round(p.revenue),
    target: Math.round(p.target ?? 0),
    achievementPct: p.achievementPct,
  }));
  const aheadOfTarget = sorted
    .slice(-5)
    .reverse()
    .map((p) => ({
      principal: p.principal,
      revenue: Math.round(p.revenue),
      target: Math.round(p.target ?? 0),
      achievementPct: p.achievementPct,
    }));

  const context = {
    period: "current month to date",
    reportTitle: dataset.reportMeta.title,
    principalsWithTarget: byPrincipal.length,
    mostBehindTarget: behindTarget,
    mostAheadOfTarget: aheadOfTarget,
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
      "direct business language for a busy executive skimming on a phone.",
    messages: [
      {
        role: "user",
        content: `Here is today's dashboard data:\n\n${text}\n\nWrite an executive digest and list any findings worth flagging (target misses, stale data syncs, notable performance). If everything looks healthy, say so plainly rather than manufacturing a finding.`,
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
