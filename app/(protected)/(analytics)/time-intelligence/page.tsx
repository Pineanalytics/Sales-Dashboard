"use client";

import { useDashboardStore } from "@/lib/store";
import { TimeIntelligenceView } from "@/components/views/TimeIntelligenceView";

export default function TimeIntelligencePage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;
  return <TimeIntelligenceView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}
