// Who each outlet row's rep is in the roster: their SFA user code or ID, and their Team Leader.
//
//  - Rep ID: as the rep's own system supplies it. Pine: the Sales Edge employee code of the roster (the Pine user id, the one the two
//    exception DSR codes 1172 and 1032 are); Leverage: Centegy's sales rep code (already on the row); EABL DMS: the roster code (PFL...);
//    Upfield DataEdge: the FSR's login from the outlet list, else the roster code.
//  - Team Leader: from the roster's assignments of that rep to that principal (a rep can have a different Team Leader per principal);
//    when the rep has none, the principal's own Team Leader if every rep rostered to that principal has the same one (EABL Nyeri is
//    Richard, EABL Nyahururu is Erick, Unilever Nyeri is Sarah); then the Team Leader of the rep's employee-master record; otherwise blank.
// A rep is found by name (the systems give no shared id), ignoring case, spacing and punctuation; a Leverage unit by its unit name without
// the distributor suffix ("NY_VAN_A2_OB_18058585" is "NY_VAN_A2_OB").

export interface RosterAssignment {
  employeeCode: string;
  employeeName: string;
  sapName: string | null;
  principal: string;
  teamLeader: string;
  contributionPct: number | null;
}

export interface RosterEmployee {
  employeeCode: string;
  pineName: string;
  sapName: string | null;
  absolutePrincipal: string | null;
  teamLeader: string | null;
}

export interface RepIdentityInput {
  employees: RosterEmployee[];
  assignments: RosterAssignment[];
  /** Upfield DataEdge FSR name to FSR login, from the customer master. */
  upfieldLogins: { fsrName: string; fsrLogin: string }[];
}

export interface RepIdentity {
  repCode: string | null;
  teamLeader: string | null;
}

export function repKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/_\d{6,}$/, "") // a Leverage unit's distributor suffix
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const principalKey = (principal: string) => principal.trim().toLowerCase();

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
    const set = leadersByPrincipal.get(principalKey(principal));
    return set && set.size === 1 ? [...set][0] : null;
  };
  const upfieldLogin = new Map<string, string>();
  for (const entry of input.upfieldLogins) if (entry.fsrLogin.trim() !== "") upfieldLogin.set(repKey(entry.fsrName), entry.fsrLogin.trim());

  return (source, principal, repName, suppliedCode) => {
    const key = repKey(repName);
    if (key === "") return { repCode: suppliedCode, teamLeader: principalLeader(principal) };
    const assigned = assignmentsByRep.get(`${principalKey(principal)}|${key}`) ?? [];
    const matched = employeesByName.get(key) ?? [];
    // The roster record for this rep: the one that is rostered to this principal when the name is shared.
    const employee = matched.find((e) => principalKey(e.absolutePrincipal ?? "") === principalKey(principal)) ?? matched[0];

    let repCode: string | null;
    if (source === "LEVERAGE") repCode = suppliedCode;
    else if (source === "UPFIELD") repCode = upfieldLogin.get(key) ?? assigned[0]?.employeeCode ?? employee?.employeeCode ?? suppliedCode;
    else repCode = assigned[0]?.employeeCode ?? employee?.employeeCode ?? suppliedCode;

    let teamLeader: string | null = null;
    if (assigned.length > 0) {
      // Most of the rep's share of the principal first; names joined when the roster really gives the rep two Team Leaders.
      const ordered = [...assigned].sort((a, b) => (b.contributionPct ?? 0) - (a.contributionPct ?? 0) || a.teamLeader.localeCompare(b.teamLeader));
      teamLeader = Array.from(new Set(ordered.map((a) => a.teamLeader))).join(" / ");
    } else teamLeader = principalLeader(principal) ?? employee?.teamLeader ?? null;
    return { repCode: repCode?.trim() || null, teamLeader };
  };
}
