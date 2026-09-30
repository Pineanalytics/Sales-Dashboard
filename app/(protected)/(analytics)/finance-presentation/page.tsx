import { auth } from "@/auth";
import { canAccessFinancials } from "@/lib/pageAccess";
import { getReceivablesDashboard } from "@/lib/receivables";
import { getPayablesDashboard } from "@/lib/payables";
import { getGpTargetsForPeriod } from "@/lib/financeGpTarget";
import { getDebtByPrincipal } from "@/lib/financeDebtAttribution";
import { getAgeingSnapshotForMonth } from "@/lib/receivablesAgeing";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { FinancePresentationView } from "@/components/views/FinancePresentationView";

export const dynamic = "force-dynamic";

export default async function FinancePresentationPage() {
  const session = await auth();
  const allowedPages = session?.user.allowedPages ?? [];
  if (!canAccessFinancials(session?.user.role, allowedPages)) return null;

  const canViewReceivables = session?.user.role === "ADMIN" || allowedPages.includes("receivables");
  const canViewProfitability = session?.user.role === "ADMIN" || allowedPages.includes("profitability");

  const now = new Date();
  const currentYear = String(now.getUTCFullYear());
  const currentMonth = CANONICAL_MONTHS[now.getUTCMonth()];

  const [receivables, payables, gpTargets, debtAttribution, ageingTrend] = await Promise.all([
    canViewReceivables ? getReceivablesDashboard() : Promise.resolve(null),
    canViewReceivables ? getPayablesDashboard() : Promise.resolve(null),
    canViewProfitability ? getGpTargetsForPeriod(currentYear, currentMonth) : Promise.resolve([]),
    getDebtByPrincipal(),
    canViewReceivables ? getAgeingSnapshotForMonth(now.getUTCFullYear(), now.getUTCMonth()) : Promise.resolve(null),
  ]);

  return <FinancePresentationView receivables={receivables} payables={payables} gpTargets={gpTargets} debtAttribution={debtAttribution} ageingTrend={ageingTrend} />;
}
