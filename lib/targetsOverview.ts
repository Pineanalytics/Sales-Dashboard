import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { TeamLeaderScope } from "./teamLeaderScope";
import { CANONICAL_MONTHS } from "./timeIntelligence";

export interface TargetsOverviewFilters {
  year: string;
  month?: string; // omitted/"" = every month in the year
  principal?: string;
  teamLeaderId?: string;
  employeeCode?: string;
  region?: string;
}

// Grain: (principal, month) — the same grain Target itself is stored at.
// Edited via updateTargetValueAction (app/(protected)/targets-overview/actions.ts).
export interface TargetsOverviewTargetRow {
  principal: string;
  year: string;
  month: string;
  monthIndex: number;
  valueTarget: number | null;
  volumeTarget: number | null;
  coverageTarget: number | null;
  productivityTarget: number | null;
  // How many distinct active Team Leaders (including any editing this row) are
  // assigned to this principal — >1 means an edit here affects other Team
  // Leaders too. Computed company-wide, not scope-limited, since the effect
  // of an edit isn't limited to what the viewer can see.
  sharedWithTeamLeaderCount: number;
}

// Grain: one row per active TeamLeaderAssignment — a rep's own roster entry
// under one Team Leader + Principal. Edited via updateAssignmentMetadataAction.
export interface TargetsOverviewRosterRow {
  assignmentId: string;
  employeeCode: string;
  employeeName: string;
  teamLeaderId: string;
  teamLeaderName: string;
  principal: string;
  channel: string | null;
  region: string | null;
  subRegion: string | null;
  contributionPct: number | null;
  // Read-only reference, mirroring the source workbook's own "Employee
  // Monthly Pro-Rata (ref)" column — only meaningful when exactly one month
  // is selected (a roster row has no month dimension of its own), null
  // otherwise.
  employeeProRataValue: number | null;
}

export interface TargetsOverviewResult {
  targetRows: TargetsOverviewTargetRow[];
  rosterRows: TargetsOverviewRosterRow[];
  principals: string[];
  teamLeaders: { id: string; name: string }[];
  regions: string[];
}

/** Joins active TeamLeaderAssignment rows (rep × principal roster, TL-scoped
 *  when `scope` is non-null — see lib/teamLeaderScope.ts) against the
 *  matching Target row(s) for the selected year/month(s). Returns two
 *  separate row sets rather than one flattened join, since Target values live
 *  at (principal, month) grain and roster metadata lives at (assignment)
 *  grain — flattening them into one editable table would make one "Save"
 *  ambiguously affect every rep sharing that principal/month. Genuinely new
 *  query logic: lib/weeklyTargets.ts's rollups are TL+principal grain, not
 *  per-employee, so there's nothing to reuse there. */
export async function getTargetsOverview(filters: TargetsOverviewFilters, scope: TeamLeaderScope | null): Promise<TargetsOverviewResult> {
  const conditions: Prisma.TeamLeaderAssignmentWhereInput[] = [{ active: true }];
  if (scope) conditions.push({ employeeCode: { in: scope.employeeCodes } });
  if (filters.principal) conditions.push({ principal: filters.principal });
  if (filters.teamLeaderId) conditions.push({ teamLeaderId: filters.teamLeaderId });
  if (filters.employeeCode) conditions.push({ employeeCode: filters.employeeCode });
  if (filters.region) conditions.push({ region: filters.region });

  const [assignments, allActiveAssignments, teamLeadersAll] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({ where: { AND: conditions }, orderBy: [{ principal: "asc" }, { employeeName: "asc" }] }),
    // Company-wide (unscoped) — feeds the shared-principal count and, for an
    // admin viewer, the Principal/Region dropdown options. An edit's effect
    // isn't limited to what the current viewer can see, so this stays
    // unscoped regardless of `scope`.
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { principal: true, teamLeaderId: true, region: true } }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
  ]);

  const teamLeaderNameById = new Map(teamLeadersAll.map((tl) => [tl.id, tl.name]));

  const tlSetByPrincipal = new Map<string, Set<string>>();
  for (const a of allActiveAssignments) {
    if (!tlSetByPrincipal.has(a.principal)) tlSetByPrincipal.set(a.principal, new Set());
    tlSetByPrincipal.get(a.principal)!.add(a.teamLeaderId);
  }

  const principalsNeeded = Array.from(new Set(assignments.map((a) => a.principal)));
  const monthsNeeded = filters.month ? [filters.month] : CANONICAL_MONTHS;

  const targets = principalsNeeded.length
    ? await prisma.target.findMany({ where: { year: filters.year, month: { in: monthsNeeded }, principal: { in: principalsNeeded } } })
    : [];
  const targetByKey = new Map(targets.map((t) => [`${t.year}|${t.month}|${t.principal}`, t]));

  const targetRows: TargetsOverviewTargetRow[] = [];
  for (const principal of principalsNeeded) {
    for (const month of monthsNeeded) {
      const monthIndex = CANONICAL_MONTHS.indexOf(month);
      const target = targetByKey.get(`${filters.year}|${month}|${principal}`) ?? null;
      targetRows.push({
        principal,
        year: filters.year,
        month,
        monthIndex,
        valueTarget: target?.valueTarget ?? null,
        volumeTarget: target?.volumeTarget ?? null,
        coverageTarget: target?.coverageTarget ?? null,
        productivityTarget: target?.productivityTarget ?? null,
        sharedWithTeamLeaderCount: tlSetByPrincipal.get(principal)?.size ?? 1,
      });
    }
  }
  targetRows.sort((a, b) => a.principal.localeCompare(b.principal) || a.monthIndex - b.monthIndex);

  // Pro-rata only makes sense against a single month's Target (a roster row
  // has no month dimension of its own) — computed only when exactly one
  // month is selected.
  const singleMonth = filters.month ?? null;
  const rosterRows: TargetsOverviewRosterRow[] = assignments.map((a) => {
    const target = singleMonth ? targetByKey.get(`${filters.year}|${singleMonth}|${a.principal}`) ?? null : null;
    const employeeProRataValue = target?.valueTarget != null && a.contributionPct != null ? target.valueTarget * a.contributionPct : null;
    return {
      assignmentId: a.id,
      employeeCode: a.employeeCode,
      employeeName: a.employeeName,
      teamLeaderId: a.teamLeaderId,
      teamLeaderName: teamLeaderNameById.get(a.teamLeaderId) ?? "—",
      principal: a.principal,
      channel: a.channel,
      region: a.region,
      subRegion: a.subRegion,
      contributionPct: a.contributionPct,
      employeeProRataValue,
    };
  });

  // When scoped, narrow every dropdown to what this viewer's own assignment
  // rows actually contain, rather than the full company list.
  const dropdownSource = scope ? assignments : allActiveAssignments;
  const scopedTeamLeaderIds = new Set(dropdownSource.map((a) => a.teamLeaderId));
  const teamLeaders = teamLeadersAll.filter((tl) => scopedTeamLeaderIds.has(tl.id)).sort((a, b) => a.name.localeCompare(b.name));
  const principals = Array.from(new Set(dropdownSource.map((a) => a.principal))).sort();
  const regions = Array.from(new Set(dropdownSource.map((a) => a.region).filter((r): r is string => !!r))).sort();

  return { targetRows, rosterRows, principals, teamLeaders, regions };
}
