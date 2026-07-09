"use client";

import { useDashboardStore } from "@/lib/store";
import { RepPerformanceView } from "@/components/views/RepPerformanceView";

export default function RepsPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;
  return <RepPerformanceView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}
