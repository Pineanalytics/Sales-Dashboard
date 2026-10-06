import { auth } from "@/auth";
import { performanceAccessFor } from "@/lib/performanceAnalysis/access";
import { PerformanceAnalysisView } from "@/components/performanceAnalysis/PerformanceAnalysisView";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

// The report is computed per request (/api/performance-analysis) from the SAP lines
// the bridge stores, for the period and principals chosen in the global filter bar.
// It is company-wide, so a session restricted to a team or to specific principals
// does not get it: those roles' figures are scoped per principal everywhere else,
// and these lines are not split that way.
export default async function PerformanceAnalysisPage() {
  const session = await auth();
  const access = await performanceAccessFor(session?.user);
  if (access === "denied") return null;
  if (access === "restricted") {
    return (
      <EmptyState
        title="Not available for restricted accounts"
        description="Performance Analysis shows company-wide figures across every principal. Accounts limited to a team or specific principals use Sales Performance and Principal KPIs instead."
      />
    );
  }
  return <PerformanceAnalysisView />;
}
