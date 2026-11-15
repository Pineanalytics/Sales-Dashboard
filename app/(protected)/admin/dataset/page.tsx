import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminDatasetPanel } from "@/components/admin/AdminDatasetPanel";
import { SyncHealthPanel } from "@/components/admin/SyncHealthPanel";
import { getSyncHealth } from "@/lib/syncHealth";
import { DirectStockSyncPanel } from "@/components/admin/DirectStockSyncPanel";
import { getDirectStockSyncStatus } from "@/lib/stockSync";
import { getDeploymentInfo } from "@/lib/deployment";
import { AdminPage } from "@/components/admin/AdminPage";
import { DataFeedsPanel } from "@/components/admin/DataFeedsPanel";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminDatasetPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const [syncHealth, stockSyncStatus, feedKeys] = await Promise.all([
    getSyncHealth(),
    getDirectStockSyncStatus(),
    prisma.dataFeedKey.findMany({ orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] }),
  ]);

  return (
    <AdminPage title="Data & sync" description="Monitor the server-to-server syncs. Previous Excel snapshots are retained only as an archive.">
      <SyncHealthPanel rows={syncHealth} deployment={getDeploymentInfo()} />
      <DirectStockSyncPanel status={stockSyncStatus} />
      <DataFeedsPanel
        keys={feedKeys.map((key) => ({
          id: key.id,
          name: key.name,
          feed: key.feed,
          keyPrefix: key.keyPrefix,
          createdBy: key.createdBy,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          revokedAt: key.revokedAt?.toISOString() ?? null,
        }))}
      />
      <AdminDatasetPanel />
    </AdminPage>
  );
}
