import { prisma } from "@/lib/db";

/** Whether the given session may edit the shared, principal-level Monthly
 *  Target (app/(protected)/targets-overview's updateTargetValueAction) —
 *  always true for ADMIN, otherwise resolved live from the acting Team
 *  Leader's or Supervisor's own admin-assignable TeamLeader/Supervisor
 *  .canEditTargets flag. Deliberately not cached in the session/JWT: a
 *  newly-granted permission must take effect on the very next request, not
 *  after the session's ~5 minute refresh interval. */
export async function canEditMonthlyTarget(session: {
  role: string;
  teamLeaderId?: string | null;
  supervisorId?: string | null;
}): Promise<boolean> {
  if (session.role === "ADMIN") return true;
  if (session.role === "TEAM_LEADER" && session.teamLeaderId) {
    const teamLeader = await prisma.teamLeader.findUnique({ where: { id: session.teamLeaderId }, select: { canEditTargets: true } });
    return teamLeader?.canEditTargets ?? false;
  }
  if (session.role === "SUPERVISOR" && session.supervisorId) {
    const supervisor = await prisma.supervisor.findUnique({ where: { id: session.supervisorId }, select: { canEditTargets: true } });
    return supervisor?.canEditTargets ?? false;
  }
  return false;
}
