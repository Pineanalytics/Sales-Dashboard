// "Time in Trade" consolidates average start/close time, productivity, and
// incremental (new) outlet visits across the four separate call/visit-timing
// sources that back the Timestamps modules — Pine (RepCall), EABL (EablCall),
// Upfield (UpfieldTransaction) and Unilever/Leverage (PjpDsrDailyActivity).
// Each source has its own schema and its own wall-clock storage convention
// (see the per-query comments below), so there is one query pair per source
// rather than a single shared one — this mirrors how Timestamps' own hub
// keeps the four systems as separate pages rather than one shared query.
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { CANONICAL_MONTHS, resolvePeriodMonths, type PeriodSelection } from "./timeIntelligence";
import { getWeeksInMonth } from "./weeklyTargets";
import { nairobiMinutesAfterMidnight, averageMinutes } from "./timeManagement";

export type TimeInTradeSource = "pine" | "eabl" | "upfield" | "unilever";

export const TIME_IN_TRADE_SOURCES: TimeInTradeSource[] = ["pine", "eabl", "upfield", "unilever"];

export const TIME_IN_TRADE_SOURCE_LABELS: Record<TimeInTradeSource, string> = {
  pine: "Pine (SalesEdge)",
  eabl: "EABL",
  upfield: "Upfield (DataEdge)",
  unilever: "Unilever (Leverage)",
};

export interface TimeInTradeBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

export interface TimeInTradeRow {
  source: TimeInTradeSource;
  sourceLabel: string;
  bucketKey: string;
  bucketLabel: string;
  repDays: number;
  visits: number;
  productiveVisits: number | null;
  productivityPct: number | null;
  avgStartTime: string | null;
  avgCloseTime: string | null;
  avgHoursInTrade: number | null;
  /** New (not-previously-seen-in-the-prior-bucket) outlets — null when the
   *  source has no outlet-level identity to track (Unilever's PjpDsrDailyActivity
   *  is pre-aggregated to a transaction/outlet COUNT with no outlet id) or when
   *  this is the trend's first bucket (no prior bucket to compare against). */
  newOutlets: number | null;
}

// Upfield's DataEdge txnDate is a true UTC instant; Pine/EABL/Unilever's
// equivalents are already Nairobi wall-clock stored in UTC-shaped columns
// (see lib/timeManagement.ts's nairobiMinutesAfterMidnight doc comment) — only
// Upfield needs this shift, matching /api/upfield-timestamps/summary's own
// NAIROBI_OFFSET convention.
const NAIROBI_OFFSET = Prisma.sql`INTERVAL '3 hours'`;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const UPFIELD_REP_EXPRESSION = Prisma.sql`REGEXP_REPLACE(BTRIM(fsr), '\\s+', ' ', 'g')`;

function utcMidnight(year: number, monthIndex: number, day = 1): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function formatHHMM(minutes: number): string {
  const total = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Adaptive trend granularity: a single MONTH/MTD breaks into its calendar
 *  weeks, a YTD span breaks into the quarters it covers, and everything else
 *  (QTD, a specific Q1-Q4, H1/H2, CUSTOM) breaks into the plain months
 *  resolvePeriodMonths() already resolves for that kind — which already is
 *  "months in that quarter" for QTD/Q1-Q4, so no separate case is needed
 *  there. */
export function resolveTimeInTradeBuckets(period: PeriodSelection): TimeInTradeBucket[] {
  const year = Number(period.year);
  if (!year) return [];

  if (period.kind === "MONTH" || period.kind === "MTD") {
    const monthIndex = period.month ? CANONICAL_MONTHS.indexOf(period.month) : -1;
    if (monthIndex < 0) return [];
    const weeks = getWeeksInMonth(year, monthIndex);
    return weeks.map((w, i) => ({
      key: w.weekLabel,
      label: w.weekLabel,
      start: w.weekStartDate,
      end: weeks[i + 1]?.weekStartDate ?? utcMidnight(year, monthIndex + 1),
    }));
  }

  const months = resolvePeriodMonths(period);
  if (months.length === 0) return [];

  if (period.kind === "YTD") {
    const quarters = new Map<number, { start: Date; end: Date }>();
    for (const m of months) {
      const q = Math.floor(m.monthIndex / 3);
      const monthStart = utcMidnight(Number(m.year), m.monthIndex);
      const monthEnd = utcMidnight(Number(m.year), m.monthIndex + 1);
      const existing = quarters.get(q);
      if (existing) existing.end = monthEnd;
      else quarters.set(q, { start: monthStart, end: monthEnd });
    }
    return Array.from(quarters.entries())
      .sort(([a], [b]) => a - b)
      .map(([q, range]) => ({ key: `Q${q + 1}`, label: `Q${q + 1} ${period.year}`, start: range.start, end: range.end }));
  }

  return months.map((m) => ({
    key: `${m.year}-${String(m.monthIndex + 1).padStart(2, "0")}`,
    label: `${CANONICAL_MONTHS[m.monthIndex].slice(0, 3)} ${m.year}`,
    start: utcMidnight(Number(m.year), m.monthIndex),
    end: utcMidnight(Number(m.year), m.monthIndex + 1),
  }));
}

interface RepDayRow {
  date: Date;
  startTime: Date | null;
  closeTime: Date | null;
  visits: number;
  productive: number | null;
}
interface OutletRow {
  date: Date;
  outletKey: string;
}

async function pineRepDayRows(start: Date, end: Date): Promise<RepDayRow[]> {
  const rows = await prisma.$queryRaw<{ date: Date; startTime: Date; closeTime: Date; visits: bigint; productive: bigint }[]>(Prisma.sql`
    SELECT date, MIN("firstCallOfDay") AS "startTime", MAX("lastCallOfDay") AS "closeTime",
      COUNT(*)::bigint AS visits, COUNT(*) FILTER (WHERE "callOutcome" = 'Sale')::bigint AS productive
    FROM "RepCall" WHERE date >= ${start} AND date < ${end}
    GROUP BY date, "employeeCode"`);
  return rows.map((r) => ({ date: r.date, startTime: r.startTime, closeTime: r.closeTime, visits: Number(r.visits), productive: Number(r.productive) }));
}

async function pineOutletRows(start: Date, end: Date): Promise<OutletRow[]> {
  return prisma.$queryRaw<OutletRow[]>(Prisma.sql`
    SELECT DISTINCT date, "outletId" AS "outletKey" FROM "RepCall" WHERE date >= ${start} AND date < ${end}`);
}

async function eablRepDayRows(start: Date, end: Date): Promise<RepDayRow[]> {
  const rows = await prisma.$queryRaw<{ date: Date; startTime: Date | null; closeTime: Date | null; visits: bigint; productive: bigint }[]>(Prisma.sql`
    SELECT "callDate" AS date, MIN("firstCallOfDay") AS "startTime", MAX("lastCallOfDay") AS "closeTime",
      COUNT(*)::bigint AS visits, COUNT(*) FILTER (WHERE "isProductive")::bigint AS productive
    FROM "EablCall" WHERE "callDate" >= ${start} AND "callDate" < ${end}
    GROUP BY "callDate", salesman`);
  return rows.map((r) => ({ date: r.date, startTime: r.startTime, closeTime: r.closeTime, visits: Number(r.visits), productive: Number(r.productive) }));
}

async function eablOutletRows(start: Date, end: Date): Promise<OutletRow[]> {
  return prisma.$queryRaw<OutletRow[]>(Prisma.sql`
    SELECT DISTINCT "callDate" AS date, COALESCE(NULLIF(BTRIM("customerCode"), ''), "customerName") AS "outletKey"
    FROM "EablCall" WHERE "callDate" >= ${start} AND "callDate" < ${end}`);
}

async function upfieldRepDayRows(start: Date, end: Date): Promise<RepDayRow[]> {
  const queryStart = new Date(start.getTime() - NAIROBI_OFFSET_MS);
  const queryEnd = new Date(end.getTime() - NAIROBI_OFFSET_MS);
  const rows = await prisma.$queryRaw<{ date: Date; startTime: Date; closeTime: Date; visits: bigint }[]>(Prisma.sql`
    SELECT DATE("txnDate" + ${NAIROBI_OFFSET}) AS date,
      MIN("txnDate" + ${NAIROBI_OFFSET}) AS "startTime", MAX("txnDate" + ${NAIROBI_OFFSET}) AS "closeTime",
      COUNT(*)::bigint AS visits
    FROM "UpfieldTransaction"
    WHERE "txnDate" >= ${queryStart} AND "txnDate" < ${queryEnd}
      AND NULLIF(BTRIM(fsr), '') IS NOT NULL AND UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST'
    GROUP BY 1, ${UPFIELD_REP_EXPRESSION}`);
  return rows.map((r) => ({ date: r.date, startTime: r.startTime, closeTime: r.closeTime, visits: Number(r.visits), productive: null }));
}

async function upfieldOutletRows(start: Date, end: Date): Promise<OutletRow[]> {
  const queryStart = new Date(start.getTime() - NAIROBI_OFFSET_MS);
  const queryEnd = new Date(end.getTime() - NAIROBI_OFFSET_MS);
  return prisma.$queryRaw<OutletRow[]>(Prisma.sql`
    SELECT DISTINCT DATE("txnDate" + ${NAIROBI_OFFSET}) AS date,
      COALESCE(NULLIF(BTRIM("custCode"), ''), NULLIF(BTRIM("custName"), '')) AS "outletKey"
    FROM "UpfieldTransaction"
    WHERE "txnDate" >= ${queryStart} AND "txnDate" < ${queryEnd} AND type = 'sale' AND COALESCE("saleIncl", 0) > 0`);
}

async function unileverRepDayRows(start: Date, end: Date): Promise<RepDayRow[]> {
  const rows = await prisma.$queryRaw<{ date: Date; startTime: Date | null; closeTime: Date | null; visits: bigint }[]>(Prisma.sql`
    SELECT date, MIN("firstEntryTime") AS "startTime", MAX(COALESCE("lastEntryTime", "firstEntryTime")) AS "closeTime",
      SUM("outletsVisited")::bigint AS visits
    FROM "PjpDsrDailyActivity" WHERE date >= ${start} AND date < ${end}
    GROUP BY date, distributor, dsr`);
  return rows.map((r) => ({ date: r.date, startTime: r.startTime, closeTime: r.closeTime, visits: Number(r.visits), productive: null }));
}

const SOURCE_QUERIES: Record<
  TimeInTradeSource,
  { repDays: (start: Date, end: Date) => Promise<RepDayRow[]>; outlets: ((start: Date, end: Date) => Promise<OutletRow[]>) | null }
> = {
  pine: { repDays: pineRepDayRows, outlets: pineOutletRows },
  eabl: { repDays: eablRepDayRows, outlets: eablOutletRows },
  upfield: { repDays: upfieldRepDayRows, outlets: upfieldOutletRows },
  // PjpDsrDailyActivity has no outlet-level identity (outletsVisited is a
  // pre-aggregated count, not a set of outlet ids) — see the type comment on
  // TimeInTradeRow.newOutlets. No strike rate either, same reason CoverageView's
  // own Leverage section already gives for this source.
  unilever: { repDays: unileverRepDayRows, outlets: null },
};

function inBucket(date: Date, bucket: TimeInTradeBucket): boolean {
  return date >= bucket.start && date < bucket.end;
}

export interface TimeInTradeTrend {
  buckets: TimeInTradeBucket[];
  rows: TimeInTradeRow[];
}

export async function getTimeInTradeTrend(period: PeriodSelection): Promise<TimeInTradeTrend> {
  const buckets = resolveTimeInTradeBuckets(period);
  if (buckets.length === 0) return { buckets: [], rows: [] };

  const rangeStart = buckets[0].start;
  const rangeEnd = buckets[buckets.length - 1].end;

  const rows: TimeInTradeRow[] = [];
  for (const source of TIME_IN_TRADE_SOURCES) {
    const queries = SOURCE_QUERIES[source];
    const [repDayRows, outletRows] = await Promise.all([
      queries.repDays(rangeStart, rangeEnd),
      queries.outlets ? queries.outlets(rangeStart, rangeEnd) : Promise.resolve<OutletRow[]>([]),
    ]);

    let previousOutletKeys: Set<string> | null = null;
    for (const bucket of buckets) {
      const bucketRepDays = repDayRows.filter((r) => inBucket(r.date, bucket));
      const startMinutesList = bucketRepDays
        .map((r) => (r.startTime ? nairobiMinutesAfterMidnight(r.startTime.toISOString()) : null))
        .filter((v): v is number => v !== null);
      const closeMinutesList = bucketRepDays
        .map((r) => (r.closeTime ? nairobiMinutesAfterMidnight(r.closeTime.toISOString()) : null))
        .filter((v): v is number => v !== null);
      const startMinutes = averageMinutes(startMinutesList);
      const closeMinutes = averageMinutes(closeMinutesList);
      const hoursList = bucketRepDays
        .filter((r) => r.startTime && r.closeTime)
        .map((r) => (r.closeTime!.getTime() - r.startTime!.getTime()) / 3_600_000);
      const avgHours = hoursList.length > 0 ? hoursList.reduce((sum, v) => sum + v, 0) / hoursList.length : null;
      const visits = bucketRepDays.reduce((sum, r) => sum + r.visits, 0);
      const hasProductiveSignal = bucketRepDays.some((r) => r.productive !== null);
      const productiveVisits = hasProductiveSignal ? bucketRepDays.reduce((sum, r) => sum + (r.productive ?? 0), 0) : null;
      const productivityPct = productiveVisits !== null && visits > 0 ? Math.round((productiveVisits / visits) * 1000) / 10 : null;

      let newOutlets: number | null = null;
      if (queries.outlets) {
        const bucketOutletKeys = new Set(outletRows.filter((r) => inBucket(r.date, bucket)).map((r) => r.outletKey));
        newOutlets = previousOutletKeys ? [...bucketOutletKeys].filter((k) => !previousOutletKeys!.has(k)).length : null;
        previousOutletKeys = bucketOutletKeys;
      }

      rows.push({
        source,
        sourceLabel: TIME_IN_TRADE_SOURCE_LABELS[source],
        bucketKey: bucket.key,
        bucketLabel: bucket.label,
        repDays: bucketRepDays.length,
        visits,
        productiveVisits,
        productivityPct,
        avgStartTime: startMinutes !== null ? formatHHMM(startMinutes) : null,
        avgCloseTime: closeMinutes !== null ? formatHHMM(closeMinutes) : null,
        avgHoursInTrade: avgHours !== null ? Math.round(avgHours * 10) / 10 : null,
        newOutlets,
      });
    }
  }

  return { buckets, rows };
}
