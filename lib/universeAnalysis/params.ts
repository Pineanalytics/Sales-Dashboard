// Request parameters of the universe analysis, read the same way by the JSON route, the CSV downloads and the Excel export.
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "./config";
import { DIMENSIONS, type DimensionName, type Filters } from "./metrics";
import type { TargetAction } from "./opportunities";
import type { SectionName, SectionParams } from "./service";

export const SECTIONS: SectionName[] = ["overview", "strike", "universe", "scorecards", "opportunities", "targets", "duplicates", "quality", "filters", "outlets"];
const ACTIONS: TargetAction[] = ["Convert to direct", "Win back (lapsing)", "Fix strike rate", "Cross-sell"];
const NUMERIC_ASSUMPTIONS: (keyof Assumptions)[] = ["distributorToDirect", "crossSell", "frequencyRecovery", "lapsingWinback", "unproductiveCallConversion"];

/** "2026-09" or a month index 0..11. */
export function parseMonth(value: string | null): number | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})$/.exec(value);
  const index = iso ? Number(iso[2]) - 1 : Number(value);
  return Number.isInteger(index) && index >= 0 && index <= 11 ? index : null;
}

export function parseAnalysisParams(params: URLSearchParams): { section: SectionName; month: number | null; section_params: SectionParams } {
  const section = (SECTIONS as string[]).includes(params.get("section") ?? "") ? (params.get("section") as SectionName) : "overview";
  const filters: Filters = {};
  for (const dim of Object.keys(DIMENSIONS) as DimensionName[]) {
    const values = params.getAll(dim).filter((v) => v !== "" && v !== "All");
    if (values.length) filters[dim] = values;
  }
  const assumptions: Partial<Assumptions> = {};
  for (const key of NUMERIC_ASSUMPTIONS) {
    const raw = params.get(key);
    const value = raw === null ? NaN : Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 1) (assumptions as Record<string, number>)[key] = value;
  }
  const action = ACTIONS.find((a) => a === params.get("action")) ?? null;
  const limit = Math.min(200_000, Math.max(1, Number(params.get("limit")) || (section === "duplicates" ? 500 : 300)));
  return {
    section,
    month: parseMonth(params.get("month")),
    section_params: { filters, assumptions: { ...DEFAULT_ASSUMPTIONS, ...assumptions }, action, status: params.get("status") === "review" ? "review" : "merged", limit },
  };
}
