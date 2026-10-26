// The pure part of the cleanup progress: turning each team's counts into percentages, the share of the target reached and a rank.
export const DEFAULT_TARGET_PCT = 100;

export interface TeamProgress {
  teamLeader: string;
  outlets: number;
  reviewed: number;
  validated: number;
  missingGeo: number;
  geoTagged: number;
  repsValidated: number;
  disowned: number;
  /** Share of the team's outlets reviewed, 0-100. */
  pctReviewed: number;
  targetPct: number;
  /** pctReviewed as a share of the target, 0-100 (capped); what the teams are ranked on. */
  attainment: number;
  rank: number;
}

export interface RawTeamCounts {
  teamLeader: string;
  outlets: number;
  reviewed: number;
  validated: number;
  missingGeo: number;
  geoTagged: number;
  repsValidated: number;
  disowned: number;
}

export const foldName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Teams with their % reviewed, the share of their target reached and a rank: highest share of target first, then most outlets reviewed; equal on both share a rank. */
export function rankTeams(raw: readonly RawTeamCounts[], targets: { defaultPct: number; byTeam: ReadonlyMap<string, number> }): TeamProgress[] {
  const teams: TeamProgress[] = raw.map((r) => {
    const targetPct = targets.byTeam.get(foldName(r.teamLeader)) ?? targets.defaultPct;
    const pctReviewed = pct(r.reviewed, r.outlets);
    return { ...r, pctReviewed, targetPct, attainment: targetPct > 0 ? Math.min(100, Math.round((pctReviewed / targetPct) * 1000) / 10) : 100, rank: 0 };
  });
  teams.sort((a, b) => b.attainment - a.attainment || b.reviewed - a.reviewed || a.teamLeader.localeCompare(b.teamLeader));
  teams.forEach((team, index) => {
    const tied = index > 0 && teams[index - 1].attainment === team.attainment && teams[index - 1].reviewed === team.reviewed;
    team.rank = tied ? teams[index - 1].rank : index + 1;
  });
  return teams;
}
