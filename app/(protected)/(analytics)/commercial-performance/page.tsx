import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getWeeklyMonthlyTargetSummary } from "@/lib/commercialPerformance";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { CommercialPerformanceClient } from "@/components/commercialPerformance/CommercialPerformanceClient";

export const dynamic = "force-dynamic";

export default async function CommercialPerformancePage() {
  const session = await auth();
  const scope = session?.user
    ? await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId)
    : null;

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = CANONICAL_MONTHS[now.getUTCMonth()];
  const weeklyMonthlyTargetSummary = await getWeeklyMonthlyTargetSummary(year, month, scope);

  return <CommercialPerformanceClient weeklyMonthlyTargetSummary={weeklyMonthlyTargetSummary} />;
}
