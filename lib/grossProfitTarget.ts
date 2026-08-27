import type { Dataset } from "./types";
import { resolvePeriodMonths, type PeriodSelection } from "./timeIntelligence";

// Business-owned GP target policy. The current production hierarchy identifies
// EFL and Energia as the BDM portfolio; keep the list explicit until Principal
// master data gains a durable portfolio/category field.
const BDM_PRINCIPALS = new Set(["efl-nairobi", "energia-nairobi"]);

export function grossProfitTargetRate(principal: string): number {
  const key = principal.trim().toLowerCase();
  if (key === "mars-nairobi") return 0.15;
  if (BDM_PRINCIPALS.has(key)) return 0.2;
  return 0.1;
}

/** Sum each principal's revenue target at its own GP target rate. Applying the
 * rate before aggregation is essential for All Principals, where 10%, 15% and
 * 20% policies can coexist in the same month. */
export function grossProfitTargetForPeriod(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): number | null {
  const monthKeys = new Set(resolvePeriodMonths(selection).map(({ year, monthIndex }) => `${year}|${monthIndex}`));
  const rows = dataset.monthlySales.filter(
    (row) => monthKeys.has(`${row.year}|${row.monthIndex}`) && (!principalKey || row.principal === principalKey) && row.target !== null
  );
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + row.target! * grossProfitTargetRate(row.principal), 0);
}
