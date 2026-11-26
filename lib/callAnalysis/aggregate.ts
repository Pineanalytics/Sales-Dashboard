// The call analysis arithmetic: rep-day facts in, grouped figures out. No database here, so it is directly testable.
import { isKenyaWorkingDay } from "@/lib/kenyaBusinessCalendar";
import { CALL_SOURCE_LABELS, type CallGroupBy, type CallMetrics, type CallOption, type CallRoleFilter, type CallRow, type RepDayFact } from "./types";

/** A first call after this is late: the same 9:30 AM rule as the Timestamps report (lib/timeManagement.ts). */
export const LATE_START_AFTER_MINUTES = 9 * 60 + 30;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const round1 = (value: number) => Math.round(value * 10) / 10;
const ratio = (top: number, bottom: number, scale = 1): number | null => (bottom > 0 ? round1((top / bottom) * scale) : null);
const average = (values: number[]): number | null => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);

export function dayLabel(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  return `${WEEKDAYS[value.getUTCDay()]} ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}

/** The Monday of the week a date falls in. */
export function weekStart(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export function measure(facts: RepDayFact[]): CallMetrics {
  const reps = new Set<string>();
  // Coverage counts different outlets, and the same outlets come round every month: count within each month, then average the months.
  const covered = new Map<string, Set<string>>();
  const bought = new Map<string, Set<string>>();
  let calls = 0;
  let measuredProductive = 0;
  let anyCalls = false;
  let productive = 0;
  let lines = 0;
  let linesCalls = 0;
  let value = 0;
  let cases = 0;
  let casesCalls = 0;
  let intervalSum = 0;
  let intervalCount = 0;

  for (const f of facts) {
    reps.add(f.repKey);
    const month = f.date.slice(0, 7);
    let monthCovered = covered.get(month);
    if (!monthCovered) covered.set(month, (monthCovered = new Set()));
    for (const outlet of f.outlets) monthCovered.add(`${f.source}:${outlet}`);
    let monthBought = bought.get(month);
    if (!monthBought) bought.set(month, (monthBought = new Set()));
    for (const outlet of f.productiveOutlets) monthBought.add(`${f.source}:${outlet}`);

    if (f.calls !== null) {
      anyCalls = true;
      calls += f.calls;
      measuredProductive += f.productive;
    }
    productive += f.productive;
    lines += f.lines;
    linesCalls += f.linesCalls;
    value += f.value;
    cases += f.cases;
    casesCalls += f.casesCalls;
    intervalSum += f.intervalSum;
    intervalCount += f.intervalCount;
  }

  // Times: a weekend or holiday with a stray call would drag a rep's usual start and close, so they are left out of the averages
  // whenever the selection has working days (the same rule as the Timestamps report). A selection of only such days still shows them.
  const timed = facts.filter((f) => f.firstMinutes !== null);
  const working = timed.filter((f) => isKenyaWorkingDay(f.date));
  const forTimes = working.length > 0 ? working : timed;
  const starts = forTimes.map((f) => f.firstMinutes as number);
  const closes = forTimes.filter((f) => f.lastMinutes !== null).map((f) => f.lastMinutes as number);
  const hours = forTimes.filter((f) => f.lastMinutes !== null).map((f) => ((f.lastMinutes as number) - (f.firstMinutes as number)) / 60);
  const avgHours = average(hours);

  const monthAverage = (sets: Map<string, Set<string>>) => Math.round(average([...sets.values()].map((set) => set.size)) ?? 0);
  const repDays = facts.length;
  const measuredDays = facts.filter((f) => f.calls !== null).length;

  return {
    reps: reps.size,
    repDays,
    avgStartMinutes: average(starts),
    avgCloseMinutes: average(closes),
    avgHours: avgHours === null ? null : round1(avgHours),
    lateStartPct: ratio(starts.filter((m) => m > LATE_START_AFTER_MINUTES).length, starts.length, 100),
    avgIntervalMins: ratio(intervalSum, intervalCount),
    calls: anyCalls ? calls : null,
    callsPerRepDay: anyCalls ? ratio(calls, measuredDays) : null,
    productive,
    productivePerRepDay: ratio(productive, repDays),
    strikeRatePct: anyCalls ? ratio(measuredProductive, calls, 100) : null,
    coverage: monthAverage(covered),
    productiveCoverage: monthAverage(bought),
    lppc: ratio(lines, linesCalls),
    lppcDataPct: ratio(linesCalls, productive, 100),
    value: Math.round(value),
    dropSizeValue: productive > 0 ? Math.round(value / productive) : null,
    cases: casesCalls > 0 ? round1(cases) : null,
    dropSizeCases: casesCalls > 0 ? Math.round((cases / casesCalls) * 100) / 100 : null,
    casesDataPct: ratio(casesCalls, productive, 100),
  };
}

interface GroupIdentity {
  key: string;
  label: string;
}

function identify(fact: RepDayFact, groupBy: CallGroupBy): GroupIdentity {
  switch (groupBy) {
    case "day":
      return { key: fact.date, label: dayLabel(fact.date) };
    case "week": {
      const monday = weekStart(fact.date);
      return { key: monday, label: `Week of ${dayLabel(monday).slice(4)}` };
    }
    case "month": {
      const key = fact.date.slice(0, 7);
      return { key, label: `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}` };
    }
    case "rep":
      return { key: fact.repKey, label: fact.repName };
    case "principal":
      return { key: fact.principalKey, label: fact.principal };
    case "teamLeader":
      return { key: fact.teamLeader, label: fact.teamLeader };
    case "source":
      return { key: fact.source, label: CALL_SOURCE_LABELS[fact.source] };
    case "repDay":
      return { key: `${fact.date}|${fact.repKey}`, label: fact.repName };
  }
}

const TIME_GROUPS: ReadonlySet<CallGroupBy> = new Set(["day", "week", "month"]);

export function groupFacts(facts: RepDayFact[], groupBy: CallGroupBy): CallRow[] {
  const groups = new Map<string, { identity: GroupIdentity; facts: RepDayFact[] }>();
  for (const fact of facts) {
    const identity = identify(fact, groupBy);
    const group = groups.get(identity.key);
    if (group) group.facts.push(fact);
    else groups.set(identity.key, { identity, facts: [fact] });
  }

  const rows = [...groups.values()].map(({ identity, facts: own }): CallRow => {
    const first = own[0];
    const detail =
      groupBy === "rep"
        ? `${first.principal} · ${first.teamLeader} · ${CALL_SOURCE_LABELS[first.source]}`
        : groupBy === "repDay"
          ? `${dayLabel(first.date)} · ${first.principal}`
          : null;
    return { key: identity.key, label: identity.label, detail, ...measure(own) };
  });

  // Dates read in order; everything else leads with who did the most.
  if (TIME_GROUPS.has(groupBy)) return rows.sort((a, b) => a.key.localeCompare(b.key));
  if (groupBy === "repDay") return rows.sort((a, b) => b.key.slice(0, 10).localeCompare(a.key.slice(0, 10)) || a.label.localeCompare(b.label));
  return rows.sort((a, b) => b.productive - a.productive || a.label.localeCompare(b.label));
}

export interface FactFilters {
  repKey: string | null;
  teamLeader: string | null;
  role: CallRoleFilter;
}

export function filterFacts(facts: RepDayFact[], filters: FactFilters): RepDayFact[] {
  return facts.filter(
    (f) =>
      (!filters.repKey || f.repKey === filters.repKey) &&
      (!filters.teamLeader || f.teamLeader === filters.teamLeader) &&
      (filters.role === "all" || f.role === filters.role)
  );
}

export function filterOptions(facts: RepDayFact[]): { reps: CallOption[]; teamLeaders: string[]; principals: CallOption[] } {
  const reps = new Map<string, string>();
  const teamLeaders = new Set<string>();
  const principals = new Map<string, string>();
  for (const f of facts) {
    reps.set(f.repKey, `${f.repName} (${f.principal})`);
    teamLeaders.add(f.teamLeader);
    principals.set(f.principalKey, f.principal);
  }
  const sorted = (map: Map<string, string>) => [...map].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  return { reps: sorted(reps), teamLeaders: [...teamLeaders].sort((a, b) => a.localeCompare(b)), principals: sorted(principals) };
}
