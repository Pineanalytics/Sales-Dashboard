import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { getLatestSnapshot } from "../datasetStore";
import { getSyncHealth } from "../syncHealth";
import { summarizeSalesByPrincipal, summarizeCoverageByRep, summarizePLForPeriod } from "../timeIntelligence";
import { resolveKeywordPeriod, PERIOD_KEYWORDS } from "./period";
import type { PageKey } from "../pageAccess";

const PERIOD_DESCRIPTION = "mtd = this month to date, qtd = this quarter to date, ytd = year to date, last_month = the prior calendar month.";
const MAX_ROWS = 12;

/** Every tool here wraps a function lib/timeIntelligence.ts already exposes to
 *  the live dashboard pages — Frost never computes a figure itself, it only
 *  picks which pre-built summary to fetch and narrates the result. Each tool
 *  is tagged with the PageKey that gates it (see toolsForUser below), so a
 *  user only gets tools for data they'd already be allowed to see on the
 *  matching dashboard page.
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

export const salesVsTargetTool = betaTool({
  name: "get_sales_vs_target",
  description: "Revenue vs target, gross profit, and margin for the given period, either overall or for one principal.",
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
      principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal." },
    },
    required: ["period"],
    additionalProperties: false,
  },
  run: async (args) => {
    const dataset = await getLatestSnapshot();
    if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
    const selection = resolveKeywordPeriod(args.period);

    if (args.principal) {
      const byPrincipal = summarizeSalesByPrincipal(dataset, selection);
      const row = byPrincipal.get(args.principal);
      if (!row) return JSON.stringify({ error: `No principal named "${args.principal}" — call list_principals for exact names.` });
      return JSON.stringify(row);
    }

    const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, selection).values()).sort((a, b) => b.revenue - a.revenue);
    const truncated = byPrincipal.length > MAX_ROWS;
    return JSON.stringify({ principals: byPrincipal.slice(0, MAX_ROWS), truncated, totalPrincipals: byPrincipal.length });
  },
});

export const coverageByRepTool = betaTool({
  name: "get_coverage_by_rep",
  description: "Outlet coverage and productivity (call strike rate) per sales rep for the given period, optionally scoped to one principal.",
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
      principal: { type: "string", description: "Exact principal name from list_principals. Omit for coverage across every principal." },
    },
    required: ["period"],
    additionalProperties: false,
  },
  run: async (args) => {
    const dataset = await getLatestSnapshot();
    if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
    const selection = resolveKeywordPeriod(args.period);
    const rows = summarizeCoverageByRep(dataset, selection, args.principal ?? null).sort((a, b) => b.coverage - a.coverage);
    const truncated = rows.length > MAX_ROWS;
    return JSON.stringify({ reps: rows.slice(0, MAX_ROWS), truncated, totalReps: rows.length });
  },
});

export const plSummaryTool = betaTool({
  name: "get_pl_summary",
  description: "Profit & loss summary (revenue, COGS, gross/net profit, margins) for the given period, optionally scoped to one principal.",
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: PERIOD_KEYWORDS, description: PERIOD_DESCRIPTION },
      principal: { type: "string", description: "Exact principal name from list_principals. Omit for the total across every principal." },
    },
    required: ["period"],
    additionalProperties: false,
  },
  run: async (args) => {
    const dataset = await getLatestSnapshot();
    if (!dataset) return JSON.stringify({ error: "No dataset uploaded yet." });
    const selection = resolveKeywordPeriod(args.period);
    return JSON.stringify(summarizePLForPeriod(dataset, selection, args.principal ?? null));
  },
});

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
// definition site; this registry only needs to hold and filter them.
const TOOL_REGISTRY: { tool: any; requiresPage: PageKey | "admin" }[] = [
  { tool: listPrincipalsTool, requiresPage: "dashboard" },
  { tool: salesVsTargetTool, requiresPage: "sales" },
  { tool: coverageByRepTool, requiresPage: "coverage" },
  { tool: plSummaryTool, requiresPage: "profitability" },
  { tool: syncHealthTool, requiresPage: "admin" },
];

/** Scopes Frost's toolset to whatever the requesting user is already allowed
 *  to see on the live dashboard — a user without Profitability access doesn't
 *  get a P&L tool just because they can phrase a question about it. */
export function toolsForUser(allowedPages: readonly string[], isAdmin: boolean) {
  return TOOL_REGISTRY.filter((entry) => (entry.requiresPage === "admin" ? isAdmin : isAdmin || allowedPages.includes(entry.requiresPage))).map(
    (entry) => entry.tool
  );
}
