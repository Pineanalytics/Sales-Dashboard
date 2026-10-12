// Rebuilds a year's weekly targets from the monthly targets, for the current roster structure.
//
// Weekly targets are held per team leader row, principal and week (WeeklyTarget). After the October 2026 restructure
// (lib/orgRestructure.ts) the rows that carried each principal's plan no longer match who runs it: Mars's figures sat on
// the supervisor's row, Suntory's on a team leader row deleted months ago, and each week existed twice (a Sunday-start
// and a legacy Monday-start row), which doubled every weekly sum. This plans, per principal and month:
//
//  - the month's weeks are the Sunday-start weeks that begin in that month (the sales calendar since 20 Aug);
//  - the monthly target is split across the people who run the principal, in proportion to the revenue share of the reps
//    they lead (the same share the daily projection uses), so what a leader is asked to deliver matches their team;
//  - each leader's part is phased across the weeks the way the plan was already phased (the existing weekly figures,
//    summed over every row of that principal, orphaned ones included), or evenly where there is no phasing to keep;
//  - every other row of the principal (a leaver, a stand-in that no longer carries reps, an orphan) is set to zero, and so
//    is every legacy Monday-start duplicate, so the weeks add up to the monthly target exactly.
// Pure: no I/O. scripts/weekly-rebuild-2026-10.ts reads the data, runs this and applies the result.
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_MS = 86_400_000;

export interface WeeklyRow {
  id: string;
  teamLeaderId: string;
  principal: string;
  monthLabel: string;
  weekLabel: string;
  /** The week's first day, YYYY-MM-DD. */
  start: string;
  value: number;
}

export interface MonthlyTargetRow {
  principal: string;
  month: string;
  value: number | null;
}

export interface Recipient {
  teamLeaderId: string;
  /** Relative weight: the summed revenue share of the reps this leader has on the principal. */
  weight: number;
  /** A fixed amount per month taken off the top before the rest is shared by weight (the key-accounts target). */
  fixedMonthly?: number;
}

/** Monthly target the key-accounts rep carries on a principal, by default every month; the leaders share the rest. */
export const KEY_ACCOUNT_MONTHLY_TARGETS: Record<string, number> = { "Mars-Nairobi": 40_000_000 };

export interface CalendarWeek {
  start: string;
  month: string;
  label: string;
}

export interface RowUpdate {
  id: string;
  teamLeaderId: string;
  principal: string;
  start: string;
  oldValue: number;
  newValue: number;
  month: string;
  label: string;
  relabel: boolean;
}

export interface RowInsert {
  teamLeaderId: string;
  principal: string;
  start: string;
  newValue: number;
  month: string;
  label: string;
}

export interface PrincipalMonthTotal {
  principal: string;
  month: string;
  target: number;
  planned: number;
}

export interface RebuildPlan {
  updates: RowUpdate[];
  inserts: RowInsert[];
  /** Principal-months with a target but nobody to carry it: left untouched. */
  unplaced: string[];
  mondayZeroed: number;
  totals: PrincipalMonthTotal[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const time = (s: string) => Date.parse(`${s}T00:00:00Z`);
const dayOfWeek = (s: string) => new Date(time(s)).getUTCDay();

function weekStartsInMonth(year: number, monthIndex: number): number[] {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const starts = new Set<number>();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    starts.add(Date.UTC(year, monthIndex, day - date.getUTCDay()));
  }
  return [...starts].sort((a, b) => a - b);
}

/** The sales calendar's weeks for a year: Sunday-start, each belonging to the month it starts in, numbered as the Weekly
 *  Targets grid numbers them (its position in that month's own list of weeks). */
export function canonicalWeeks(year: number): CalendarWeek[] {
  const weeks: CalendarWeek[] = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const list = weekStartsInMonth(year, monthIndex);
    for (const start of list) {
      const date = new Date(start);
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex) continue;
      weeks.push({ start: iso(start), month: MONTH_NAMES[monthIndex], label: `${MONTH_NAMES[monthIndex].slice(0, 3)} Week ${list.indexOf(start) + 1}` });
    }
  }
  return weeks;
}

export function planWeeklyRebuild(input: { year: number; weekly: WeeklyRow[]; monthly: MonthlyTargetRow[]; recipientsByPrincipal: Map<string, Recipient[]> }): RebuildPlan {
  const { year, weekly, monthly, recipientsByPrincipal } = input;
  const calendar = canonicalWeeks(year);
  const weeksByMonth = new Map(MONTH_NAMES.map((m) => [m, calendar.filter((w) => w.month === m)]));

  const sundayRows = weekly.filter((r) => dayOfWeek(r.start) === 0);
  const mondayRows = weekly.filter((r) => dayOfWeek(r.start) === 1);
  const key = (teamLeaderId: string, principal: string, start: string) => `${teamLeaderId}|${principal}|${start}`;
  const sundayIndex = new Map(sundayRows.map((r) => [key(r.teamLeaderId, r.principal, r.start), r]));
  // a Monday row belongs to the Sunday week one day earlier
  const mondayIndex = new Map(mondayRows.map((r) => [key(r.teamLeaderId, r.principal, iso(time(r.start) - DAY_MS)), r]));

  const monthlyByKey = new Map(monthly.map((m) => [`${m.principal}|${m.month}`, m.value ?? 0]));
  const principals = [...new Set(monthly.map((m) => m.principal))];

  const plan: RebuildPlan = { updates: [], inserts: [], unplaced: [], mondayZeroed: 0, totals: [] };

  for (const principal of principals) {
    const tlsWithRows = [...new Set(weekly.filter((r) => r.principal === principal).map((r) => r.teamLeaderId))];
    const recipients = recipientsByPrincipal.get(principal) ?? [];

    for (const month of MONTH_NAMES) {
      const target = monthlyByKey.get(`${principal}|${month}`) ?? 0;
      const weeks = weeksByMonth.get(month) ?? [];

      // The plan's existing phasing: each row-holder's own Sunday figures, or their Monday-start figures where they have no
      // Sunday ones, added up across everyone (orphaned rows included).
      const phasing = weeks.map(() => 0);
      for (const teamLeaderId of tlsWithRows) {
        const sunday = weeks.map((w) => sundayIndex.get(key(teamLeaderId, principal, w.start))?.value ?? 0);
        const legacy = weeks.map((w) => mondayIndex.get(key(teamLeaderId, principal, w.start))?.value ?? 0);
        const values = sunday.some((v) => v > 0) ? sunday : legacy;
        values.forEach((v, i) => (phasing[i] += Math.max(0, v)));
      }
      const phasingTotal = phasing.reduce((a, b) => a + b, 0);

      const cells = new Map<string, number>();
      if (target > 0) {
        if (recipients.length === 0) {
          plan.unplaced.push(`${principal} ${month}`);
          continue;
        }
        // Fixed amounts (key accounts) come off the top, capped at the target; the leaders share what is left by weight.
        const fixed = recipients.filter((r) => r.fixedMonthly !== undefined);
        const weighted = recipients.filter((r) => r.fixedMonthly === undefined);
        const fixedAsked = fixed.reduce((s, r) => s + Math.max(0, r.fixedMonthly ?? 0), 0);
        const fixedTotal = Math.min(target, fixedAsked);
        const shared = target - fixedTotal;
        if (shared > 0 && weighted.length === 0) {
          plan.unplaced.push(`${principal} ${month}`);
          continue;
        }
        const phaseOf = (i: number) => (phasingTotal > 0 ? phasing[i] / phasingTotal : 1 / weeks.length);
        for (const recipient of fixed) {
          const amount = fixedAsked > 0 ? (Math.max(0, recipient.fixedMonthly ?? 0) / fixedAsked) * fixedTotal : 0;
          weeks.forEach((_, i) => cells.set(`${recipient.teamLeaderId}|${i}`, r2(amount * phaseOf(i))));
        }
        const weightTotal = weighted.reduce((s, r) => s + Math.max(0, r.weight), 0);
        for (const recipient of weighted) {
          const share = weightTotal > 0 ? Math.max(0, recipient.weight) / weightTotal : 1 / weighted.length;
          weeks.forEach((_, i) => cells.set(`${recipient.teamLeaderId}|${i}`, r2(shared * share * phaseOf(i))));
        }
        // exact total: the rounding residual goes on the largest cell
        const residual = r2(target - [...cells.values()].reduce((a, b) => a + b, 0));
        if (residual !== 0 && cells.size > 0) {
          let largest = "";
          for (const [cellKey, value] of cells) if (largest === "" || value > (cells.get(largest) ?? 0)) largest = cellKey;
          cells.set(largest, r2((cells.get(largest) ?? 0) + residual));
        }
      }

      const holders = new Set([...tlsWithRows, ...recipients.map((r) => r.teamLeaderId)]);
      for (const teamLeaderId of holders) {
        weeks.forEach((week, i) => {
          const newValue = cells.get(`${teamLeaderId}|${i}`) ?? 0;
          const row = sundayIndex.get(key(teamLeaderId, principal, week.start));
          if (row) {
            const relabel = row.monthLabel !== week.month || row.weekLabel !== week.label;
            if (r2(row.value) !== newValue || relabel) {
              plan.updates.push({ id: row.id, teamLeaderId, principal, start: week.start, oldValue: row.value, newValue, month: week.month, label: week.label, relabel });
            }
          } else if (newValue > 0) {
            plan.inserts.push({ teamLeaderId, principal, start: week.start, newValue, month: week.month, label: week.label });
          }
        });
      }
      plan.totals.push({ principal, month, target, planned: r2([...cells.values()].reduce((a, b) => a + b, 0)) });
    }
  }

  // the legacy Monday-start duplicates, whatever the principal
  for (const row of mondayRows) {
    if (row.value === 0) continue;
    plan.updates.push({ id: row.id, teamLeaderId: row.teamLeaderId, principal: row.principal, start: row.start, oldValue: row.value, newValue: 0, month: row.monthLabel, label: row.weekLabel, relabel: false });
    plan.mondayZeroed += 1;
  }
  return plan;
}
