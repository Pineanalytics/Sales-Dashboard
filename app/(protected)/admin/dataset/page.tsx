import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminDatasetPanel } from "@/components/admin/AdminDatasetPanel";
import { SyncHealthPanel } from "@/components/admin/SyncHealthPanel";
import { getSyncHealth } from "@/lib/syncHealth";
import { DirectStockSyncPanel } from "@/components/admin/DirectStockSyncPanel";
import { getDirectStockSyncStatus } from "@/lib/stockSync";
import { getDeploymentInfo } from "@/lib/deployment";
import { AdminPage } from "@/components/admin/AdminPage";

export const dynamic = "force-dynamic";

export default async function AdminDatasetPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const [syncHealth, stockSyncStatus] = await Promise.all([getSyncHealth(), getDirectStockSyncStatus()]);

  return (
    <AdminPage title="Data & sync" description="Monitor the server-to-server syncs. Previous Excel snapshots are retained only as an archive.">
      <SyncHealthPanel rows={syncHealth} deployment={getDeploymentInfo()} />
      <DirectStockSyncPanel status={stockSyncStatus} />
      <AdminDatasetPanel />
    </AdminPage>
  );
}
