"use client";

import { useDashboardStore } from "@/lib/store";
import { CustomerBrandView } from "@/components/views/CustomerBrandView";

export default function CustomersPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;
  return <CustomerBrandView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}
