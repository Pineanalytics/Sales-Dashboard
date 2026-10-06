import { auth } from "@/auth";
import { canAccessFinancials } from "@/lib/pageAccess";
import { getReceivablesDashboard } from "@/lib/receivables";
import { getPayablesDashboard, getPayablesByPrincipal } from "@/lib/payables";
import { getDebtByPrincipal } from "@/lib/financeDebtAttribution";
import { FinancePresentationView } from "@/components/views/FinancePresentationView";

export const dynamic = "force-dynamic";

// The slides follow the global reporting period on the client: sales and gross profit come from
// the dataset, GP margin targets from lib/financePresentation.ts, and the weekly ageing from
// /api/finance-presentation/ageing for the period's last month. Only the latest balances are
// loaded here.
export default async function FinancePresentationPage() {
  const session = await auth();
  const allowedPages = session?.user.allowedPages ?? [];
  if (!canAccessFinancials(session?.user.role, allowedPages)) return null;

  const canViewReceivables = session?.user.role === "ADMIN" || allowedPages.includes("receivables");

  const [receivables, payables, payablesByPrincipal, debtAttribution] = await Promise.all([
    canViewReceivables ? getReceivablesDashboard() : Promise.resolve(null),
    canViewReceivables ? getPayablesDashboard() : Promise.resolve(null),
    canViewReceivables ? getPayablesByPrincipal() : Promise.resolve([]),
    getDebtByPrincipal(),
  ]);

  return <FinancePresentationView receivables={receivables} payables={payables} payablesByPrincipal={payablesByPrincipal} debtAttribution={debtAttribution} />;
}
