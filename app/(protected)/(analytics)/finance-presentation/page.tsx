import { auth } from "@/auth";
import { canAccessFinancials } from "@/lib/pageAccess";
import { getReceivablesSummary } from "@/lib/receivables";
import { getPayablesFinanceData } from "@/lib/payables";
import { getDebtByPrincipal } from "@/lib/financeDebtAttribution";
import { getGpMarginTargets } from "@/lib/gpMarginTargets";
import { FinancePresentationView } from "@/components/views/FinancePresentationView";

export const dynamic = "force-dynamic";

// The slides follow the global reporting period on the client: sales and gross profit come from
// the dataset, GP margin targets from /admin/gp-targets (lib/gpMarginTargets.ts), and the weekly ageing from
// /api/finance-presentation/ageing for the period's last month. Only the latest balances are
// loaded here, as totals: the slides show the receivables total and buckets, payables totals and the
// debt/payable split per principal, so no customer or vendor lists are loaded or sent to the browser.
export default async function FinancePresentationPage() {
  const session = await auth();
  const allowedPages = session?.user.allowedPages ?? [];
  if (!canAccessFinancials(session?.user.role, allowedPages)) return null;

  const canViewReceivables = session?.user.role === "ADMIN" || allowedPages.includes("receivables");

  const [receivables, payablesData, debtAttribution, gpMarginTargets] = await Promise.all([
    canViewReceivables ? getReceivablesSummary() : Promise.resolve(null),
    canViewReceivables ? getPayablesFinanceData() : Promise.resolve({ dashboard: null, byPrincipal: [] }),
    getDebtByPrincipal({ includeCustomers: false }),
    getGpMarginTargets(),
  ]);

  return (
    <FinancePresentationView
      receivables={receivables}
      payables={payablesData.dashboard}
      payablesByPrincipal={payablesData.byPrincipal}
      debtAttribution={debtAttribution}
      gpMarginTargets={gpMarginTargets}
    />
  );
}
