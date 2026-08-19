import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import TlTrackerClient from "./TlTrackerClient";

export const dynamic = "force-dynamic";

// Built from Sales Perfomance Tracker-Suntory.xlsx's "Monthly KPIs" (team-
// level) and "Rep Scorecard" (per-rep grid) sheets — one tracker per Team
// Leader per period. TEAM_LEADER fills their own; their own SUPERVISOR
// (TeamLeaderAssignment.supervisorId, the same scope every other page here
// uses) reviews it — see app/api/performance-tracker/route.ts for where that
// permission is actually enforced.
export default async function TlReviewPage({ searchParams }: { searchParams: Promise<{ teamLeaderId?: string }> }) {
  const session = await auth();
  if (!session?.user || !["TEAM_LEADER", "SUPERVISOR", "ADMIN"].includes(session.user.role)) {
    redirect("/");
  }
  const role = session.user.role;
  const { teamLeaderId: teamLeaderIdParam } = await searchParams;

  if (role === "TEAM_LEADER") {
    if (!session.user.teamLeaderId) {
      return (
        <div className="max-w-xl mx-auto px-6 py-16 text-sm text-muted-strong">
          Your login isn&apos;t linked to a Team Leader profile yet. Ask an administrator to link it from Manage Users.
        </div>
      );
    }
    return <TlTrackerClient teamLeaderId={session.user.teamLeaderId} teamLeaderOptions={null} canEditValues canReview={false} />;
  }

  // SUPERVISOR/ADMIN: pick which Team Leader's tracker to view/review.
  const scope = role === "ADMIN" ? null : await resolveScopeForSession(role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  const teamLeaders = await prisma.teamLeader.findMany({
    where: scope ? { id: { in: scope.teamLeaderIds } } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const selectedId = teamLeaderIdParam && teamLeaders.some((t) => t.id === teamLeaderIdParam) ? teamLeaderIdParam : teamLeaders[0]?.id ?? null;

  if (!selectedId) {
    return <div className="max-w-xl mx-auto px-6 py-16 text-sm text-muted-strong">No Team Leaders in your scope yet.</div>;
  }

  return (
    <TlTrackerClient
      teamLeaderId={selectedId}
      teamLeaderOptions={teamLeaders}
      canEditValues={role === "ADMIN"}
      canReview={role === "SUPERVISOR" || role === "ADMIN"}
    />
  );
}
