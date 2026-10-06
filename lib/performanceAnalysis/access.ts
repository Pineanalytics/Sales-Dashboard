import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export type PerformanceAccess = "ok" | "denied" | "restricted";

interface SessionUserLike {
  role: string;
  allowedPages?: string[] | null;
  teamLeaderId?: string | null;
  allowedPrincipals?: string[] | null;
  supervisorId?: string | null;
}

/** Performance Analysis is company-wide: it needs the page grant (admins always have it), and a
 *  session restricted to a team or to specific principals does not get it, because the lines are
 *  not split per principal owner. */
export async function performanceAccessFor(user: SessionUserLike | null | undefined): Promise<PerformanceAccess> {
  if (!user) return "denied";
  if (user.role === "ADMIN") return "ok";
  if (!(user.allowedPages ?? []).includes("performance-analysis")) return "denied";
  const scope = await resolveScopeForSession(user.role, user.teamLeaderId ?? null, user.allowedPrincipals ?? [], user.supervisorId ?? null);
  return scope ? "restricted" : "ok";
}
