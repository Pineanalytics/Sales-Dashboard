// The rep timestamp report for the Coaching app (resource=rep-timestamps): when a rep was in trade each day, from their Pine calls (RepCall). Per day: first and last
// call, hours between them, calls, productive calls and the average gap between calls; for windows up to a month, every call with its time, outlet and outcome.
// Times are the call records' own wall-clock times (Nairobi), as the Timestamps page shows them. Counts and times only, no sales value per call.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const MAX_TIMESTAMP_CALL_DAYS = 31;

export interface TimestampCall {
  time: string;
  outletId: string;
  outletName: string;
  outcome: "Sale" | "No Sale" | string;
  noSaleReason: string | null;
  intervalMins: number | null;
}

export interface TimestampDay {
  date: string;
  firstCall: string;
  lastCall: string;
  hoursInDay: number;
  calls: number;
  productiveCalls: number;
  avgIntervalMins: number | null;
  /** Present when the window is a month or less. */
  callList?: TimestampCall[];
}

export interface RepTimestamps {
  employeeCode: string;
  days: TimestampDay[];
  totals: { daysWorked: number; calls: number; productiveCalls: number; avgHoursInDay: number | null; avgFirstCall: string | null; avgLastCall: string | null; avgIntervalMins: number | null };
}

export interface RawTimestampDay {
  employeeCode: string;
  date: string;
  first_mins: number;
  last_mins: number;
  calls: number;
  productive: number;
  avg_interval: number | null;
}

export interface RawTimestampCall {
  employeeCode: string;
  date: string;
  time: string;
  outletId: string;
  outletName: string;
  callOutcome: string;
  noSaleReason: string | null;
  intervalMins: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.round(mins % 60)).padStart(2, "0")}`;

/** Pure: the database's day rows and call rows into one answer per code (codes with no calls still get an empty answer). */
export function shapeRepTimestamps(codes: string[], days: RawTimestampDay[], calls: RawTimestampCall[] | null): RepTimestamps[] {
  return codes.map((employeeCode) => {
    const mine = days.filter((d) => d.employeeCode === employeeCode).sort((a, b) => a.date.localeCompare(b.date));
    const shaped: TimestampDay[] = mine.map((d) => {
      const day: TimestampDay = {
        date: d.date,
        firstCall: hhmm(Number(d.first_mins)),
        lastCall: hhmm(Number(d.last_mins)),
        hoursInDay: r1((Number(d.last_mins) - Number(d.first_mins)) / 60),
        calls: Number(d.calls),
        productiveCalls: Number(d.productive),
        avgIntervalMins: d.avg_interval === null ? null : r1(Number(d.avg_interval)),
      };
      if (calls) {
        day.callList = calls
          .filter((c) => c.employeeCode === employeeCode && c.date === d.date)
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((c) => ({ time: c.time, outletId: c.outletId, outletName: c.outletName, outcome: c.callOutcome, noSaleReason: c.noSaleReason, intervalMins: c.intervalMins === null ? null : r1(Number(c.intervalMins)) }));
      }
      return day;
    });
    const n = shaped.length;
    const intervals = mine.map((d) => d.avg_interval).filter((v): v is number => v !== null);
    return {
      employeeCode,
      days: shaped,
      totals: {
        daysWorked: n,
        calls: shaped.reduce((s, d) => s + d.calls, 0),
        productiveCalls: shaped.reduce((s, d) => s + d.productiveCalls, 0),
        avgHoursInDay: n ? r1(shaped.reduce((s, d) => s + d.hoursInDay, 0) / n) : null,
        avgFirstCall: n ? hhmm(mine.reduce((s, d) => s + Number(d.first_mins), 0) / n) : null,
        avgLastCall: n ? hhmm(mine.reduce((s, d) => s + Number(d.last_mins), 0) / n) : null,
        avgIntervalMins: intervals.length ? r1(intervals.reduce((s, v) => s + Number(v), 0) / intervals.length) : null,
      },
    };
  });
}

/** `start` is the first day, `endExclusive` the day after the last (UTC midnight, as RepCall.date is stored). */
export async function loadRepTimestamps(codes: string[], start: Date, endExclusive: Date): Promise<RepTimestamps[]> {
  const span = (endExclusive.getTime() - start.getTime()) / 86_400_000;
  const minutes = Prisma.sql`(EXTRACT(HOUR FROM "callTime") * 60 + EXTRACT(MINUTE FROM "callTime"))`;
  const [days, calls] = await Promise.all([
    prisma.$queryRaw<RawTimestampDay[]>(Prisma.sql`
      SELECT "employeeCode", to_char(date, 'YYYY-MM-DD') AS date,
             MIN(${minutes})::float AS first_mins, MAX(${minutes})::float AS last_mins,
             COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE "callOutcome" = 'Sale')::int AS productive,
             AVG("intervalMins")::float AS avg_interval
      FROM "RepCall"
      WHERE "employeeCode" IN (${Prisma.join(codes)}) AND date >= ${start} AND date < ${endExclusive}
      GROUP BY "employeeCode", date`),
    span <= MAX_TIMESTAMP_CALL_DAYS
      ? prisma.$queryRaw<RawTimestampCall[]>(Prisma.sql`
          SELECT "employeeCode", to_char(date, 'YYYY-MM-DD') AS date, to_char("callTime", 'HH24:MI') AS time,
                 "outletId", "outletName", "callOutcome", "noSaleReason", "intervalMins"
          FROM "RepCall"
          WHERE "employeeCode" IN (${Prisma.join(codes)}) AND date >= ${start} AND date < ${endExclusive}
          ORDER BY date, "callTime", "callSequence"
          LIMIT 5000`)
      : Promise.resolve(null),
  ]);
  return shapeRepTimestamps(codes, days, calls);
}
