import { auth } from "@/auth";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReceivablesView } from "@/components/views/ReceivablesView";
import { getReceivablesDashboard } from "@/lib/receivables";

export const dynamic = "force-dynamic";

export default async function ReceivablesPage() {
  const session = await auth();
  const allowed = session?.user.role === "ADMIN" || (session?.user.allowedPages ?? []).includes("receivables");
  if (!allowed) return null;
  const data = await getReceivablesDashboard();
  if (!data) {
    return <EmptyState title="Receivables have not synced yet" description="The dashboard will display the first read-only SAP receivables snapshot after the scheduled sync runs." />;
  }
  return <ReceivablesView data={data} />;
}
