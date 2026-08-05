/** First-call policy for the operational Timestamps report (Africa/Nairobi).
 * A representative is on time at 09:30 or earlier and needs attention only
 * after 09:30. Invalid timestamps remain neutral rather than being assessed. */
export type TimeManagementStatus = "on-time" | "grace" | "late";
export type ClosingStatus = "closed-on-time" | "closed-early" | "day-in-progress" | "not-due" | "unknown";

const NAIROBI_UTC_OFFSET_MINUTES = 3 * 60;
const ON_TIME_CUTOFF_MINUTES = 9 * 60 + 30;
const CLOSE_OF_TRADE_CUTOFF_MINUTES = 16 * 60;

/** How many trailing calendar months RepCall keeps before the upload route's
 * retainFrom purge drops them. Shared by the live sync (what it's allowed to
 * delete) and the Timestamps page (which months it offers in its selector),
 * so the two stay in lockstep. */
export const TIMESTAMPS_RETENTION_MONTHS = 3;

/** "YYYY-MM" for the current month plus the trailing retained months, newest
 * first — exactly the months the retention window guarantees may have data,
 * without needing a server round-trip just to populate a month picker. */
export function recentMonthOptions(now: Date, count = TIMESTAMPS_RETENTION_MONTHS): string[] {
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export function nairobiMinutesAfterMidnight(iso: string): number | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return (value.getUTCHours() * 60 + value.getUTCMinutes() + NAIROBI_UTC_OFFSET_MINUTES) % (24 * 60);
}

export function firstCallStatus(firstCall: string): TimeManagementStatus {
  const minutes = nairobiMinutesAfterMidnight(firstCall);
  if (minutes === null) return "grace";
  if (minutes <= ON_TIME_CUTOFF_MINUTES) return "on-time";
  return "late";
}

function nairobiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Closing feedback is deliberately withheld for today's activity: a rep can
 * still make calls later in the day. Only elapsed calendar days are assessed
 * against the agreed 4:00 PM Africa/Nairobi close-of-trade threshold. */
export function closingStatus(date: string, lastCall: string, now = new Date()): ClosingStatus {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "unknown";
  const today = nairobiDateKey(now);
  if (date === today) return "day-in-progress";
  if (date > today) return "not-due";

  const minutes = nairobiMinutesAfterMidnight(lastCall);
  if (minutes === null) return "unknown";
  return minutes >= CLOSE_OF_TRADE_CUTOFF_MINUTES ? "closed-on-time" : "closed-early";
}

/** Mean of a rep's daily first/last-call minutes-after-midnight across every
 *  day in the current selection — the counterpart to the per-day value
 *  nairobiMinutesAfterMidnight returns, used when a full month (no single
 *  date) is selected so "First Call"/"Last Call" reflects a rep's typical
 *  start/finish rather than whichever single day happens to sort first. */
export function averageMinutes(minutesList: number[]): number | null {
  if (minutesList.length === 0) return null;
  return minutesList.reduce((sum, m) => sum + m, 0) / minutesList.length;
}

/** Inverse of nairobiMinutesAfterMidnight: builds a real ISO instant (today's
 *  date, arbitrary) carrying the given Nairobi clock time, so an averaged
 *  minutes-after-midnight value can still flow through every existing
 *  ISO-string-based formatter/status function unchanged. */
export function isoFromNairobiMinutes(minutes: number, base = new Date()): string {
  const utcMinutesTotal = (((Math.round(minutes) - NAIROBI_UTC_OFFSET_MINUTES) % (24 * 60)) + 24 * 60) % (24 * 60);
  const result = new Date(base);
  result.setUTCHours(Math.floor(utcMinutesTotal / 60), utcMinutesTotal % 60, 0, 0);
  return result.toISOString();
}

/** Same closed-early/closed-on-time threshold closingStatus uses, but without
 *  its date-elapsed branches (today/future) — for an averaged monthly row
 *  there's no single calendar date to check "has this day finished yet"
 *  against, only a typical last-call time worth judging on its own. */
export function closingStatusForMinutes(lastCallMinutes: number | null): ClosingStatus {
  if (lastCallMinutes === null) return "unknown";
  return lastCallMinutes >= CLOSE_OF_TRADE_CUTOFF_MINUTES ? "closed-on-time" : "closed-early";
}

export function timeManagementRank(status: TimeManagementStatus): number {
  if (status === "late") return 0;
  if (status === "grace") return 1;
  return 2;
}

export interface TimeManagementRow {
  firstCall: string;
  salesRep: string;
}

/** Attention always appears first. Within that group, the latest start is
 * highest priority; green/on-time starts stay at the bottom, earliest first. */
export function compareTimeManagementRows<T extends TimeManagementRow>(a: T, b: T): number {
  const aStatus = firstCallStatus(a.firstCall);
  const bStatus = firstCallStatus(b.firstCall);
  const statusOrder = timeManagementRank(aStatus) - timeManagementRank(bStatus);
  if (statusOrder !== 0) return statusOrder;

  const aMinutes = nairobiMinutesAfterMidnight(a.firstCall) ?? 24 * 60;
  const bMinutes = nairobiMinutesAfterMidnight(b.firstCall) ?? 24 * 60;
  if (aMinutes !== bMinutes) {
    return aStatus === "late" ? bMinutes - aMinutes : aMinutes - bMinutes;
  }
  return a.salesRep.localeCompare(b.salesRep);
}
