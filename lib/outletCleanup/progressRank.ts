// The pure part of the cleanup progress: turning each team's counts into percentages, the share of the target reached and a rank.
// The target is measured on active outlets only: the share of a team's active outlets (bought in the last 90 days) that have been reviewed. Dormant outlets can still be
// reviewed but count neither for nor against the target.
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
  /** Outlets still buying (bought in the last 90 days) and the dormant rest (older purchase or none on record). */
  active: number;
  dormant: number;
  /** Active outlets that have been reviewed (the numerator of the target). */
  reviewedActive: number;
  /** Share of the team's ACTIVE outlets reviewed, 0-100: what the target is measured against. */
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
  active: number;
  dormant: number;
  reviewedActive: number;
}

export const foldName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Teams with their % of active outlets reviewed, the share of their target reached and a rank: highest share of target first, then most active outlets reviewed; equal on both share a rank. A team with no active outlets has nothing outstanding (100%) but is ranked after every team that has some. */
export function rankTeams(raw: readonly RawTeamCounts[], targets: { defaultPct: number; byTeam: ReadonlyMap<string, number> }): TeamProgress[] {
  const teams: TeamProgress[] = raw.map((r) => {
    const targetPct = targets.byTeam.get(foldName(r.teamLeader)) ?? targets.defaultPct;
    const pctReviewed = pct(r.reviewedActive, r.active);
    const attainment = r.active === 0 || targetPct <= 0 ? 100 : Math.min(100, Math.round((pctReviewed / targetPct) * 1000) / 10);
    return { ...r, pctReviewed, targetPct, attainment, rank: 0 };
  });
  teams.sort((a, b) => Number(b.active > 0) - Number(a.active > 0) || b.attainment - a.attainment || b.reviewedActive - a.reviewedActive || a.teamLeader.localeCompare(b.teamLeader));
  teams.forEach((team, index) => {
    const tied = index > 0 && teams[index - 1].attainment === team.attainment && teams[index - 1].reviewedActive === team.reviewedActive;
    team.rank = tied ? teams[index - 1].rank : index + 1;
  });
  return teams;
}
