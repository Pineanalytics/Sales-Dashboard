import { auth } from "@/auth";
import { EmptyState } from "@/components/ui/EmptyState";
import { FinancialsView, type FinancialsTab } from "@/components/views/FinancialsView";
import { canAccessFinancials } from "@/lib/pageAccess";
import { getReceivablesDashboard } from "@/lib/receivables";

export const dynamic = "force-dynamic";

const TABS: FinancialsTab[] = ["receivables-summary", "credit-exposure", "open-items", "profitability"];

export default async function FinancialsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const session = await auth();
  const allowedPages = session?.user.allowedPages ?? [];
  const canViewReceivables = session?.user.role === "ADMIN" || allowedPages.includes("receivables");
  const canViewProfitability = session?.user.role === "ADMIN" || allowedPages.includes("profitability");
  if (!canAccessFinancials(session?.user.role, allowedPages)) return null;

  const query = await searchParams;
  const requestedTab = typeof query.tab === "string" && TABS.includes(query.tab as FinancialsTab) ? query.tab as FinancialsTab : undefined;
  const data = canViewReceivables ? await getReceivablesDashboard() : null;

  if (canViewReceivables && !data && !canViewProfitability) {
    return <EmptyState title="Receivables have not synced yet" description="The Financials module will display the first read-only SAP receivables snapshot after the scheduled sync runs." />;
  }

  return <FinancialsView initialTab={requestedTab} receivables={data} canViewReceivables={canViewReceivables && data !== null} canViewProfitability={canViewProfitability} />;
}
