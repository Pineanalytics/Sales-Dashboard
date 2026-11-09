// `sales-sync --month=YYYY-MM`: refresh ONE closed month from SAP (revenue only; the month's stored COGS/GP ratios are kept, as in a backfill).
// The routine sync reads only the current month, so a transaction posted after a month closed (a late or backdated invoice) is otherwise only
// picked up by the full-year --backfill. This reads just that month's days and replaces just that month.

export interface MonthWindow {
  year: number;
  monthIndex: number;
  start: Date;
  /** The month's last day (the daily query's end date is inclusive). */
  end: Date;
}

/** The window for a "YYYY-MM" argument, or an error text. Only a month that has ended can be chosen: the current month belongs to the routine sync. */
export function monthWindow(arg: string, asOf: Date): MonthWindow | { error: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(arg.trim());
  if (!match) return { error: "--month must look like 2026-10." };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (year * 12 + monthIndex >= asOf.getUTCFullYear() * 12 + asOf.getUTCMonth()) return { error: "--month must be a month that has already ended; the routine sync covers the current month." };
  return { year, monthIndex, start: new Date(Date.UTC(year, monthIndex, 1)), end: new Date(Date.UTC(year, monthIndex + 1, 0)) };
}
