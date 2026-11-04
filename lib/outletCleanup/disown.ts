// The rules for disowning outlets, one at a time or many at once. Pure: no database, so the checks are testable and the same for both paths.
import type { CleanupActor } from "./types";

/** Most outlets one bulk disown may carry: each is filed and logged in a single transaction. */
export const MAX_BULK_DISOWN = 200;

export interface DisownRequest {
  reason: string;
  /** Team leaders from other teams who may own the outlet. */
  candidates: string[];
  /** Nobody on the list applies: the outlet is marked open with no named owner and goes straight to an admin to allocate or close. */
  ownerUnknown?: boolean;
}

export type DisownPlan =
  | { ok: true; reason: string; candidates: string[]; ownerUnknown: boolean }
  | { ok: false; message: string; fields: { field: string; message: string }[] };

/** Checks the reason and the owners named against the team leaders the person may offer an outlet to. */
export function planDisown(request: DisownRequest, teamLeaderOptions: readonly string[]): DisownPlan {
  const reason = request.reason.trim();
  if (reason.length < 5) return { ok: false, message: "Say why the outlet is being disowned.", fields: [{ field: "reason", message: "Give a short reason." }] };
  const allowed = new Map(teamLeaderOptions.map((n) => [n.toLowerCase(), n]));
  const candidates = [...new Set(request.candidates.map((c) => allowed.get(c.trim().toLowerCase())).filter((c): c is string => Boolean(c)))];
  if (request.ownerUnknown) {
    if (request.candidates.some((c) => c.trim() !== "")) {
      return { ok: false, message: "Either name the possible owners or declare the owner unknown, not both.", fields: [{ field: "candidates", message: "Clear the team leaders, or untick the unknown owner." }] };
    }
    return { ok: true, reason, candidates: [], ownerUnknown: true };
  }
  if (candidates.length === 0) {
    return { ok: false, message: "Name at least one possible owner from another team, or declare the owner unknown, before disowning.", fields: [{ field: "candidates", message: "Choose one or more team leaders from other teams, or declare the owner unknown." }] };
  }
  return { ok: true, reason, candidates, ownerUnknown: false };
}

export interface DisownRow {
  principal: string;
  repName: string | null;
  teamLeader: string | null;
  /** The person may act on this row (it is on their team). */
  editable: boolean;
}

/** The team leader a disowned outlet is filed under: the person's own team for a team leader, otherwise the first team that sells it. */
export function filingTeamLeader(actor: CleanupActor, rows: readonly DisownRow[]): string | null {
  if (actor.role === "TEAM_LEADER") return actor.teamLeaders?.[0] ?? null;
  return rows.find((r) => r.editable && r.teamLeader)?.teamLeader ?? actor.displayName;
}

export function describeDisownedRows(rows: readonly DisownRow[]): { principals: string; previousReps: string | null } {
  return {
    principals: [...new Set(rows.map((r) => r.principal))].join(", "),
    previousReps: rows.filter((r) => r.repName).map((r) => `${r.principal}: ${r.repName}`).join("; ") || null,
  };
}

/** Why an outlet cannot be disowned by this person right now, or null when it can. */
export function disownBlocker(target: { rows: readonly DisownRow[]; alreadyOpen: boolean } | undefined): string | null {
  if (!target) return "Not one of your outlets.";
  if (target.alreadyOpen) return "Already marked open.";
  if (!target.rows.some((r) => r.editable)) return "Not on your team.";
  return null;
}

/** Outlets nobody owns that wait for an admin to allocate or close: disowned with the owner unknown, or declined by every team named. */
export interface AdminOpenQueue {
  total: number;
  ownerUnknown: number;
  declinedByAll: number;
  overdue: number;
}

export function adminOpenQueue(rows: readonly { status: string; ownerUnknown: boolean; overdue: boolean }[]): AdminOpenQueue {
  const waiting = rows.filter((r) => r.status === "UNCLAIMED");
  const ownerUnknown = waiting.filter((r) => r.ownerUnknown).length;
  return { total: waiting.length, ownerUnknown, declinedByAll: waiting.length - ownerUnknown, overdue: waiting.filter((r) => r.overdue).length };
}
