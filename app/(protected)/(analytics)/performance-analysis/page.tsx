import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getLatestPerformanceSnapshot } from "@/lib/performanceAnalysis/store";
import { PerformanceAnalysisView } from "@/components/performanceAnalysis/PerformanceAnalysisView";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

// The report is built by the SAP bridge (scripts/db-bridge/performance-analysis)
// and stored whole, so this page only reads one row. It is company-wide, so a
// session restricted to a team or to specific principals does not get it: those
// roles' figures are scoped per principal everywhere else, and this snapshot is
// not split that way.
export default async function PerformanceAnalysisPage() {
  const session = await auth();
  if (!session?.user) return null;

  if (session.user.role !== "ADMIN") {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    if (scope) {
      return (
        <EmptyState
          title="Not available for restricted accounts"
          description="Performance Analysis shows company-wide figures across every principal. Accounts limited to a team or specific principals use Sales Performance and Principal KPIs instead."
        />
      );
    }
  }

  const stored = await getLatestPerformanceSnapshot();
  if (!stored) {
    return (
      <EmptyState
        title="No performance report yet"
        description="The SAP job that builds this report has not run yet. It refreshes once a day; an administrator can start it now with `npm run performance:sync` on the SAP sync worker."
      />
    );
  }
  return <PerformanceAnalysisView snapshot={stored.payload} />;
}
