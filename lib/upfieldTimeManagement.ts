import type { ClosingStatus, TimeManagementStatus } from "@/lib/timeManagement";

const UPFIELD_START_CUTOFF_MINUTES = 8 * 60;
const UPFIELD_CLOSE_CUTOFF_MINUTES = 16 * 60;

/** Upfield report timestamps are returned as UTC-shaped Nairobi wall-clock
 * values by the reporting SQL. Reading UTC parts avoids a second browser
 * timezone conversion. */
export function upfieldMinutesAfterMidnight(iso: string): number | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

/** Upfield-specific start benchmark: 08:00 or earlier is on time. */
export function upfieldFirstTransactionStatus(firstTransaction: string): TimeManagementStatus {
  const minutes = upfieldMinutesAfterMidnight(firstTransaction);
  if (minutes === null) return "grace";
  return minutes <= UPFIELD_START_CUTOFF_MINUTES ? "on-time" : "late";
}

function nairobiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Closing feedback is assessed only for elapsed Nairobi calendar days. */
export function upfieldClosingStatus(date: string, lastTransaction: string, now = new Date()): ClosingStatus {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "unknown";
  const today = nairobiDateKey(now);
  if (date === today) return "day-in-progress";
  if (date > today) return "not-due";
  const minutes = upfieldMinutesAfterMidnight(lastTransaction);
  if (minutes === null) return "unknown";
  return minutes >= UPFIELD_CLOSE_CUTOFF_MINUTES ? "closed-on-time" : "closed-early";
}
