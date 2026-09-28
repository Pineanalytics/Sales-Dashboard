import { auth } from "@/auth";
import { EmptyState } from "@/components/ui/EmptyState";
import { FinancialsView, type FinancialsTab } from "@/components/views/FinancialsView";
import { canAccessFinancials } from "@/lib/pageAccess";
import { getReceivablesDashboard } from "@/lib/receivables";
import { getFinanceSettings } from "@/lib/financeSettings";
import { getDebtByPrincipal } from "@/lib/financeDebtAttribution";
import { getAgeingSnapshotForMonth } from "@/lib/receivablesAgeing";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";

export const dynamic = "force-dynamic";

const TABS: FinancialsTab[] = [
  "receivables-summary",
  "credit-exposure",
  "open-items",
  "profitability",
  "sales-performance",
  "debtors",
  "total-outstanding",
  "ageing-trend",
];

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; status?: string | string[]; year?: string | string[]; month?: string | string[] }>;
}) {
  const session = await auth();
  const allowedPages = session?.user.allowedPages ?? [];
  const canViewReceivables = session?.user.role === "ADMIN" || allowedPages.includes("receivables");
  const canViewProfitability = session?.user.role === "ADMIN" || allowedPages.includes("profitability");
  if (!canAccessFinancials(session?.user.role, allowedPages)) return null;

  const query = await searchParams;
  const requestedTab = typeof query.tab === "string" && TABS.includes(query.tab as FinancialsTab) ? query.tab as FinancialsTab : undefined;
  const requestedCreditStatus = query.status === "over-limit" ? "over-limit" : undefined;
  const data = canViewReceivables ? await getReceivablesDashboard() : null;

  if (canViewReceivables && !data && !canViewProfitability) {
    return <EmptyState title="Receivables have not synced yet" description="The Financials module will display the first read-only SAP receivables snapshot after the scheduled sync runs." />;
  }

  const now = new Date();
  const ageingYear = typeof query.year === "string" && Number.isInteger(Number(query.year)) ? Number(query.year) : now.getUTCFullYear();
  const ageingMonthRaw = typeof query.month === "string" ? query.month : undefined;
  const ageingMonth = ageingMonthRaw && CANONICAL_MONTHS.includes(ageingMonthRaw) ? ageingMonthRaw : CANONICAL_MONTHS[now.getUTCMonth()];
  const ageingMonthIndex = CANONICAL_MONTHS.indexOf(ageingMonth);

  const [financeSettings, debtAttribution, ageingTrend] = await Promise.all([
    canViewProfitability ? getFinanceSettings() : Promise.resolve({ grossMarginTargetPct: null }),
    canViewProfitability || canViewReceivables ? getDebtByPrincipal() : Promise.resolve({ windowLabel: "Trailing 12 months", totalDebt: 0, unattributedDebt: 0, byPrincipal: [], customers: [] }),
    canViewReceivables ? getAgeingSnapshotForMonth(ageingYear, ageingMonthIndex) : Promise.resolve({ lastMonth: { label: "Last Month Ageing", asOfDate: now.toISOString(), snapshotDate: null, buckets: null, isApproximate: false }, weeks: [] }),
  ]);

  return (
    <FinancialsView
      initialTab={requestedTab}
      initialCreditStatus={requestedCreditStatus}
      receivables={data}
      canViewReceivables={canViewReceivables && data !== null}
      canViewProfitability={canViewProfitability}
      financeSettings={financeSettings}
      debtAttribution={debtAttribution}
      ageingTrend={ageingTrend}
      ageingYear={ageingYear}
      ageingMonth={ageingMonth}
    />
  );
}
