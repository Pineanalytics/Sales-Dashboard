"use client";

import { Suspense } from "react";
import { useDashboardStore } from "@/lib/store";
import { CoverageView } from "@/components/views/CoverageView";

function CoveragePageContent() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;
  return <CoverageView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}

// CoverageView reads the ?tab= deep-link param via useSearchParams(), which
// Next.js requires a Suspense boundary around (see StockPage's same pattern).
export default function CoveragePage() {
  return (
    <Suspense fallback={null}>
      <CoveragePageContent />
    </Suspense>
  );
}
