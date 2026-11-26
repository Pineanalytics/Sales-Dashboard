// Pine's visit log (pine.users_stats): a row each time a rep opens an outlet in the field app. Sales, orders and no-sales only
// say when something was recorded; a rep's day often starts earlier, at an outlet where nothing is saved until later or at all.
//
// Two things about the log:
//  - us_date keeps a 12-hour clock with no AM/PM (nothing after 12:59 is ever stored). Rows are written as they happen, so their
//    id order is time order, and the one point in a day where the clock steps back from 11:59 to 12:00 is noon. Checked against
//    three months of Pine data (one such step every full day, and no 12-hour disagreement with the no-sale times).
//  - Its GPS is the phone's last fix, often another place, so it cannot confirm the rep was at the outlet. Only the time is used.
import type { Connection, RowDataPacket } from "mysql2/promise";

export interface VisitLogRow {
  id: number;
  userId: string;
  /** "YYYY-MM-DD HH:MM:SS" exactly as stored: Nairobi date, 12-hour clock. */
  logged: string;
}

/** The earliest time of day a log entry counts as a visit. Entries before it are the app being used at night, not a call. */
export const EARLIEST_VISIT_MINUTES = 6 * 60;

/** A past day with no noon step and fewer rows than this can't be told apart as morning or afternoon, so it isn't used. */
export const MIN_ROWS_FOR_ONE_HALF = 20;

const HALF_DAY_SECONDS = 12 * 3600;
/** Rows written within moments of each other may be a little out of order; a real noon step is far bigger. */
const STEP_BACK_SECONDS = 600;

export interface VisitTime {
  userId: string;
  date: string; // YYYY-MM-DD
  /** Nairobi wall clock in a UTC-shaped Date, the way RepCall stores call times. */
  time: Date;
}

/** Works each logged time back to the 24-hour clock. Needs every rep's rows for a day, not one rep's: the noon step is found in
 *  the whole day's stream. */
export function resolveVisitTimes(rows: VisitLogRow[]): VisitTime[] {
  const days = new Map<string, VisitLogRow[]>();
  for (const row of rows) {
    const date = row.logged.slice(0, 10);
    const day = days.get(date);
    if (day) day.push(row);
    else days.set(date, [row]);
  }
  // The newest day is still being written: before noon it rightly has no step, however few its rows.
  const newest = [...days.keys()].sort().at(-1);

  const result: VisitTime[] = [];
  for (const [date, day] of days) {
    day.sort((a, b) => a.id - b.id);
    // Seconds into the half day, with 12:xx as the start of it.
    const halves = day.map((row) => {
      const [hour, minute, second] = row.logged.slice(11).split(":").map(Number);
      return (hour % 12) * 3600 + minute * 60 + second;
    });
    const noon = halves.findIndex((value, i) => i > 0 && value < halves[i - 1] - STEP_BACK_SECONDS);
    if (noon < 0 && date !== newest && day.length < MIN_ROWS_FOR_ONE_HALF) continue;

    const [year, month, dayOfMonth] = date.split("-").map(Number);
    day.forEach((row, i) => {
      const seconds = halves[i] + (noon >= 0 && i >= noon ? HALF_DAY_SECONDS : 0);
      result.push({ userId: row.userId, date, time: new Date(Date.UTC(year, month - 1, dayOfMonth, 0, 0, seconds)) });
    });
  }
  return result;
}

export const repDayKey = (date: string, userId: string) => `${date}|${userId}`;

/** Each rep's first visit of each day, from EARLIEST_VISIT_MINUTES on. */
export function firstVisits(rows: VisitLogRow[]): Map<string, Date> {
  const first = new Map<string, Date>();
  for (const visit of resolveVisitTimes(rows)) {
    if (visit.time.getUTCHours() * 60 + visit.time.getUTCMinutes() < EARLIEST_VISIT_MINUTES) continue;
    const key = repDayKey(visit.date, visit.userId);
    const have = first.get(key);
    if (!have || visit.time < have) first.set(key, visit.time);
  }
  return first;
}

// The log is indexed on its id only, so a date filter alone reads the whole table. Rows are read from a recent id instead, far
// enough back to cover the days asked for.
const FIRST_SPAN = 40_000;
const ROWS_PER_DAY_ALLOWANCE = 8_000;

/** Every rep's log rows for the days from `startDay` up to, not including, `endDay` ("YYYY-MM-DD", Nairobi). Read-only. */
export async function fetchVisitLog(conn: Connection, startDay: string, endDay: string): Promise<VisitLogRow[]> {
  const [newest] = await conn.query<(RowDataPacket & { id: number | null })[]>("SELECT MAX(us_id) AS id FROM pine.users_stats");
  const maxId = Number(newest[0]?.id ?? 0);
  if (!maxId) return [];

  const days = Math.max(1, Math.round((Date.parse(endDay) - Date.parse(startDay)) / 86_400_000));
  let from = Math.max(0, maxId - Math.max(FIRST_SPAN, days * ROWS_PER_DAY_ALLOWANCE));
  // Step further back until the first row read is older than the first day wanted.
  while (from > 0) {
    const [edge] = await conn.query<(RowDataPacket & { day: string })[]>(
      "SELECT DATE_FORMAT(us_date, '%Y-%m-%d') AS day FROM pine.users_stats WHERE us_id > ? ORDER BY us_id LIMIT 1",
      [from]
    );
    if (edge[0] && edge[0].day < startDay) break;
    from = Math.max(0, from - (maxId - from));
  }

  const [rows] = await conn.query<(RowDataPacket & { id: number; userId: number; logged: string })[]>(
    "SELECT us_id AS id, us_uid AS userId, DATE_FORMAT(us_date, '%Y-%m-%d %H:%i:%s') AS logged FROM pine.users_stats WHERE us_id > ? AND us_date >= ? AND us_date < ? ORDER BY us_id",
    [from, startDay, endDay]
  );
  return rows.map((r) => ({ id: Number(r.id), userId: String(r.userId), logged: r.logged }));
}
