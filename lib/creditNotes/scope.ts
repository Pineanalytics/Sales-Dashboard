// Who may see which credit-note lines. The module follows the dashboard's own scoping rule:
// an unrestricted session (admin, head of sales, director, an unrestricted viewer) sees every
// line; a principal-restricted login sees only its principals; a Team Leader or Supervisor sees
// only the principals and reps of their roster. A restricted session whose roster is empty sees
// nothing (fail closed) rather than everything.
import { normalizePrincipalKey } from "@/lib/normalize";
import { canSeeReport } from "@/lib/pageAccess";
import { resolveScopeForSession, type TeamLeaderScope } from "@/lib/teamLeaderScope";
import type { PerfLine } from "@/lib/performanceAnalysis/types";

export const CREDIT_NOTES_PAGE_KEY = "sales-returns" as const;

interface SessionUserLike {
  role: string;
  allowedPages?: string[] | null;
  teamLeaderId?: string | null;
  allowedPrincipals?: string[] | null;
  supervisorId?: string | null;
}

export type CreditNotesAccess = { ok: false } | { ok: true; scope: TeamLeaderScope | null };

/** The page grant plus the session's data scope, or `{ ok: false }` when the login may not open the module. */
export async function creditNotesAccessFor(user: SessionUserLike | null | undefined): Promise<CreditNotesAccess> {
  if (!user) return { ok: false };
  if (!canSeeReport(user.role, user.allowedPages ?? [], CREDIT_NOTES_PAGE_KEY)) return { ok: false };
  const scope = user.role === "ADMIN" ? null : await resolveScopeForSession(user.role, user.teamLeaderId ?? null, user.allowedPrincipals ?? [], user.supervisorId ?? null);
  return { ok: true, scope };
}

/** The scope fields the line filter needs; a plain object so the rule is testable without a database. */
export interface LineScope {
  principalKeys: Set<string>;
  /** Lower-cased rep names, or null when the scope is by principal only. */
  repNames: Set<string> | null;
}

/** Team Leaders and Supervisors are held to their own reps as well as their principals; a principal-restricted viewer is held to principals only. */
export function lineScopeFrom(scope: TeamLeaderScope | null): LineScope | null {
  if (!scope) return null;
  const byRoster = scope.teamLeaderId !== null || scope.supervisorId !== null || scope.teamLeaderIds.length > 0;
  return {
    principalKeys: new Set(scope.principals.map((p) => normalizePrincipalKey(p)).filter(Boolean)),
    repNames: byRoster ? scope.normalizedNames : null,
  };
}

export function lineInScope(line: Pick<PerfLine, "principal" | "rep">, scope: LineScope | null): boolean {
  if (!scope) return true;
  if (!scope.principalKeys.has(normalizePrincipalKey(line.principal))) return false;
  if (scope.repNames && !scope.repNames.has(line.rep.trim().toLowerCase())) return false;
  return true;
}
