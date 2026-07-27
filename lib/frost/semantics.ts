/** Centralized KPI/terminology notes for Frost's system prompt — codifies
 *  business definitions this project has already settled on (see the
 *  project's own memory of past corrections) so Frost cites the same
 *  definitions the rest of the app uses instead of re-deriving them per
 *  request. Plain text folded into the system prompt, not a runtime lookup —
 *  there's no ambiguity to resolve at request time, just a fact to state. */
export const FROST_SEMANTIC_NOTES = `
Business definitions to use consistently:
- Coverage is AVERAGED across the months in a multi-month period (e.g. QTD, YTD), never summed — a rep's period coverage is the average of their monthly coverage figures. Revenue and target figures, by contrast, ARE summed across months. Don't apply the same aggregation rule to both.
- An unresolved SKU/Cost Centre on a call does not disqualify it from counting as a call or a productive call — only the Active Outlets bridge filters by resolved Cost Centre; Coverage/Productivity/JP Adherence do not.
- The Coverage bridge and the Active Outlets bridge each classify a rep's Primary/Secondary sales role using their own, intentionally different rule — don't assume a rep's role is the same figure across both tools.
- "Dormant" or "inactive" customers means an outlet whose ActiveOutlet.status is "Inactive" (no purchase in the trailing 60+ days as of the last full sync) — this is the authoritative dormancy signal, not a fresh computation from raw dates.
- Gross Sales vs Net Sales vs Revenue: the tools already return the post-return, net figure used everywhere else in the app (summarizeSalesByPrincipal/summarizeSalesForPeriod) — do not describe a tool's "revenue" figure as gross unless the tool explicitly says so.
`.trim();
