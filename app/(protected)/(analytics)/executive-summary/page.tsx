import { auth } from "@/auth";
import { getReceivablesDashboard } from "@/lib/receivables";
import { ExecutiveSummaryClient } from "@/components/executiveSummary/ExecutiveSummaryClient";

export const dynamic = "force-dynamic";

export default async function ExecutiveSummaryPage() {
  const session = await auth();
  const allowedPages = session?.user.allowedPages ?? [];
  const canViewReceivables = session?.user.role === "ADMIN" || allowedPages.includes("receivables");
  const receivables = canViewReceivables ? await getReceivablesDashboard() : null;

  return <ExecutiveSummaryClient receivables={receivables} canViewReceivables={canViewReceivables} />;
}
