// A Sales Supervisor who runs a team of leaders (Lucy over Mars's six) holds the principal's whole target, like every other
// supervisor, and her leaders share it out by territory. The shares are stored as each leader's own weekly targets (and
// the key-accounts rep's on the supervisor's own row), so the supervisor's figure is the sum of her team's rows: nothing
// is stored twice and the weeks still add up to the monthly target. This builds that roll-up for the Weekly Targets page.

export interface RosterRow {
  id: string;
  name: string;
  kind: string;
  supervisorId: string | null;
}

/** supervisor row id -> [her own row, ...the leader rows under her], for supervisors who have leaders below them. */
export function supervisorTeamRows(rows: RosterRow[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    if (row.kind !== "SUPERVISOR_TEAM" || !row.supervisorId) continue;
    const leaders = rows.filter((r) => (r.kind === "TEAM_LEADER" || r.kind === "KEY_ACCOUNTS") && r.supervisorId === row.supervisorId).map((r) => r.id);
    if (leaders.length > 0) result.set(row.id, [row.id, ...leaders]);
  }
  return result;
}

export interface TeamWeekly {
  teamLeaderId: string;
  principal: string;
  weekStart: string;
  targetValue: number;
}
export interface TeamRep {
  teamLeaderId: string;
  principal: string;
  employeeCode: string;
  employeeName: string;
  channel: string | null;
  contributionPct: number | null;
}
export interface TeamDaily {
  teamLeaderId: string;
  principal: string;
  employeeCode: string;
  total: number;
}

export interface TeamBreakdownRep {
  employeeCode: string;
  employeeName: string;
  channel: string | null;
  contributionPct: number | null;
  monthDailyTotal: number;
}
export interface TeamBreakdownMember {
  teamLeaderId: string;
  label: string;
  role: "Team Leader" | "Key accounts" | "Direct team";
  weekValues: number[];
  total: number;
  sharePct: number;
  reps: TeamBreakdownRep[];
}
export interface TeamBreakdownPrincipal {
  principal: string;
  weekTotals: number[];
  total: number;
  members: TeamBreakdownMember[];
}

/** Per principal: each member's weekly figures for the viewed month, month total and share of the principal's total, with the
 *  reps that represent them. The supervisor's own row (when it has reps of its own) is named after them. Members with no
 *  target and no reps on a principal are left out. */
export function buildTeamBreakdown(input: {
  memberIds: string[];
  roster: RosterRow[];
  supervisorRowId: string;
  weekStarts: string[];
  weekly: TeamWeekly[];
  reps: TeamRep[];
  daily: TeamDaily[];
}): TeamBreakdownPrincipal[] {
  const rosterById = new Map(input.roster.map((r) => [r.id, r]));
  const principals = [...new Set([...input.weekly.filter((w) => w.targetValue !== 0).map((w) => w.principal), ...input.reps.map((r) => r.principal)])].sort();
  const result: TeamBreakdownPrincipal[] = [];
  for (const principal of principals) {
    const members: TeamBreakdownMember[] = [];
    for (const id of input.memberIds) {
      const weekValues = input.weekStarts.map((start) =>
        input.weekly.filter((w) => w.teamLeaderId === id && w.principal === principal && w.weekStart === start).reduce((s, w) => s + w.targetValue, 0)
      );
      const total = weekValues.reduce((a, b) => a + b, 0);
      const reps = input.reps
        .filter((r) => r.teamLeaderId === id && r.principal === principal)
        .map((r) => ({
          employeeCode: r.employeeCode,
          employeeName: r.employeeName,
          channel: r.channel,
          contributionPct: r.contributionPct,
          monthDailyTotal: input.daily.filter((d) => d.teamLeaderId === id && d.principal === principal && d.employeeCode === r.employeeCode).reduce((s, d) => s + d.total, 0),
        }))
        .sort((a, b) => (b.contributionPct ?? 0) - (a.contributionPct ?? 0));
      if (total === 0 && reps.length === 0) continue;
      const isOwn = id === input.supervisorRowId;
      members.push({
        teamLeaderId: id,
        label: isOwn ? reps.map((r) => r.employeeName).join(", ") || rosterById.get(id)?.name || id : rosterById.get(id)?.name ?? id,
        role: isOwn ? "Direct team" : rosterById.get(id)?.kind === "KEY_ACCOUNTS" ? "Key accounts" : "Team Leader",
        weekValues,
        total,
        sharePct: 0,
        reps,
      });
    }
    const total = members.reduce((s, m) => s + m.total, 0);
    for (const m of members) m.sharePct = total > 0 ? m.total / total : 0;
    // Leaders by size, then the key-accounts rep and any direct team.
    members.sort((a, b) => Number(a.role !== "Team Leader") - Number(b.role !== "Team Leader") || b.total - a.total);
    if (members.length === 0) continue;
    result.push({ principal, weekTotals: input.weekStarts.map((_, i) => members.reduce((s, m) => s + m.weekValues[i], 0)), total, members });
  }
  return result;
}
