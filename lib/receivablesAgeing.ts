// Ageing-bucket snapshot helpers for the Finance module's "Ageing Trend" tab.
// A snapshot is written going forward on every real receivables sync (see
// app/api/receivables/upload/route.ts). Every other past week/month boundary
// is kept filled in by scripts/db-bridge/receivables/backfill-ageing.ts, which
// reconstructs the true historical position by replaying SAP's own
// payment-reconciliation history (OITR/ITR1) against every customer ledger
// line — not an approximation from items still open today. isApproximate is
// kept on the model only as a defensive fallback marker; nothing sets it true
// anymore.
import { prisma } from "@/lib/db";
import { getWeeksInMonth } from "@/lib/weeklyTargets";

export interface AgeingBuckets {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  daysOver90: number;
}

const EMPTY_BUCKETS: AgeingBuckets = { current: 0, days30: 0, days60: 0, days90: 0, daysOver90: 0 };

/** Pure bucket assignment matching the guideline's own 30/60/90/over-90
 *  wording (distinct from lib/receivables.ts's "1–30 days" style labels used
 *  by the pre-existing Receivables & Ageing tab, left as-is). */
export function computeAgeingBuckets(items: { dueDate: Date; openBalance: number }[], asOf: Date): AgeingBuckets {
  const buckets: AgeingBuckets = { ...EMPTY_BUCKETS };
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  for (const item of items) {
    const dueDay = Date.UTC(item.dueDate.getUTCFullYear(), item.dueDate.getUTCMonth(), item.dueDate.getUTCDate());
    const daysPastDue = Math.floor((asOfDay - dueDay) / 86_400_000);
    if (daysPastDue <= 0) buckets.current += item.openBalance;
    else if (daysPastDue <= 30) buckets.days30 += item.openBalance;
    else if (daysPastDue <= 60) buckets.days60 += item.openBalance;
    else if (daysPastDue <= 90) buckets.days90 += item.openBalance;
    else buckets.daysOver90 += item.openBalance;
  }
  return buckets;
}

/** Upserts today's real snapshot — called from inside the receivables sync's
 *  own transaction so it never runs against a partially-replaced ledger. */
export async function upsertAgeingSnapshot(
  tx: { receivablesAgeingSnapshot: { upsert: typeof prisma.receivablesAgeingSnapshot.upsert } },
  snapshotDate: Date,
  items: { dueDate: Date; openBalance: number }[],
  isApproximate: boolean
): Promise<void> {
  const buckets = computeAgeingBuckets(items, snapshotDate);
  const day = new Date(Date.UTC(snapshotDate.getUTCFullYear(), snapshotDate.getUTCMonth(), snapshotDate.getUTCDate()));
  await tx.receivablesAgeingSnapshot.upsert({
    where: { snapshotDate: day },
    create: { snapshotDate: day, ...buckets, isApproximate },
    update: { ...buckets, isApproximate },
  });
}

export interface AgeingSnapshotPoint {
  label: string;
  /** The calendar date this point represents (last-month-end, or a week's Sunday-start+6). */
  asOfDate: string;
  /** The actual snapshot row used (nearest one at-or-before asOfDate), or null if none exists yet. */
  snapshotDate: string | null;
  buckets: AgeingBuckets | null;
  isApproximate: boolean;
}

export interface AgeingTrendForMonth {
  lastMonth: AgeingSnapshotPoint;
  weeks: AgeingSnapshotPoint[];
}

/** Reads the nearest snapshot at-or-before each of: last calendar month's
 *  last day, and every calendar week (Sunday-start, per getWeeksInMonth's own
 *  convention) in the selected month — auto-adjusting to however many weeks
 *  the selected month actually has. A week still in progress (or entirely in
 *  the future) has no snapshot yet and comes back with buckets: null. */
export async function getAgeingSnapshotForMonth(
  year: number,
  monthIndex: number,
  options: { blankWeeksNotElapsed?: boolean } = {}
): Promise<AgeingTrendForMonth> {
  const lastMonthEnd = new Date(Date.UTC(year, monthIndex, 0));
  const weeks = getWeeksInMonth(year, monthIndex);
  const todayStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const weekPoints = weeks.map((w, i) => {
    const weekEnd = w.weekStartDate.getTime() + 6 * 86_400_000;
    return {
      label: i === weeks.length - 1 ? `${w.weekLabel} (final)` : w.weekLabel,
      asOfDate: new Date(Math.min(weekEnd, Date.now())),
      // Opt-in: a week that has not finished yet has no closing position, so it is left blank
      // instead of repeating the latest snapshot.
      blank: options.blankWeeksNotElapsed === true && weekEnd >= todayStart,
    };
  });

  const latestNeeded = new Date(Math.max(lastMonthEnd.getTime(), ...weekPoints.map((p) => p.asOfDate.getTime())));
  const rows = await prisma.receivablesAgeingSnapshot.findMany({
    where: { snapshotDate: { lte: latestNeeded } },
    orderBy: { snapshotDate: "asc" },
  });

  function nearestAtOrBefore(target: Date) {
    let match: (typeof rows)[number] | null = null;
    for (const row of rows) {
      if (row.snapshotDate.getTime() <= target.getTime()) match = row;
      else break;
    }
    return match;
  }

  function toPoint(label: string, asOfDate: Date): AgeingSnapshotPoint {
    const row = nearestAtOrBefore(asOfDate);
    return {
      label,
      asOfDate: asOfDate.toISOString(),
      snapshotDate: row?.snapshotDate.toISOString() ?? null,
      buckets: row
        ? { current: row.current, days30: row.days30, days60: row.days60, days90: row.days90, daysOver90: row.daysOver90 }
        : null,
      isApproximate: row?.isApproximate ?? false,
    };
  }

  return {
    lastMonth: toPoint("Last Month Ageing", lastMonthEnd),
    weeks: weekPoints.map((p) =>
      p.blank ? { label: p.label, asOfDate: p.asOfDate.toISOString(), snapshotDate: null, buckets: null, isApproximate: false } : toPoint(p.label, p.asOfDate)
    ),
  };
}
