import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminDatasetPanel } from "@/components/admin/AdminDatasetPanel";
import { SyncHealthPanel } from "@/components/admin/SyncHealthPanel";
import { getSyncHealth } from "@/lib/syncHealth";
import { DirectStockSyncPanel } from "@/components/admin/DirectStockSyncPanel";
import { getDirectStockSyncStatus } from "@/lib/stockSync";
import { ScheduledReportBackfillPanel } from "@/components/admin/ScheduledReportBackfillPanel";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminDatasetPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const [syncHealth, stockSyncStatus, backfills] = await Promise.all([
    getSyncHealth(),
    getDirectStockSyncStatus(),
    prisma.scheduledReportBackfill.findMany({
      orderBy: { requestedAt: "desc" }, take: 50,
      select: { id: true, startDate: true, endDate: true, status: true, requestedAt: true, completedAt: true, message: true },
    }),
  ]);

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Dataset</h1>
        <p className="mt-1 text-sm text-white/70">
          Monitor the server-to-server syncs. Previous Excel snapshots are retained only as an archive.
        </p>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        <SyncHealthPanel rows={syncHealth} />
        <DirectStockSyncPanel status={stockSyncStatus} />
        <ScheduledReportBackfillPanel initialRuns={backfills.map((run) => ({
          ...run,
          startDate: run.startDate.toISOString().slice(0, 10),
          endDate: run.endDate.toISOString().slice(0, 10),
        }))} />
        <AdminDatasetPanel />
      </div>
    </div>
  );
}
