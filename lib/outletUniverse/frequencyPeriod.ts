// The period and cadence rules of the coverage frequency extract, kept free of server code so the Active Outlets screen can use them too.
import { nairobiToday } from "@/lib/financePresentation";

export type FrequencyPeriodKind = "year" | "quarter" | "month" | "week";

/** Column order of the example summary. */
export const CADENCES = ["Once per Year", "Once in 6 Months", "Once in 3 Months", "Once Per Month"] as const;
export type Cadence = (typeof CADENCES)[number];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

export interface FrequencyPeriod {
  kind: FrequencyPeriodKind;
  year: number;
  quarter: number | null;
  month: number | null;
  week: number | null;
  /** Inclusive start and exclusive end, as UTC dates. */
  start: Date;
  end: Date;
  label: string;
  /** Months (0 to 11) of the period that have started: the ones a buyer is expected to have bought in. */
  startedMonths: number[];
}

const monday = (date: Date) => new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS);

/** The ISO week (Monday start) a date falls in, with the ISO year it belongs to. */
export function isoWeekOf(date: Date): { year: number; week: number } {
  const thursday = new Date(monday(date).getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  return { year, week: Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1 };
}

export function isoWeeksInYear(year: number): number {
  return isoWeekOf(new Date(Date.UTC(year, 11, 28))).week;
}

function isoWeekStart(year: number, week: number): Date {
  return new Date(monday(new Date(Date.UTC(year, 0, 4))).getTime() + (week - 1) * 7 * DAY_MS);
}

const int = (value: string | null, min: number, max: number): number | null => {
  const n = Number(value);
  return value !== null && value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const fmtDay = (date: Date) => `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;

/** Reads kind, year, quarter, month and week from a request. A missing or invalid part falls back to the current one. */
export function resolveFrequencyPeriod(params: URLSearchParams, now: Date = new Date()): FrequencyPeriod {
  const today = nairobiToday(now);
  const todayMs = Date.UTC(today.year, today.monthIndex, today.day);
  const rawKind = params.get("kind");
  const kind: FrequencyPeriodKind = rawKind === "quarter" || rawKind === "month" || rawKind === "week" ? rawKind : "year";
  const todayWeek = isoWeekOf(new Date(todayMs));
  const year = int(params.get("year"), 2000, 2100) ?? (kind === "week" ? todayWeek.year : today.year);

  let start: Date;
  let end: Date;
  let label: string;
  let quarter: number | null = null;
  let month: number | null = null;
  let week: number | null = null;
  if (kind === "week") {
    week = int(params.get("week"), 1, isoWeeksInYear(year)) ?? (year === todayWeek.year ? todayWeek.week : 1);
    start = isoWeekStart(year, week);
    end = new Date(start.getTime() + 7 * DAY_MS);
    label = `Week ${week} ${year} (${fmtDay(start)} to ${fmtDay(new Date(end.getTime() - DAY_MS))})`;
  } else if (kind === "month") {
    month = int(params.get("month"), 1, 12) ?? today.monthIndex + 1;
    start = new Date(Date.UTC(year, month - 1, 1));
    end = new Date(Date.UTC(year, month, 1));
    label = `${MONTH_NAMES[month - 1]} ${year}`;
  } else if (kind === "quarter") {
    quarter = int(params.get("quarter"), 1, 4) ?? Math.floor(today.monthIndex / 3) + 1;
    start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    end = new Date(Date.UTC(year, quarter * 3, 1));
    label = `Q${quarter} ${year}`;
  } else {
    start = new Date(Date.UTC(year, 0, 1));
    end = new Date(Date.UTC(year + 1, 0, 1));
    label = String(year);
  }

  // A week has one cadence whatever month(s) it spans; the others list the months of the period that have started.
  const startedMonths: number[] = [];
  if (kind === "week") startedMonths.push(start.getUTCMonth());
  else {
    for (let m = start.getUTCMonth(); Date.UTC(year, m, 1) < end.getTime() && m < 12; m += 1) {
      if (Date.UTC(year, m, 1) <= todayMs) startedMonths.push(m);
    }
  }
  return { kind, year, quarter, month, week, start, end, label, startedMonths };
}

/** The best cadence an outlet kept up over the period, from the months (0 to 11) it bought in; null when it did not buy. */
export function cadenceFor(monthsBought: ReadonlySet<number>, period: Pick<FrequencyPeriod, "kind" | "startedMonths">): Cadence | null {
  if (monthsBought.size === 0) return null;
  const months = period.startedMonths;
  if (period.kind === "week" || months.length === 0) return "Once Per Month";
  if (months.every((m) => monthsBought.has(m))) return "Once Per Month";
  const everyBlock = (blockOf: (m: number) => number) => {
    const blocks = new Map<number, boolean>();
    for (const m of months) blocks.set(blockOf(m), (blocks.get(blockOf(m)) ?? false) || monthsBought.has(m));
    return [...blocks.values()].every(Boolean);
  };
  if (everyBlock((m) => Math.floor(m / 3))) return "Once in 3 Months";
  if (everyBlock((m) => (m < 6 ? 0 : 1))) return "Once in 6 Months";
  return "Once per Year";
}
