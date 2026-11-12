// Pure logic for linking roster employees to rep-directory identities (docs/rep-directory-scope.md, phase 2): what a link
// state is, which exact match to propose, and how alike two names are. No database, so it is tested directly.

import { normalizeRepName } from "./repDirectoryBuild";

/** The two columns the roster edits. Leverage, DataEdge and EABL links are made from the rep directory page. */
export type RosterLinkSource = "SAP" | "PINE";

export interface DirectoryIdentity {
  source: string;
  sourceKey: string;
  displayName: string;
  normalizedName: string;
  isActive: boolean;
}

export interface RosterEmployeeLite {
  employeeCode: string;
  pineName: string;
  sapName: string;
  active?: boolean;
}

export interface StoredLink {
  employeeCode: string;
  source: string;
  sourceKey: string;
}

export type CellState = "linked" | "name-only" | "not-linked";

export interface CellInfo {
  state: CellState;
  /** The linked identity's key (SAP SlpCode or Pine user id); null unless linked. */
  key: string | null;
  /** The linked identity's own spelling when linked, otherwise the roster's text for that column. */
  name: string;
  /** For "name-only": the one identity whose name matches exactly, ready to link in one click. */
  proposal: { key: string; name: string } | null;
  /** Other roster employees linked to the same identity. */
  sharedWith: Array<{ employeeCode: string; name: string }>;
  /** Whether the linked identity is still active in its source (null unless linked). */
  identityActive: boolean | null;
}

/** The roster text that a column of this source holds. */
export function rosterTextFor(employee: RosterEmployeeLite, source: RosterLinkSource): string {
  return source === "SAP" ? employee.sapName : employee.pineName;
}

/** The one identity that is an exact match for an employee, or null. SAP: the identity whose name equals the employee's SAP name.
 *  Pine: the identity whose user id is the employee's code, else the one whose name equals the Pine name. Never guesses when a name
 *  matches two identities. */
export function proposeIdentity(employee: RosterEmployeeLite, source: RosterLinkSource, identities: DirectoryIdentity[]): DirectoryIdentity | null {
  const ofSource = identities.filter((identity) => identity.source === source);
  if (source === "PINE") {
    const byCode = ofSource.find((identity) => identity.sourceKey === employee.employeeCode);
    if (byCode) return byCode;
  }
  const wanted = normalizeRepName(rosterTextFor(employee, source));
  if (!wanted) return null;
  const matches = ofSource.filter((identity) => identity.normalizedName === wanted);
  return matches.length === 1 ? matches[0] : null;
}

export interface LinkContext {
  employeesByCode: Map<string, RosterEmployeeLite>;
  /** Links of one source, by employee code. */
  linkByEmployee: Map<string, StoredLink>;
  /** Links of one source, grouped by identity key. */
  linksByKey: Map<string, StoredLink[]>;
  identityByKey: Map<string, DirectoryIdentity>;
  identities: DirectoryIdentity[];
}

export function buildLinkContext(source: RosterLinkSource, employees: RosterEmployeeLite[], links: StoredLink[], identities: DirectoryIdentity[]): LinkContext {
  const linkByEmployee = new Map<string, StoredLink>();
  const linksByKey = new Map<string, StoredLink[]>();
  for (const link of links) {
    if (link.source !== source) continue;
    linkByEmployee.set(link.employeeCode, link);
    linksByKey.set(link.sourceKey, [...(linksByKey.get(link.sourceKey) ?? []), link]);
  }
  const ofSource = identities.filter((identity) => identity.source === source);
  return {
    employeesByCode: new Map(employees.map((employee) => [employee.employeeCode, employee])),
    linkByEmployee,
    linksByKey,
    identityByKey: new Map(ofSource.map((identity) => [identity.sourceKey, identity])),
    identities: ofSource,
  };
}

/** What one roster cell shows: linked (explicit link), name-only (no link, but one identity matches the text exactly) or not linked. */
export function buildCellInfo(employee: RosterEmployeeLite, source: RosterLinkSource, context: LinkContext): CellInfo {
  const text = rosterTextFor(employee, source);
  const link = context.linkByEmployee.get(employee.employeeCode);
  const sharedWithOf = (key: string) =>
    (context.linksByKey.get(key) ?? [])
      .filter((other) => other.employeeCode !== employee.employeeCode)
      .map((other) => ({ employeeCode: other.employeeCode, name: context.employeesByCode.get(other.employeeCode)?.pineName ?? other.employeeCode }));

  if (link) {
    const identity = context.identityByKey.get(link.sourceKey);
    return { state: "linked", key: link.sourceKey, name: identity?.displayName ?? text, proposal: null, sharedWith: sharedWithOf(link.sourceKey), identityActive: identity ? identity.isActive : null };
  }
  const proposed = proposeIdentity(employee, source, context.identities);
  if (proposed) {
    return { state: "name-only", key: null, name: text, proposal: { key: proposed.sourceKey, name: proposed.displayName }, sharedWith: sharedWithOf(proposed.sourceKey), identityActive: null };
  }
  return { state: "not-linked", key: null, name: text, proposal: null, sharedWith: [], identityActive: null };
}

// ---- name similarity, for suggesting roster employees to a derived identity ---------------------

/** 0 to 1. Order, case and punctuation do not matter. 1 for the same words; high when every word of the shorter name is in the longer
 *  (a middle name left out); otherwise the share of words in common. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeRepName(a).split(" ").filter(Boolean);
  const right = normalizeRepName(b).split(" ").filter(Boolean);
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const common = [...leftSet].filter((word) => rightSet.has(word)).length;
  if (common === 0) return 0;
  const union = new Set([...leftSet, ...rightSet]).size;
  const shorter = Math.min(leftSet.size, rightSet.size);
  if (common === shorter && shorter >= 2) return Math.max(0.85, common / union);
  return common / union;
}

export interface EmployeeSuggestion {
  employeeCode: string;
  name: string;
  score: number;
}

/** Roster employees whose Pine or SAP name looks like this identity's name, best first. Only suggestions at or above `minimum`. */
export function suggestEmployees(identityName: string, employees: RosterEmployeeLite[], limit = 3, minimum = 0.6): EmployeeSuggestion[] {
  return employees
    .map((employee) => ({ employeeCode: employee.employeeCode, name: employee.pineName, score: Math.max(nameSimilarity(identityName, employee.pineName), nameSimilarity(identityName, employee.sapName)) }))
    .filter((suggestion) => suggestion.score >= minimum)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---- bulk proposals -----------------------------------------------------------------------------

export interface LinkProposal {
  employeeCode: string;
  employeeName: string;
  source: RosterLinkSource;
  sourceKey: string;
  identityName: string;
  /** "code" when a Pine user id equals the roster code, otherwise "name". */
  basis: "code" | "name";
}

export interface LinkConflict {
  employeeCode: string;
  employeeName: string;
  source: RosterLinkSource;
  sourceKey: string;
  identityName: string;
  heldBy: Array<{ employeeCode: string; name: string }>;
}

/** The exact matches that can be accepted in bulk: employees with no link in that column whose text matches exactly one identity that
 *  no other employee holds. A match whose identity is already held by someone else is a conflict, decided by a person. */
export function buildProposals(
  employees: RosterEmployeeLite[],
  links: StoredLink[],
  identities: DirectoryIdentity[],
  /** Everyone on the roster, so a holder outside `employees` still gets a name. Defaults to `employees`. */
  allEmployees: RosterEmployeeLite[] = employees
): { proposals: LinkProposal[]; conflicts: LinkConflict[] } {
  const proposals: LinkProposal[] = [];
  const conflicts: LinkConflict[] = [];
  for (const source of ["SAP", "PINE"] as const) {
    const context = buildLinkContext(source, allEmployees, links, identities);
    for (const employee of employees) {
      if (context.linkByEmployee.has(employee.employeeCode)) continue;
      const identity = proposeIdentity(employee, source, identities);
      if (!identity) continue;
      const holders = (context.linksByKey.get(identity.sourceKey) ?? []).filter((link) => link.employeeCode !== employee.employeeCode);
      const base = { employeeCode: employee.employeeCode, employeeName: employee.pineName, source, sourceKey: identity.sourceKey, identityName: identity.displayName };
      if (holders.length > 0) {
        conflicts.push({ ...base, heldBy: holders.map((holder) => ({ employeeCode: holder.employeeCode, name: context.employeesByCode.get(holder.employeeCode)?.pineName ?? holder.employeeCode })) });
      } else {
        proposals.push({ ...base, basis: source === "PINE" && identity.sourceKey === employee.employeeCode ? "code" : "name" });
      }
    }
  }
  // Two employees proposing the same identity in one pass would both be unheld: treat those as conflicts too, not as two accepts.
  const claimed = new Map<string, LinkProposal[]>();
  for (const proposal of proposals) claimed.set(`${proposal.source}|${proposal.sourceKey}`, [...(claimed.get(`${proposal.source}|${proposal.sourceKey}`) ?? []), proposal]);
  const safe: LinkProposal[] = [];
  for (const group of claimed.values()) {
    if (group.length === 1) safe.push(group[0]);
    else for (const proposal of group) conflicts.push({ ...proposal, heldBy: group.filter((other) => other !== proposal).map((other) => ({ employeeCode: other.employeeCode, name: other.employeeName })) });
  }
  const order = (a: { employeeName: string }, b: { employeeName: string }) => a.employeeName.localeCompare(b.employeeName);
  return { proposals: safe.sort(order), conflicts: conflicts.sort(order) };
}
