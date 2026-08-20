/** A complete sales month supplied by SAP for replacement, not patching. */
export interface ReplacementPeriod {
  year: string;
  monthIndex: number;
}

export function replacementPeriodsFromMonthlyRows(rows: { year: string; monthIndex: number }[]): ReplacementPeriod[] {
  return Array.from(new Map(rows.map((row) => [`${row.year}|${row.monthIndex}`, { year: row.year, monthIndex: row.monthIndex }])).values());
}

/** Every month touched by a day-grain extraction window. Passing this scope to
 * the API lets it delete a day that disappeared entirely from SAP after a
 * correction; a scope inferred only from returned rows cannot do that. */
export function replacementPeriodsFromDailyWindows(windows: { start: Date; end: Date }[]): ReplacementPeriod[] {
  const periods = new Map<string, ReplacementPeriod>();
  for (const window of windows) {
    const cursor = new Date(Date.UTC(window.start.getUTCFullYear(), window.start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(window.end.getUTCFullYear(), window.end.getUTCMonth(), 1));
    while (cursor <= last) {
      const period = { year: String(cursor.getUTCFullYear()), monthIndex: cursor.getUTCMonth() };
      periods.set(`${period.year}|${period.monthIndex}`, period);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return Array.from(periods.values());
}
