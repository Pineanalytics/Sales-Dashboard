// Pure rules for the Finance Presentation slides: GP margin targets, the period the
// slides follow, and the cost-level weekly run rate / days cover. Kept free of React
// and I/O so each rule is unit-tested.
import { normalizePrincipalKey } from "@/lib/normalize";
import { CANONICAL_MONTHS, resolvePeriodMonths, type PeriodSelection } from "@/lib/timeIntelligence";

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// GP margin targets
// ---------------------------------------------------------------------------

/** Gross-margin targets in percent: one per principal brand, and the default every other brand carries. */
export interface GpMarginTargets {
  byBrand: Record<string, number>;
  defaultPct: number;
}

/** The policy starting point: Mars 15%, EABL 6%, Suntory 7%, Upfield 10%, Weetabix 10%, every other brand 10%.
 *  Admins change these on /admin/gp-targets; what they save overrides this. These replace the flat 10%
 *  placeholder that was stored for every principal in the monthly Target table, which made the company
 *  target a meaningless 10% and the "vs Target" tile show the actual margin. */
export const DEFAULT_GP_MARGIN_TARGETS: GpMarginTargets = {
  byBrand: { mars: 15, eabl: 6, suntory: 7, upfield: 10, weetabix: 10 },
  defaultPct: 10,
};

/** The brand key under which the "all other brands" default is stored. */
export const GP_MARGIN_DEFAULT_KEY = "__default__";

/** Lays saved targets over the policy defaults; a saved row wins, anything not saved keeps its default. */
export function mergeGpMarginTargets(saved: { brandKey: string; targetPct: number }[]): GpMarginTargets {
  const merged: GpMarginTargets = { byBrand: { ...DEFAULT_GP_MARGIN_TARGETS.byBrand }, defaultPct: DEFAULT_GP_MARGIN_TARGETS.defaultPct };
  for (const row of saved) {
    if (!Number.isFinite(row.targetPct)) continue;
    if (row.brandKey === GP_MARGIN_DEFAULT_KEY) merged.defaultPct = row.targetPct;
    else merged.byBrand[row.brandKey] = row.targetPct;
  }
  return merged;
}

/** The target margin (percent) for a principal given as "Mars-Nairobi", "Mars" or any spelling the brand key reduces to. */
export function gpMarginTargetPct(principal: string, targets: GpMarginTargets = DEFAULT_GP_MARGIN_TARGETS): number {
  return targets.byBrand[normalizePrincipalKey(principal)] ?? targets.defaultPct;
}

/** One line for a heading: the five main brands in order, any other brand with its own target, then "all others". */
export function describeGpMarginTargets(targets: GpMarginTargets): string {
  const main = ["mars", "eabl", "suntory", "upfield", "weetabix"];
  const label = (key: string) => (key === "eabl" ? "EABL" : key.charAt(0).toUpperCase() + key.slice(1));
  const extras = Object.keys(targets.byBrand)
    .filter((key) => !main.includes(key) && targets.byBrand[key] !== targets.defaultPct)
    .sort();
  const parts = [...main, ...extras].map((key) => `${label(key)} ${targets.byBrand[key] ?? targets.defaultPct}%`);
  return `${parts.join(", ")}, all others ${targets.defaultPct}%`;
}

export interface PrincipalSalesInput {
  principal: string;
  revenue: number;
  /** Revenue target for the period, or null when none is set. */
  target: number | null;
  grossProfit: number;
}

export interface GpTargetRow {
  /** Brand label, e.g. "Mars" (locations of one brand are combined). */
  label: string;
  revenue: number;
  revenueTarget: number | null;
  marginTargetPct: number;
  marginPct: number | null;
  /** Actual margin minus target margin, in percentage points. */
  variancePp: number | null;
  grossProfit: number;
  /** Revenue target x target margin, or null when the principal has no revenue target. */
  gpTarget: number | null;
  /** GP achieved as a percentage of the GP target, or null without a GP target. */
  gpAchievementPct: number | null;
  /** True when the actual margin is at or above the target margin. (GP achieved % tracks the revenue sold so far; this does not.) */
  achieved: boolean | null;
}

export interface GpTargetSummary {
  rows: GpTargetRow[];
  total: Omit<GpTargetRow, "label" | "marginTargetPct"> & { marginTargetPct: number | null };
}

const TOP_BRANDS = ["mars", "suntory", "upfield", "eabl", "weetabix"];

export function brandLabel(principal: string): string {
  const head = principal.split("-")[0].trim();
  // Brands spelled in capitals (EABL) keep them; the rest are shown as they are named in the data.
  return normalizePrincipalKey(head) === "eabl" ? "EABL" : head.charAt(0).toUpperCase() + head.slice(1);
}

/** One row per principal brand (locations combined), the five main brands first, then the rest by revenue.
 *  The total's target margin is the revenue-target-weighted average, so it equals total GP target / total revenue target. */
export function buildGpTargetSummary(principals: PrincipalSalesInput[], targets: GpMarginTargets = DEFAULT_GP_MARGIN_TARGETS): GpTargetSummary {
  const byBrand = new Map<string, { label: string; revenue: number; target: number; hasTarget: boolean; gp: number }>();
  for (const p of principals) {
    const key = normalizePrincipalKey(p.principal);
    const entry = byBrand.get(key) ?? { label: brandLabel(p.principal), revenue: 0, target: 0, hasTarget: false, gp: 0 };
    entry.revenue += p.revenue;
    entry.gp += p.grossProfit;
    if (p.target !== null) {
      entry.target += p.target;
      entry.hasTarget = true;
    }
    byBrand.set(key, entry);
  }

  const rows: GpTargetRow[] = Array.from(byBrand.entries()).map(([key, e]) => {
    const marginTargetPct = gpMarginTargetPct(key, targets);
    const marginPct = e.revenue > 0 ? round1((e.gp / e.revenue) * 100) : null;
    const gpTarget = e.hasTarget ? (e.target * marginTargetPct) / 100 : null;
    const gpAchievementPct = gpTarget !== null && gpTarget > 0 ? round1((e.gp / gpTarget) * 100) : null;
    const variancePp = marginPct === null ? null : round1(marginPct - marginTargetPct);
    return {
      label: e.label,
      revenue: e.revenue,
      revenueTarget: e.hasTarget ? e.target : null,
      marginTargetPct,
      marginPct,
      variancePp,
      grossProfit: e.gp,
      gpTarget,
      gpAchievementPct,
      achieved: variancePp === null ? null : variancePp >= 0,
    };
  });

  const rank = (label: string) => {
    const i = TOP_BRANDS.indexOf(normalizePrincipalKey(label));
    return i === -1 ? TOP_BRANDS.length : i;
  };
  rows.sort((a, b) => rank(a.label) - rank(b.label) || b.revenue - a.revenue);

  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const grossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
  const withTarget = rows.filter((r) => r.revenueTarget !== null);
  const revenueTarget = withTarget.length > 0 ? withTarget.reduce((s, r) => s + (r.revenueTarget ?? 0), 0) : null;
  const gpTarget = withTarget.length > 0 ? withTarget.reduce((s, r) => s + (r.gpTarget ?? 0), 0) : null;
  // Target margin: weight by the revenue target when there is one, otherwise by actual revenue.
  const weightedMargin =
    revenueTarget !== null && revenueTarget > 0 && gpTarget !== null
      ? (gpTarget / revenueTarget) * 100
      : revenue > 0
        ? rows.reduce((s, r) => s + r.marginTargetPct * r.revenue, 0) / revenue
        : null;
  const marginPct = revenue > 0 ? round1((grossProfit / revenue) * 100) : null;
  const marginTargetPct = weightedMargin === null ? null : round1(weightedMargin);
  const gpAchievementPct = gpTarget !== null && gpTarget > 0 ? round1((grossProfit / gpTarget) * 100) : null;
  const variancePp = marginPct !== null && marginTargetPct !== null ? round1(marginPct - marginTargetPct) : null;

  return {
    rows,
    total: {
      revenue,
      revenueTarget,
      marginTargetPct,
      marginPct,
      variancePp,
      grossProfit,
      gpTarget,
      gpAchievementPct,
      achieved: variancePp === null ? null : variancePp >= 0,
    },
  };
}

/** Actual margin as a share of the target margin (a 8.2% actual against a 10% target is 82%). */
export function marginAchievementPct(marginPct: number | null, targetPct: number | null): number | null {
  if (marginPct === null || targetPct === null || targetPct <= 0) return null;
  return round1((marginPct / targetPct) * 100);
}

// ---------------------------------------------------------------------------
// The period the slides follow
// ---------------------------------------------------------------------------

export interface MonthRef {
  year: number;
  monthIndex: number;
}

/** The last month the selected period covers: the month the slides' balances are "as at". */
export function periodEndMonth(period: PeriodSelection): MonthRef | null {
  const months = resolvePeriodMonths(period);
  if (months.length === 0) return null;
  const last = months.reduce((best, m) => (Number(m.year) * 12 + m.monthIndex > Number(best.year) * 12 + best.monthIndex ? m : best));
  return { year: Number(last.year), monthIndex: last.monthIndex };
}

/** Today's calendar date in Nairobi, so every viewer's "days elapsed" agrees (same convention as the MTD target pacing). */
export function nairobiToday(now: Date = new Date()): { year: number; monthIndex: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), monthIndex: get("month") - 1, day: get("day") };
}

export function previousMonth(ref: MonthRef): MonthRef {
  return ref.monthIndex === 0 ? { year: ref.year - 1, monthIndex: 11 } : { year: ref.year, monthIndex: ref.monthIndex - 1 };
}

export function isSameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.monthIndex === b.monthIndex;
}

/** Calendar days of the period that have actually happened: whole past months, today's date for the current month, nothing for future months. */
export function periodElapsedDays(period: PeriodSelection, today: { year: number; monthIndex: number; day: number }): number {
  let days = 0;
  for (const m of resolvePeriodMonths(period)) {
    const year = Number(m.year);
    const key = year * 12 + m.monthIndex;
    const todayKey = today.year * 12 + today.monthIndex;
    const monthDays = new Date(Date.UTC(year, m.monthIndex + 1, 0)).getUTCDate();
    if (key < todayKey) days += monthDays;
    else if (key === todayKey) days += Math.min(Math.max(today.day, 0), monthDays);
  }
  return days;
}

/** Short human label for the selected period, e.g. "MTD October 2026", "Q3 2026", "YTD September 2026". */
export function describePeriod(period: PeriodSelection): string {
  const month = period.month ?? "";
  switch (period.kind) {
    case "MTD":
      return `MTD ${month} ${period.year}`;
    case "MONTH":
      return `${month} ${period.year}`;
    case "QTD":
      return `QTD to ${month} ${period.year}`;
    case "YTD":
      return `YTD to ${month} ${period.year}`;
    case "CUSTOM":
      return period.toMonth ? `${month} ${period.year} – ${period.toMonth} ${period.toYear ?? period.year}` : `${month} ${period.year}`;
    default:
      return `${period.kind} ${period.year}`;
  }
}

export function monthName(ref: MonthRef): string {
  return CANONICAL_MONTHS[ref.monthIndex] ?? "";
}

// ---------------------------------------------------------------------------
// Cost-level run rate and days cover
// ---------------------------------------------------------------------------

/** Fewer elapsed days than this and the period is too short to give a steady run rate. */
export const RUN_RATE_MIN_DAYS = 28;

/** Which cost of sales a weekly run rate is measured over. Early in a month only a few days have posted
 *  and the pace swings widely, so when fewer than RUN_RATE_MIN_DAYS of the period have elapsed the month
 *  before the period's first month is included as well. */
export function runRateWindow(elapsedDays: number, firstMonth: MonthRef): { usePrior: boolean; prior: MonthRef; priorDays: number; windowDays: number } {
  const prior = previousMonth(firstMonth);
  const usePrior = elapsedDays < RUN_RATE_MIN_DAYS;
  const priorDays = new Date(Date.UTC(prior.year, prior.monthIndex + 1, 0)).getUTCDate();
  return { usePrior, prior, priorDays, windowDays: usePrior ? elapsedDays + priorDays : elapsedDays };
}

/** Weekly run rate at COST: the period's cost of sales spread over the weeks that have elapsed. Null with no elapsed days. */
export function weeklyRunRateAtCost(cogs: number, elapsedDays: number): number | null {
  if (!Number.isFinite(cogs) || elapsedDays <= 0) return null;
  return cogs / (elapsedDays / 7);
}

/** Days of cover: stock (valued at cost) over the weekly cost run rate, in days. Null when there is no cost run rate to divide by. */
export function daysCoverAtCost(stockValue: number, weeklyCostRunRate: number | null): number | null {
  if (weeklyCostRunRate === null || weeklyCostRunRate <= 0) return null;
  return round1((stockValue / weeklyCostRunRate) * 7);
}
