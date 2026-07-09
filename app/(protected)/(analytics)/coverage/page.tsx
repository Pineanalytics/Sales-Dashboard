"use client";

import { useDashboardStore } from "@/lib/store";
import { CoverageView } from "@/components/views/CoverageView";

export default function CoveragePage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;
  return <CoverageView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}
