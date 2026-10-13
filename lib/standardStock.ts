// Standard stock: how much of each SKU the business should hold, from its run rate rather than a flat rule.
//
// Run rate. The year-to-date average alone mis-marks stock whenever demand has recently changed: a SKU that stopped
// selling still looks "OK" on last year's pace, and one that had a single big order looks "Out of Stock" a week later.
// The standard run rate is the MEDIAN of three weekly run rates, each over selling days only (Sundays excluded, a new
// SKU measured from its first sale): the last 4 weeks, the last 13 weeks and the year to date. The median ignores a lone
// spike or slump in any one window and follows a real change once two windows agree on it.
//
// Cover targets. Three day-counts per principal, optionally overridden per brand (the SKU's SAP brand / series):
//   target days    the cover the business wants to hold; standard stock = standard run rate x target days
//   reorder days   below this, a SKU is Running Out (until now a flat 14 for everyone)
//   overstock days above this, a SKU is overstocked (until now a flat 60 for everyone)
// "Out of Stock" stays the flat rule: no stock at all, or less than OUT_OF_STOCK_DAYS days of cover.
// A brand's own value wins, then its principal's, then the defaults below.
import { RUNNING_OUT_DAYS } from "./stockThresholds";

/** Cover the business aims to hold when nothing more specific is set: one month. */
export const DEFAULT_TARGET_DAYS = 30;
export const DEFAULT_REORDER_DAYS = RUNNING_OUT_DAYS;
export const DEFAULT_OVERSTOCK_DAYS = 60;

export interface CoverTargetRow {
  scope: "PRINCIPAL" | "BRAND";
  /** normalizePrincipalKey of the principal, e.g. "mars". */
  principalKey: string;
  /** The SKU's brand as shown on the Stock page ("Unspecified" when it has none); empty for a principal row. */
  brand: string;
  targetDays: number | null;
  reorderDays: number | null;
  overstockDays: number | null;
}

export interface CoverThresholds {
  targetDays: number;
  reorderDays: number;
  overstockDays: number;
  /** Where the values came from: the brand's own row, its principal's row, or the defaults. */
  source: "brand" | "principal" | "default";
}

const brandKey = (brand: string | null | undefined) => (brand?.trim() || "Unspecified").toLowerCase();

/** The cover thresholds that apply to a principal (brand omitted), or to one of its brands (null = a SKU with no brand, "Unspecified"). Each value falls back brand -> principal -> default
 *  on its own, so a brand can override only its target days and still inherit the principal's reorder and overstock days. */
export function resolveCoverThresholds(rows: CoverTargetRow[] | undefined, principalKey: string, brand?: string | null): CoverThresholds {
  const principalRow = rows?.find((r) => r.scope === "PRINCIPAL" && r.principalKey === principalKey);
  const brandRow = brand === undefined ? undefined : rows?.find((r) => r.scope === "BRAND" && r.principalKey === principalKey && brandKey(r.brand) === brandKey(brand));
  const pick = (field: "targetDays" | "reorderDays" | "overstockDays", fallback: number) => brandRow?.[field] ?? principalRow?.[field] ?? fallback;
  const hasBrandValue = Boolean(brandRow && (brandRow.targetDays !== null || brandRow.reorderDays !== null || brandRow.overstockDays !== null));
  const hasPrincipalValue = Boolean(principalRow && (principalRow.targetDays !== null || principalRow.reorderDays !== null || principalRow.overstockDays !== null));
  return {
    targetDays: pick("targetDays", DEFAULT_TARGET_DAYS),
    reorderDays: pick("reorderDays", DEFAULT_REORDER_DAYS),
    overstockDays: pick("overstockDays", DEFAULT_OVERSTOCK_DAYS),
    source: hasBrandValue ? "brand" : hasPrincipalValue ? "principal" : "default",
  };
}

/** The middle of three numbers. */
export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

export interface RunRateInputs {
  /** The year-to-date weekly run rate: always present. */
  ytd: number;
  /** The last-4-weeks and last-13-weeks weekly run rates; absent when the sync did not read the recent windows. */
  last4w?: number | null;
  last13w?: number | null;
}

/** The standard weekly run rate: the median of the 4-week, 13-week and year-to-date run rates. Without the two recent
 *  windows (an older sync) it is the year-to-date rate, as before. Never negative. */
export function standardRunRate(inputs: RunRateInputs): { rate: number; basis: "standard" | "ytd" } {
  const ytd = Math.max(0, inputs.ytd);
  if (inputs.last4w === null || inputs.last4w === undefined || inputs.last13w === null || inputs.last13w === undefined) return { rate: ytd, basis: "ytd" };
  return { rate: median3(Math.max(0, inputs.last4w), Math.max(0, inputs.last13w), ytd), basis: "standard" };
}

/** The stock to hold for `targetDays` of cover at a weekly run rate (any unit: value or pieces). */
export function standardStockFor(weeklyRunRate: number, targetDays: number): number {
  return (Math.max(0, weeklyRunRate) / 7) * targetDays;
}

/** Stock held against the standard, as a percentage (100 = on standard). Null when there is no standard to compare with. */
export function stockVsStandardPct(held: number, standard: number): number | null {
  return standard > 0 ? Math.round((held / standard) * 1000) / 10 : null;
}
