/** First-call policy for the operational Timestamps report (Africa/Nairobi).
 * A representative is on time at 09:00 or earlier, has a 29-minute grace
 * window from 09:01 through 09:29, and needs attention from 09:30 onward.
 * The grace window deliberately remains neutral: the agreed late threshold is
 * 09:30, while green recognition is reserved for starting trade by 09:00. */
export type TimeManagementStatus = "on-time" | "grace" | "late";

const NAIROBI_UTC_OFFSET_MINUTES = 3 * 60;
const ON_TIME_CUTOFF_MINUTES = 9 * 60;
const LATE_CUTOFF_MINUTES = 9 * 60 + 30;

export function nairobiMinutesAfterMidnight(iso: string): number | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return (value.getUTCHours() * 60 + value.getUTCMinutes() + NAIROBI_UTC_OFFSET_MINUTES) % (24 * 60);
}

export function firstCallStatus(firstCall: string): TimeManagementStatus {
  const minutes = nairobiMinutesAfterMidnight(firstCall);
  if (minutes === null) return "grace";
  if (minutes <= ON_TIME_CUTOFF_MINUTES) return "on-time";
  if (minutes >= LATE_CUTOFF_MINUTES) return "late";
  return "grace";
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
