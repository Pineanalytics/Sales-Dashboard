import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import type { OutletScope } from "./query";

export type OutletAccess = { ok: true; scope: OutletScope; isAdmin: boolean } | { ok: false; status: 401 };

/** Signed-in users only. A principal-restricted viewer, supervisor or team
 *  leader is narrowed to their own principals, exactly as the older
 *  Active Outlets route does; everyone else sees the whole universe. */
export async function resolveOutletAccess(): Promise<OutletAccess> {
  const session = await auth();
  if (!session?.user) return { ok: false, status: 401 };
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  return { ok: true, scope: scope ? { principals: scope.principals } : null, isAdmin: session.user.role === "ADMIN" };
}
