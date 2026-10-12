// The October 2026 organisation clean-up (scripts/org-restructure-2026-10.ts), as plain data and pure functions so the
// decisions can be unit-tested and reviewed apart from the database work.
//
// The structure, as confirmed by the business:
//  - Only Mars and EABL have team leaders. Every other principal is run directly by its Sales Supervisor.
//  - EABL is supervised by Alexander Muhoro; its team leaders are Erick (Nyahururu) and Richard (Nyeri).
//  - Mars is supervised by Lucy. Its team leaders each own one territory, defined by the Mars KPI roster's location:
//    Nairobi Lower is Zachary, Nairobi Metro is Lewis, Nairobi South is Benson, Lower Eastern is Christine Mweni,
//    Upper Eastern is Shekila and Central is Lydiah. Key accounts (KAM) has no team leader: it belongs to Lucy directly.
//  - Calvince and Josephat are leaving (Nickley replaces Josephat); Clarrine is a key accounts rep, not a team leader.

export const MARS_PRINCIPAL_PREFIX = "Mars";

/** Mars KPI roster location -> the team leader who owns that territory. */
export const MARS_LOCATION_OWNER: Record<string, string> = {
  "Nairobi Lower": "Zachary Mwangi",
  "Nairobi Metro": "Lewis Muthomi",
  "Nairobi South": "Benson Mbivi",
  "Lower Eastern": "Christine Mweni",
  "Upper Eastern": "Shekila Hassan",
  Central: "Lydiah John",
};

/** Mars locations with no team leader: the reps report to the Mars supervisor's own direct team. */
export const MARS_DIRECT_LOCATIONS: ReadonlySet<string> = new Set(["KAM"]);

export type MarsOwner = { kind: "TEAM_LEADER"; name: string } | { kind: "DIRECT" } | null;

export function marsOwnerForLocation(location: string | null | undefined): MarsOwner {
  const key = (location ?? "").trim();
  if (MARS_LOCATION_OWNER[key]) return { kind: "TEAM_LEADER", name: MARS_LOCATION_OWNER[key] };
  if (MARS_DIRECT_LOCATIONS.has(key)) return { kind: "DIRECT" };
  return null;
}

export interface RealTeamLeaderSpec {
  /** The TeamLeader row's name (an existing row is renamed to this when `renameFrom` is set). */
  name: string;
  renameFrom?: string;
  email: string;
  /** The Supervisor row (by current name) the team leader reports to. */
  supervisor: string;
}

export const REAL_TEAM_LEADERS: RealTeamLeaderSpec[] = [
  { name: "Benson Mbivi", email: "benson.mbivi@pinefrost.co.ke", supervisor: "Lucy" },
  { name: "Shekila Hassan", email: "shekila.hassan@pinefrost.co.ke", supervisor: "Lucy" },
  { name: "Lydiah John", renameFrom: "Lydiah", email: "lydiah.john@pinefrost.co.ke", supervisor: "Lucy" },
  { name: "Zachary Mwangi", email: "zachary.mwangi@pinefrost.co.ke", supervisor: "Lucy" },
  { name: "Lewis Muthomi", email: "lewis.muthomi@pinefrost.co.ke", supervisor: "Lucy" },
  { name: "Christine Mweni", email: "christine.mweni@pinefrost.co.ke", supervisor: "Lucy" },
  { name: "Erick", email: "eric.ndirangu@pinefrost.co.ke", supervisor: "Alexander Muhoro" },
  { name: "Richard", email: "richard.adega@pinefrost.co.ke", supervisor: "Alexander Muhoro" },
];

/** Same person spelled two ways: keep the full name, merge the short one into it. */
export const DUPLICATE_PAIRS: { keep: string; mergeAway: string }[] = [
  { keep: "Eve Theuri", mergeAway: "Eve" },
  { keep: "Eva Gachoki", mergeAway: "Eva" },
  { keep: "Truphyline Apondi", mergeAway: "Truphyline" },
];

/** TeamLeader rows that stand in for a supervisor who runs a principal directly (after the merges above). */
export const SUPERVISOR_DIRECT_TEAMS: string[] = ["Emmy", "Nickley", "Sarah", "Lucy", "Eve Theuri", "Eva Gachoki", "Truphyline Apondi"];

/** TeamLeader rows for people who are leaving or were never team leaders; hidden from the dropdowns, history kept. */
export const FORMER_TEAM_LEADERS: string[] = ["Calvince Onditi", "Josephat", "Clarrine Wahome"];

/** Josephat's reps pass to Nickley, who replaced him. */
export const SUCCESSION: { from: string; to: string }[] = [{ from: "Josephat", to: "Nickley" }];

/** The Supervisor for EABL: replaces the stand-in supervisors "Erick" and "Richard". */
export const EABL_SUPERVISOR = { name: "Alexander Muhoro", email: "alexander.muhoro@pinefrost.co.ke", hod: "Alexander Muhoro" };
export const EABL_STAND_IN_SUPERVISORS = ["Erick", "Richard"];

export interface AssignmentLite {
  id: string;
  teamLeaderId: string;
  employeeCode: string;
  principal: string;
  active: boolean;
}

export interface MovePlan {
  moves: { id: string; toTeamLeaderId: string }[];
  /** The target already holds this rep on this principal, so the copy on the old row is redundant. */
  duplicates: { id: string }[];
  unchanged: number;
  /** No owner could be worked out (the rep is not in the roster used to decide), so it stays where it is. */
  unmapped: number;
}

const assignmentKey = (teamLeaderId: string, employeeCode: string, principal: string) => `${teamLeaderId}|${employeeCode}|${principal}`;

/** Decides, for each assignment, whether it moves to the team leader that owns its rep. `ownerOf` returns the target
 *  TeamLeader id for a rep code, or null when the rep's owner is not known. A move that would land on a row that
 *  already exists (same team leader, rep and principal) is reported as a duplicate instead of being forced. */
export function planAssignmentMoves(assignments: AssignmentLite[], ownerOf: (employeeCode: string) => string | null, existing: AssignmentLite[] = assignments): MovePlan {
  const taken = new Set(existing.map((a) => assignmentKey(a.teamLeaderId, a.employeeCode, a.principal)));
  const plan: MovePlan = { moves: [], duplicates: [], unchanged: 0, unmapped: 0 };
  for (const a of assignments) {
    const target = ownerOf(a.employeeCode);
    if (!target) {
      plan.unmapped += 1;
      continue;
    }
    if (target === a.teamLeaderId) {
      plan.unchanged += 1;
      continue;
    }
    const key = assignmentKey(target, a.employeeCode, a.principal);
    if (taken.has(key)) {
      plan.duplicates.push({ id: a.id });
      continue;
    }
    taken.add(key);
    plan.moves.push({ id: a.id, toTeamLeaderId: target });
  }
  return plan;
}
