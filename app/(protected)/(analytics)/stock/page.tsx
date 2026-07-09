"use client";

import { useDashboardStore } from "@/lib/store";
import { StockView } from "@/components/views/StockView";

export default function StockPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;
  return <StockView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}
