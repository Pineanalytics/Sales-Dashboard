import { auth } from "@/auth";
import { canAccessFinancials } from "@/lib/pageAccess";
import { getReceivablesDashboard } from "@/lib/receivables";
import { getGpTargetsForPeriod } from "@/lib/financeGpTarget";
import { getDebtByPrincipal } from "@/lib/financeDebtAttribution";
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

  const [receivables, gpTargets, debtAttribution] = await Promise.all([
    canViewReceivables ? getReceivablesDashboard() : Promise.resolve(null),
    canViewProfitability ? getGpTargetsForPeriod(currentYear, currentMonth) : Promise.resolve([]),
    getDebtByPrincipal(),
  ]);

  return <FinancePresentationView receivables={receivables} gpTargets={gpTargets} debtAttribution={debtAttribution} />;
}
