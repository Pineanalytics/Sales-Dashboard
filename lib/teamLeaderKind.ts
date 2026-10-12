// What a TeamLeader row really is. Every rep assignment and weekly target in the roster has to belong to some
// TeamLeader row, but only some principals have team leaders (Mars and EABL today). Everywhere else a Sales
// Supervisor runs the principal directly, so the importer created a TeamLeader row named after the supervisor to
// hold the reps and targets. That stand-in is not a team leader and must not be offered as one.
export const TEAM_LEADER_KINDS = ["TEAM_LEADER", "SUPERVISOR_TEAM", "KEY_ACCOUNTS", "FORMER"] as const;
export type TeamLeaderKind = (typeof TEAM_LEADER_KINDS)[number];

export function normalizeTeamLeaderKind(value: string | null | undefined): TeamLeaderKind {
  return (TEAM_LEADER_KINDS as readonly string[]).includes(value ?? "") ? (value as TeamLeaderKind) : "TEAM_LEADER";
}

// "KEY_ACCOUNTS" is a key-accounts rep (Clarrine under Lucy at Mars) who sits in a supervisor's team beside the team
// leaders, carries a fixed target of her own and sells in her own name, with no reps below her. Not a team leader.

/** A real team leader, as opposed to a supervisor's direct team, a key-accounts rep or someone who has left. */
export function isRealTeamLeader(kind: string | null | undefined): boolean {
  return normalizeTeamLeaderKind(kind) === "TEAM_LEADER";
}

/** The name to show: a supervisor's direct team says so, so it is never read as a team leader. */
export function teamLeaderDisplayName(tl: { name: string; kind?: string | null }): string {
  const kind = normalizeTeamLeaderKind(tl.kind);
  return kind === "SUPERVISOR_TEAM" ? `${tl.name} (supervisor's direct team)` : kind === "KEY_ACCOUNTS" ? `${tl.name} (key accounts)` : kind === "FORMER" ? `${tl.name} (former)` : tl.name;
}

/** Names of team leaders that are really a supervisor running the principal directly: the name is the same as the
 *  Sales Supervisor's on every roster row it appears on (case and spacing ignored). */
export function directTeamNamesFromRows(rows: { teamLeader: string; supervisor?: string | null }[]): Set<string> {
  const fold = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const direct = new Map<string, boolean>();
  for (const row of rows) {
    const name = row.teamLeader.trim();
    if (!name) continue;
    const same = !!row.supervisor && fold(row.supervisor) === fold(name);
    direct.set(name, (direct.get(name) ?? true) && same);
  }
  return new Set([...direct].filter(([, isDirect]) => isDirect).map(([name]) => name));
}

export interface KindedTeamLeader {
  kind?: string | null;
}

/** Splits a list for a dropdown: real team leaders, supervisors' direct teams, and (only on request) former leaders. */
export function groupTeamLeadersByKind<T extends KindedTeamLeader>(teamLeaders: T[], options: { includeFormer?: boolean } = {}): { teamLeaders: T[]; directTeams: T[]; keyAccounts: T[]; former: T[] } {
  const grouped = { teamLeaders: [] as T[], directTeams: [] as T[], keyAccounts: [] as T[], former: [] as T[] };
  for (const tl of teamLeaders) {
    const kind = normalizeTeamLeaderKind(tl.kind);
    if (kind === "TEAM_LEADER") grouped.teamLeaders.push(tl);
    else if (kind === "SUPERVISOR_TEAM") grouped.directTeams.push(tl);
    else if (kind === "KEY_ACCOUNTS") grouped.keyAccounts.push(tl);
    else if (options.includeFormer) grouped.former.push(tl);
  }
  return grouped;
}

export const TEAM_LEADER_GROUP_LABELS = {
  teamLeaders: "Team Leaders",
  directTeams: "Supervisors' direct teams (no team leader)",
  keyAccounts: "Key accounts",
  former: "Former",
} as const;
