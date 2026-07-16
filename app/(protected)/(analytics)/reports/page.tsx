"use client";

import { useDashboardStore } from "@/lib/store";
import { useCurrentUser } from "@/components/dashboard/UserContext";
import { ReportCatalog } from "@/components/reports/ReportCatalog";

/** Downloadable reports hub. Dataset upload and snapshot history moved to
 *  /admin/dataset — admin-only concerns that don't belong in a page every
 *  viewer with report access sees. */
export default function ReportsPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPeriod = useDashboardStore((s) => s.selectedPeriod);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";

  if (!dataset) return null;

  return (
    <ReportCatalog
      dataset={dataset}
      period={selectedPeriod}
      principalKey={selectedPrincipalKey}
      allowedPages={user?.allowedPages ?? []}
      isAdmin={isAdmin}
    />
  );
}
