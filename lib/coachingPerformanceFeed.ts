// Per-rep performance for the Coaching application's bridge feed
// (app/api/integrations/coaching/reference?resource=performance).
//
// What this shares, and what it deliberately does not: Team Leaders coach on how a rep is
// doing, so the feed carries ratios and counts (attainment %, cases, calls, strike rate,
// days worked). It never carries currency amounts or target values; those stay inside this
// application, as the bridge's header comment promises.
//
// Everything is derived from live facts already held here (SalesRepActual, RepCall,
// DailyTarget); nothing is entered by hand for this feed.

export interface RepSalesFact {
  employeeCode: string;
  cases: number;
  revenue: number;
}

export interface RepCallFact {
  employeeCode: string;
  callsMade: number;
  productiveCalls: number;
  daysWorked: number;
}

export interface RepTargetFact {
  employeeCode: string;
  /** Target for the whole month. */
  monthTarget: number;
  /** Target for the days up to and including the as-of date. */
  targetToDate: number;
}

/** One rep's performance for one month. Percentages are 0-100 and rounded to one decimal; null = not measurable. */
export interface RepPerformanceRow {
  employeeCode: string;
  period: string; // "2026-10"
  asOf: string; // "2026-10-14": the last day included
  volumeCases: number | null;
  /** Revenue so far against the target for the days so far (100 = exactly on pace). */
  revenueVsPacePct: number | null;
  /** Revenue so far against the whole month's target. */
  revenueVsMonthPct: number | null;
  callsMade: number;
  productiveCalls: number;
  /** Productive calls as a share of calls made. */
  strikeRatePct: number | null;
  daysWorked: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const pct = (numerator: number, denominator: number): number | null => (denominator > 0 ? round1((numerator / denominator) * 100) : null);

export function shapeRepPerformance(input: {
  period: string;
  asOf: string;
  employeeCodes: Set<string>;
  sales: RepSalesFact[];
  calls: RepCallFact[];
  targets: RepTargetFact[];
}): RepPerformanceRow[] {
  const { period, asOf, employeeCodes } = input;
  const sales = new Map(input.sales.map((s) => [s.employeeCode, s]));
  const calls = new Map(input.calls.map((c) => [c.employeeCode, c]));
  const targets = new Map(input.targets.map((t) => [t.employeeCode, t]));

  const codes = new Set<string>([...sales.keys(), ...calls.keys(), ...targets.keys()]);
  const rows: RepPerformanceRow[] = [];
  for (const employeeCode of [...codes].sort()) {
    if (!employeeCodes.has(employeeCode)) continue; // only people on the active roster
    const s = sales.get(employeeCode);
    const c = calls.get(employeeCode);
    const t = targets.get(employeeCode);
    const callsMade = c?.callsMade ?? 0;
    const productiveCalls = c?.productiveCalls ?? 0;
    // A rep with a target but no activity yet still gets a row: "0% of pace" is information.
    rows.push({
      employeeCode,
      period,
      asOf,
      volumeCases: s ? round1(s.cases) : null,
      revenueVsPacePct: s && t ? pct(s.revenue, t.targetToDate) : t && t.targetToDate > 0 ? 0 : null,
      revenueVsMonthPct: s && t ? pct(s.revenue, t.monthTarget) : t && t.monthTarget > 0 ? 0 : null,
      callsMade,
      productiveCalls,
      strikeRatePct: pct(productiveCalls, callsMade),
      daysWorked: c?.daysWorked ?? 0,
    });
  }
  return rows;
}

/** The month containing `now` and the `count - 1` before it, newest first, e.g. ["2026-10", "2026-09"]. */
export function recentPeriods(now: Date, count: number): string[] {
  const periods: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}

/** The last day of the period that the data can include: today for the current month, the month's end for a past one. */
export function asOfDate(period: string, now: Date): string {
  const [year, month] = period.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)); // day 0 of the next month = last day of this one
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return (today < monthEnd ? today : monthEnd).toISOString().slice(0, 10);
}
