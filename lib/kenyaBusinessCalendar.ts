/**
 * Kenyan dashboard working-day calendar. Source data is never filtered or
 * rewritten with this module: its dates are used only when an operational
 * dashboard needs to exclude non-working days from displayed activity and
 * averages.
 *
 * The fixed and Easter-based dates follow the Public Holidays Act. Movable
 * national holidays and one-off Gazette declarations are deliberately listed
 * by year once confirmed, rather than guessed from a lunar calendar.
 */

export type KenyaDateKey = string;

const GAZETTED_NATIONAL_HOLIDAYS: Record<number, readonly KenyaDateKey[]> = {
  // Confirmed national observances. Keep this list explicit because Idd dates
  // and any exceptional public holiday are set by Gazette notice.
  2024: ["2024-04-10", "2024-06-17"],
  2025: ["2025-03-31", "2025-06-06"],
  2026: ["2026-03-20", "2026-05-27"],
};

function dateKey(date: Date): KenyaDateKey {
  return date.toISOString().slice(0, 10);
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function addDateDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function addUtcDays(key: KenyaDateKey, days: number): KenyaDateKey {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function weekday(key: KenyaDateKey): number {
  return new Date(`${key}T00:00:00.000Z`).getUTCDay();
}

/** Gregorian computus, returning Easter Sunday in UTC. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthIndex = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, monthIndex, day);
}

/**
 * Every national public-holiday date available to the dashboard for a year,
 * including the statutory next-day observance when a Part I holiday is Sunday.
 */
export function kenyaPublicHolidayKeys(year: number): KenyaDateKey[] {
  const easter = easterSunday(year);
  const holidays = new Set<KenyaDateKey>([
    dateKey(utcDate(year, 0, 1)),
    dateKey(addDateDays(easter, -2)), // Good Friday
    dateKey(addDateDays(easter, 1)), // Easter Monday
    dateKey(utcDate(year, 4, 1)), // Labour Day
    dateKey(utcDate(year, 5, 1)), // Madaraka Day
    dateKey(utcDate(year, 9, 10)), // Mazingira Day
    dateKey(utcDate(year, 9, 20)), // Mashujaa Day
    dateKey(utcDate(year, 11, 12)), // Jamhuri Day
    dateKey(utcDate(year, 11, 25)), // Christmas Day
    dateKey(utcDate(year, 11, 26)), // Boxing Day
    ...(GAZETTED_NATIONAL_HOLIDAYS[year] ?? []),
  ]);

  // Public Holidays Act s.4: a Part I holiday on Sunday is observed on the
  // next date that is not already a public holiday. The working-day filter
  // would exclude Sunday anyway, but the observed weekday must also disappear.
  for (const holiday of [...holidays]) {
    if (weekday(holiday) !== 0) continue;
    let observed = addUtcDays(holiday, 1);
    while (holidays.has(observed)) observed = addUtcDays(observed, 1);
    holidays.add(observed);
  }

  return [...holidays].sort();
}

/** Returns known Kenyan public holidays in a [start, end) UTC date range. */
export function kenyaPublicHolidaysInRange(start: Date, end: Date): KenyaDateKey[] {
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  const keys = new Set<KenyaDateKey>();
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    for (const holiday of kenyaPublicHolidayKeys(year)) {
      if (holiday >= startKey && holiday < endKey) keys.add(holiday);
    }
  }
  return [...keys].sort();
}

/** Monday-Friday excluding the calendar above. Input is treated as a UTC date. */
export function isKenyaWorkingDay(value: Date | KenyaDateKey): boolean {
  const key = typeof value === "string" ? value : dateKey(value);
  const day = weekday(key);
  return day >= 1 && day <= 5 && !kenyaPublicHolidayKeys(Number(key.slice(0, 4))).includes(key);
}
