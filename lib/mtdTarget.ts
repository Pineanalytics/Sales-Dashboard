// True month-to-date Target per Team Leader, for TL/Supervisor/Manager Ranking.
//
// buildTlRanking's mtdTarget used to be a straight sum of every WeeklyTarget row
// for the selected month (all weeks, including ones that haven't started yet) —
// really a FULL-MONTH target mislabeled "MTD." MTD Revenue, by contrast, is
// naturally bounded to elapsed days (it's real sales, and there's no sales data
// for days that haven't happened). Comparing a full-month target against a
// partial-month revenue figure understates achievement% for every row early in
// the month, and can even push a Supervisor's summed MTD Target above their own
// group's full-month principal target (confirmed live: Richard/EABL-Nyeri showed
// a 150.1M "MTD Target" against an 87.4M full-August target).
//
// DailyTarget already exists precisely to solve this: recomputeDailyTargets
// (lib/repContribution.ts) expands every WeeklyTarget row into weekday-weighted
// per-day amounts across the whole month, at Team-Leader grain. Summing only the
// days from the 1st through today gives a genuine "how much should we have sold
// by now" figure instead of the whole month's target.
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";

export interface MtdTargetRow {
  teamLeaderId: string;
  targetValue: number;
}

/** Sums DailyTarget.targetValue per Team Leader for `year`/`monthLabel`, capped at
 *  today (inclusive) — a month still in progress only counts its elapsed days; a
 *  month that has fully passed counts every day (the cap has no effect); a month
 *  entirely in the future returns nothing per Team Leader. UTC calendar days,
 *  matching the UTC-midnight convention WeeklyTarget.weekStartDate/DailyTarget.date
 *  already use elsewhere (lib/weeklyTargets.ts). */
export async function getMtdTargetByTeamLeader(year: string, monthLabel: string, principal?: string | null): Promise<MtdTargetRow[]> {
  const monthIndex = CANONICAL_MONTHS.indexOf(monthLabel);
  if (monthIndex < 0) return [];

  const monthStart = new Date(Date.UTC(Number(year), monthIndex, 1));
  const monthEnd = new Date(Date.UTC(Number(year), monthIndex + 1, 1));
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const cappedEnd = tomorrow < monthEnd ? tomorrow : monthEnd;

  const rows = await prisma.dailyTarget.groupBy({
    by: ["teamLeaderId"],
    where: { date: { gte: monthStart, lt: cappedEnd }, ...(principal ? { principal } : {}) },
    _sum: { targetValue: true },
  });
  return rows.map((r) => ({ teamLeaderId: r.teamLeaderId, targetValue: r._sum.targetValue ?? 0 }));
}
