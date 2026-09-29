"use client";

import { Suspense } from "react";
import { useDashboardStore } from "@/lib/store";
import { OperationsLogisticsView } from "@/components/views/OperationsLogisticsView";

function StockPageContent() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;
  return <OperationsLogisticsView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}

// StockView (rendered as this page's "Stock Balance" tab) reads the ?status=
// deep-link param via useSearchParams(), which Next.js requires a Suspense
// boundary around (it otherwise bails the whole route out of static
// generation with a build warning).
export default function StockPage() {
  return (
    <Suspense fallback={null}>
      <StockPageContent />
    </Suspense>
  );
}
