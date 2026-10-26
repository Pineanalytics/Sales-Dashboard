// Suggests an outlet's route days from how it has actually been visited: the weekdays it is called on, how often, and by whom. Pure, so the form and the tests share it.
import { WEEKDAYS, type VisitSuggestion, type Weekday } from "./types";

export interface VisitEvent {
  /** The day of the visit, "YYYY-MM-DD". */
  date: string;
  repCode: string | null;
  rep: string;
}

const DAY_MS = 86_400_000;
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** Monday-first weekday of a "YYYY-MM-DD" date. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(utc(date).getUTCDay() + 6) % 7];
}

/** A number that is the same for every day of one Monday-to-Sunday week. */
function weekIndex(date: string): number {
  return Math.floor((utc(date).getTime() - 4 * DAY_MS) / (7 * DAY_MS)); // 1970-01-05 was a Monday
}

export function emptyWeekdayCounts(): Record<Weekday, number> {
  return { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
}

const fold = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** The suggestion for a set of visits in a window that ends on `today` ("YYYY-MM-DD"). Several calls on one day are one visit. */
export function suggestFromVisits(
  visits: readonly VisitEvent[],
  opts: { basis: string; windowDays: number; today: string; rowRepCode?: string | null; rowRepName?: string | null; repOptions?: { code: string; name: string }[] }
): VisitSuggestion {
  const from = new Date(utc(opts.today).getTime() - (opts.windowDays - 1) * DAY_MS).toISOString().slice(0, 10);
  const inWindow = visits.filter((v) => v.date >= from && v.date <= opts.today);

  // The rep of this row, when they have visits at the outlet; otherwise everyone's visits.
  const isRowRep = (v: VisitEvent) => (opts.rowRepCode ? v.repCode === opts.rowRepCode : false) || (opts.rowRepName ? fold(v.rep) === fold(opts.rowRepName) : false);
  const own = inWindow.filter(isRowRep);
  const used = own.length > 0 ? own : inWindow;

  const days = [...new Set(used.map((v) => v.date))].sort();
  const weekdayCounts = emptyWeekdayCounts();
  for (const day of days) weekdayCounts[weekdayOf(day)] += 1;
  const weeksVisited = new Set(days.map(weekIndex)).size;
  const weeksInWindow = Math.max(1, Math.ceil(opts.windowDays / 7));
  const visitsPerMonth = Math.round((days.length / opts.windowDays) * 30.4 * 10) / 10;

  // A regular day is one the outlet was visited on at least half as often as its busiest day (and at least twice); with no repeats, only an outlet seen once or twice has a suggestion.
  const max = Math.max(0, ...Object.values(weekdayCounts));
  const threshold = max <= 1 ? 1 : Math.max(2, Math.ceil(max / 2));
  const regular = max === 0 ? [] : max === 1 && days.length > 2 ? [] : WEEKDAYS.filter((d) => weekdayCounts[d] >= threshold);

  const ratio = weeksVisited / weeksInWindow;
  const perWeek = days.length / weeksInWindow;
  const cadence: VisitSuggestion["cadence"] = days.length === 0 ? "No visits on record" : perWeek >= 0.9 || ratio >= 0.7 ? "Weekly or more" : ratio >= 0.35 ? "Fortnightly" : ratio >= 0.15 ? "Monthly" : "Occasional";

  const byRep = new Map<string, { code: string | null; name: string; dates: Set<string> }>();
  for (const v of inWindow) {
    const key = v.repCode ?? fold(v.rep);
    const entry = byRep.get(key) ?? byRep.set(key, { code: v.repCode, name: v.rep, dates: new Set() }).get(key)!;
    entry.dates.add(v.date);
  }
  const reps = [...byRep.values()].map((r) => ({ code: r.code, name: r.name, visits: r.dates.size })).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  const top = reps[0];
  const onList = top ? (opts.repOptions ?? []).find((o) => (top.code !== null && o.code === top.code) || fold(o.name) === fold(top.name)) : undefined;
  const topIsRowRep = top ? (opts.rowRepCode ? top.code === opts.rowRepCode : false) || (opts.rowRepName ? fold(top.name) === fold(opts.rowRepName) : false) : true;
  const suggestedRep = top && !topIsRowRep && onList ? { code: onList.code, name: onList.name } : null;

  return { basis: opts.basis, windowDays: opts.windowDays, visitDays: days.length, weeksVisited, weeksInWindow, visitsPerMonth, cadence, weekdayCounts, suggestedDays: regular, reps, suggestedRep, planned: null };
}

/** The weekday a text names ("Collins Onyuka - Thursday"), or null. */
export function weekdayInText(text: string | null | undefined): Weekday | null {
  const match = /\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b/i.exec(text ?? "");
  if (!match) return null;
  return WEEKDAYS.find((d) => d.toLowerCase() === match[1].toLowerCase().slice(0, 3)) ?? null;
}

/** A Centegy journey-plan working day (1 = Monday ... 6 = Saturday) as a weekday. */
export function weekdayFromWorkingDay(day: number | null | undefined): Weekday | null {
  return day !== null && day !== undefined && day >= 1 && day <= 7 ? WEEKDAYS[day - 1] : null;
}
