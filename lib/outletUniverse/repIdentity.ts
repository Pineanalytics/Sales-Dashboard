// Who each outlet row's rep is in the roster: their SFA user code or ID, and their Team Leader.
//
//  - Rep ID: as the rep's own system supplies it. Pine: the Sales Edge employee code of the roster (the Pine user id, the one the two
//    exception DSR codes 1172 and 1032 are); Leverage: Centegy's sales rep code (already on the row); EABL DMS: the roster code (PFL...);
//    Upfield DataEdge: the FSR's login from the outlet list, else the roster code.
//  - Team Leader: from the roster's assignments of that rep to that principal (a rep can have a different Team Leader per principal);
//    all of a principal in PRINCIPAL_TEAM_LEADERS (Suntory Eve, Bic Nickley) are on that Team Leader whatever the roster says;
//    when the rep has none, the principal's own Team Leader if every rep rostered to that principal has the same one (EABL Nyeri is
//    Richard, EABL Nyahururu is Erick, Unilever Nyeri is Sarah); then the Team Leader of the rep's employee-master record; otherwise blank.
// A rep is found by name (the systems give no shared id), ignoring case, spacing and punctuation; a Leverage unit by its unit name without
// the distributor suffix ("NY_VAN_A2_OB_18058585" is "NY_VAN_A2_OB").

import { isMarsPrincipal, marsRegionOf } from "../marsStructure";

export interface RosterAssignment {
  employeeCode: string;
  employeeName: string;
  sapName: string | null;
  principal: string;
  teamLeader: string;
  contributionPct: number | null;
  region?: string | null;
  subRegion?: string | null;
}

export interface RosterEmployee {
  employeeCode: string;
  pineName: string;
  sapName: string | null;
  absolutePrincipal: string | null;
  teamLeader: string | null;
  active?: boolean;
  region?: string | null;
  subRegion?: string | null;
}

/** One rep of the Mars roster (the Mars KPI roster): active or inactive, with their Team Leader and sub-region (its "location"). */
export interface RosterMarsRep {
  employeeCode: string;
  name: string;
  teamLeader: string | null;
  location: string | null;
  active: boolean;
}

export interface RepIdentityInput {
  employees: RosterEmployee[];
  assignments: RosterAssignment[];
  /** Upfield DataEdge FSR name to FSR login, from the customer master. */
  upfieldLogins: { fsrName: string; fsrLogin: string }[];
  /** The Mars roster including reps who have stopped selling, so their outlets still resolve to a code, Team Leader and status. */
  marsRoster?: RosterMarsRep[];
}

export interface RepIdentity {
  repCode: string | null;
  teamLeader: string | null;
  /** Active or Inactive worker on the roster; null when the rep is not on it. */
  repStatus: "Active" | "Inactive" | null;
  repRegion: string | null;
  repSubRegion: string | null;
}

export function repKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/_\d{6,}$/, "") // a Leverage unit's distributor suffix
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const principalKey = (principal: string) => principal.trim().toLowerCase();

/** Principals whose every rep is on one Team Leader's team, whatever the roster assignments say (set by the business: all Suntory under Eve,
 *  all Bic under Nickley). Keyed by the principal's brand, the part before the location ( "Suntory-Nairobi" is "suntory" ). The value is the
 *  Team Leader's roster name. */
export const PRINCIPAL_TEAM_LEADERS: Record<string, string> = {
  suntory: "Eve Theuri",
  bic: "Nickley",
};

function fixedLeader(principal: string): string | null {
  return PRINCIPAL_TEAM_LEADERS[principalKey(principal).split("-")[0]] ?? null;
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  if (key === "") return;
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** One resolver for a rebuild: call it with a row's source, principal, rep name and the code the source already supplied. */
export function buildRepDirectory(input: RepIdentityInput): (source: string, principal: string, repName: string | null, suppliedCode: string | null) => RepIdentity {
  const employeesByName = new Map<string, RosterEmployee[]>();
  for (const employee of input.employees) {
    push(employeesByName, repKey(employee.pineName), employee);
    if (repKey(employee.sapName) !== repKey(employee.pineName)) push(employeesByName, repKey(employee.sapName), employee);
  }
  // key: principal | rep name (employee name and SAP name both resolve)
  const assignmentsByRep = new Map<string, RosterAssignment[]>();
  for (const assignment of input.assignments) {
    push(assignmentsByRep, `${principalKey(assignment.principal)}|${repKey(assignment.employeeName)}`, assignment);
    if (repKey(assignment.sapName) !== repKey(assignment.employeeName)) push(assignmentsByRep, `${principalKey(assignment.principal)}|${repKey(assignment.sapName)}`, assignment);
  }
  // A principal whose rostered reps all have the same Team Leader: every rep of it, rostered or not, is on that Team Leader's team.
  const leadersByPrincipal = new Map<string, Set<string>>();
  for (const assignment of input.assignments) {
    const key = principalKey(assignment.principal);
    const set = leadersByPrincipal.get(key) ?? new Set<string>();
    set.add(assignment.teamLeader);
    leadersByPrincipal.set(key, set);
  }
  const principalLeader = (principal: string): string | null => {
    const fixed = fixedLeader(principal);
    if (fixed) return fixed;
    const set = leadersByPrincipal.get(principalKey(principal));
    return set && set.size === 1 ? [...set][0] : null;
  };
  const marsByName = new Map<string, RosterMarsRep>();
  for (const rep of input.marsRoster ?? []) if (!marsByName.has(repKey(rep.name)) || rep.active) marsByName.set(repKey(rep.name), rep);
  const upfieldLogin = new Map<string, string>();
  for (const entry of input.upfieldLogins) if (entry.fsrLogin.trim() !== "") upfieldLogin.set(repKey(entry.fsrName), entry.fsrLogin.trim());

  return (source, principal, repName, suppliedCode) => {
    const key = repKey(repName);
    const unplaced = { repStatus: null, repRegion: null, repSubRegion: null } as const;
    if (key === "") return { repCode: suppliedCode, teamLeader: principalLeader(principal), ...unplaced };
    const assigned = assignmentsByRep.get(`${principalKey(principal)}|${key}`) ?? [];
    const matched = employeesByName.get(key) ?? [];
    // The roster record for this rep: the one that is rostered to this principal when the name is shared.
    const mars = isMarsPrincipal(principal) ? marsByName.get(key) : undefined;
    const employee = matched.find((e) => principalKey(e.absolutePrincipal ?? "") === principalKey(principal)) ?? matched[0];

    let repCode: string | null;
    if (source === "LEVERAGE") repCode = suppliedCode;
    else if (source === "UPFIELD") repCode = upfieldLogin.get(key) ?? assigned[0]?.employeeCode ?? employee?.employeeCode ?? suppliedCode;
    else repCode = assigned[0]?.employeeCode ?? mars?.employeeCode ?? employee?.employeeCode ?? suppliedCode;

    let teamLeader: string | null = null;
    if (fixedLeader(principal)) teamLeader = fixedLeader(principal);
    else if (assigned.length > 0) {
      // Most of the rep's share of the principal first; names joined when the roster really gives the rep two Team Leaders.
      const ordered = [...assigned].sort((a, b) => (b.contributionPct ?? 0) - (a.contributionPct ?? 0) || a.teamLeader.localeCompare(b.teamLeader));
      teamLeader = Array.from(new Set(ordered.map((a) => a.teamLeader))).join(" / ");
    } else teamLeader = (mars?.teamLeader?.trim() || null) ?? principalLeader(principal) ?? employee?.teamLeader ?? null;

    // Active or Inactive and where the rep is placed: their live assignment to this principal, else the Mars roster (which also holds the
    // reps who have stopped selling), else the employee master.
    let placement: Pick<RepIdentity, "repStatus" | "repRegion" | "repSubRegion"> = unplaced;
    const placed = assigned.find((a) => (a.subRegion ?? "") !== "") ?? assigned[0];
    if (placed) placement = { repStatus: "Active", repRegion: placed.region?.trim() || null, repSubRegion: placed.subRegion?.trim() || null };
    else if (mars) placement = { repStatus: mars.active ? "Active" : "Inactive", repRegion: marsRegionOf(mars.location), repSubRegion: mars.location?.trim() || null };
    else if (employee && employee.active !== undefined) placement = { repStatus: employee.active ? "Active" : "Inactive", repRegion: employee.region?.trim() || null, repSubRegion: employee.subRegion?.trim() || null };
    return { repCode: repCode?.trim() || null, teamLeader, ...placement };
  };
}
