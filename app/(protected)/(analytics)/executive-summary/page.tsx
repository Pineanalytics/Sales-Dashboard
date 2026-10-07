import { auth } from "@/auth";
import { getReceivablesSummary } from "@/lib/receivables";
import { ExecutiveSummaryClient } from "@/components/executiveSummary/ExecutiveSummaryClient";

export const dynamic = "force-dynamic";

export default async function ExecutiveSummaryPage() {
  const session = await auth();
  const allowedPages = session?.user.allowedPages ?? [];
  const canViewReceivables = session?.user.role === "ADMIN" || allowedPages.includes("receivables");
  // Totals only: the page shows the outstanding balance, the ageing buckets and the credit-limit
  // breach count, so it must not load (or ship to the browser) every customer and open item.
  const receivables = canViewReceivables ? await getReceivablesSummary() : null;

  return <ExecutiveSummaryClient receivables={receivables} canViewReceivables={canViewReceivables} />;
}
