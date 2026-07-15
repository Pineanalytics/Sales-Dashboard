// Shared helpers for the Weekly Targets grid (app/(protected)/weekly-targets),
// replicating WeeklyTargetEntry_MacroSystem.xlsm's week convention: a week belongs
// to the calendar month containing its Monday, labeled "<Mon> Week <n>" in order.
// Real months have 4 or 5 Mondays — unlike the source file, which always shows 5
// (it pre-generated a fixed 5-slot grid regardless of the real calendar), this
// generates exactly as many weeks as the month actually has.
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";

export interface WeekInfo {
  year: string;
  monthLabel: string; // full month name, matches Target.month / CANONICAL_MONTHS
  weekLabel: string; // "Apr Week 1"
  weekStartDate: Date; // UTC midnight, the Monday
}

function toUtcMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

export function getMondaysInMonth(year: number, monthIndex: number): Date[] {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const mondays: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = toUtcMidnight(year, monthIndex, d);
    if (date.getUTCDay() === 1) mondays.push(date);
  }
  return mondays;
}

export function getWeeksInMonth(year: number, monthIndex: number): WeekInfo[] {
  const monthLabel = CANONICAL_MONTHS[monthIndex];
  const abbrev = monthLabel.slice(0, 3);
  return getMondaysInMonth(year, monthIndex).map((weekStartDate, i) => ({
    year: String(year),
    monthLabel,
    weekLabel: `${abbrev} Week ${i + 1}`,
    weekStartDate,
  }));
}

/** All weeks whose Monday falls within [windowStart, windowEnd], spanning
 *  however many real calendar months that range touches. */
export function getWeeksInRange(windowStart: Date, windowEnd: Date): WeekInfo[] {
  const weeks: WeekInfo[] = [];
  let y = windowStart.getUTCFullYear();
  let m = windowStart.getUTCMonth();
  const endY = windowEnd.getUTCFullYear();
  const endM = windowEnd.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    for (const w of getWeeksInMonth(y, m)) {
      if (w.weekStartDate >= windowStart && w.weekStartDate <= windowEnd) weeks.push(w);
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return weeks;
}

/** Lazy grid generation window: from the start of last month through 8 weeks out.
 *  Rows created here persist forever (no locking/deletion) — this only bounds how
 *  far back a *first* visit backfills, not how long a week stays editable. */
export function defaultGridWindow(today: Date = new Date()): { start: Date; end: Date } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const start = toUtcMidnight(y, m - 1, 1);
  const end = new Date(Date.UTC(y, m, today.getUTCDate() + 56));
  return { start, end };
}

export interface AssignmentPair {
  teamLeaderId: string;
  principal: string;
}

export interface WeeklyTargetGridRow {
  teamLeaderId: string;
  principal: string;
  year: string;
  monthLabel: string;
  weekLabel: string;
  weekStartDate: Date;
}

function gridKey(teamLeaderId: string, principal: string, weekStartDate: Date): string {
  return `${teamLeaderId}|${principal}|${weekStartDate.toISOString()}`;
}

/** Pure diff: every (pair, week) combo not already present in `existing`. Split
 *  out from ensureWeeklyTargetGrid so the backfill logic is testable without a
 *  DB connection. */
export function diffMissingGridRows(
  pairs: AssignmentPair[],
  weeks: WeekInfo[],
  existing: { teamLeaderId: string; principal: string; weekStartDate: Date }[]
): WeeklyTargetGridRow[] {
  const existingKeys = new Set(existing.map((e) => gridKey(e.teamLeaderId, e.principal, e.weekStartDate)));
  const toCreate: WeeklyTargetGridRow[] = [];
  for (const pair of pairs) {
    for (const w of weeks) {
      if (!existingKeys.has(gridKey(pair.teamLeaderId, pair.principal, w.weekStartDate))) {
        toCreate.push({ teamLeaderId: pair.teamLeaderId, principal: pair.principal, year: w.year, monthLabel: w.monthLabel, weekLabel: w.weekLabel, weekStartDate: w.weekStartDate });
      }
    }
  }
  return toCreate;
}

/** Creates any missing WeeklyTarget rows (targetValue defaults to 0 / "Pending")
 *  for every (teamLeaderId, principal) pair × every week in the grid window. Safe
 *  to call on every page load — skips pairs/weeks that already have a row via the
 *  (teamLeaderId, principal, weekStartDate) unique constraint. */
export async function ensureWeeklyTargetGrid(pairs: AssignmentPair[]): Promise<void> {
  if (pairs.length === 0) return;
  const { start, end } = defaultGridWindow();
  const weeks = getWeeksInRange(start, end);
  if (weeks.length === 0) return;

  const existing = await prisma.weeklyTarget.findMany({
    where: {
      weekStartDate: { gte: start, lte: end },
      OR: pairs.map((p) => ({ teamLeaderId: p.teamLeaderId, principal: p.principal })),
    },
    select: { teamLeaderId: true, principal: true, weekStartDate: true },
  });

  const toCreate = diffMissingGridRows(pairs, weeks, existing);
  if (toCreate.length === 0) return;

  await prisma.weeklyTarget.createMany({ data: toCreate, skipDuplicates: true });
}

/** Pure sum of WeeklyTarget-shaped rows per (principal, monthLabel), regardless
 *  of which team leader each row belongs to — Target (Monthly) has no
 *  team-leader dimension of its own, so every leader serving a principal is
 *  summed together. */
export function sumWeeklyTargetsByPrincipalMonth(rows: { principal: string; monthLabel: string; targetValue: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.principal}|${r.monthLabel}`;
    map.set(key, (map.get(key) ?? 0) + r.targetValue);
  }
  return map;
}

/** Sum of WeeklyTarget.targetValue per (principal, monthLabel), for the
 *  Monthly Targets page's roll-up/variance display. */
export async function getWeeklyRollupByPrincipalMonth(year: string): Promise<Map<string, number>> {
  const rows = await prisma.weeklyTarget.findMany({ where: { year }, select: { principal: true, monthLabel: true, targetValue: true } });
  return sumWeeklyTargetsByPrincipalMonth(rows);
}

export type MonthlyVarianceStatus = "no-target" | "match" | "variance";

/** Decides the Monthly-vs-Weekly-roll-up badge shown on /weekly-targets:
 *  "no-target" when no admin-entered Monthly Target exists yet for that
 *  principal/month, "match" within a 1-unit rounding tolerance, else
 *  "variance". Pure so the threshold is unit-testable independent of the page. */
export function classifyMonthlyVariance(monthlyValue: number | null, weeklySum: number): MonthlyVarianceStatus {
  if (monthlyValue === null) return "no-target";
  return Math.abs(monthlyValue - weeklySum) < 1 ? "match" : "variance";
}
