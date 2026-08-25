"use client";

import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { CustomerBrandView } from "@/components/views/CustomerBrandView";
import { resolvePeriodMonths } from "@/lib/timeIntelligence";
import type { MonthlyBrandCustomerRow } from "@/lib/types";
import { FullPageSpinner } from "@/components/ui/Spinner";

export default function CustomersPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const [rows, setRows] = useState<MonthlyBrandCustomerRow[] | null>(null);
  const [error, setError] = useState(false);
  const periodKey = useMemo(
    () => resolvePeriodMonths(period).map(({ year, monthIndex }) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`).join(","),
    [period]
  );
  const principalKey = selectedPrincipalKeys.join(",");

  useEffect(() => {
    if (!periodKey) return;
    const controller = new AbortController();
    setRows(null);
    setError(false);
    const params = new URLSearchParams();
    for (const value of periodKey.split(",")) params.append("period", value);
    for (const value of selectedPrincipalKeys) params.append("principal", value);
    fetch(`/api/brand-customer?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load customer detail.");
        return body.rows as MonthlyBrandCustomerRow[];
      })
      .then((nextRows) => { if (!controller.signal.aborted) setRows(nextRows); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [periodKey, principalKey, selectedPrincipalKeys]);

  if (!dataset) return null;
  if (rows === null && !error) return <FullPageSpinner label="Loading customer and brand detail…" />;
  if (error) return <p className="py-16 text-center text-sm text-accent-red">Couldn&apos;t load customer and brand detail.</p>;
  return <CustomerBrandView dataset={{ ...dataset, monthlyBrandCustomer: rows ?? [] }} selectedPrincipalKey={selectedPrincipalKey} period={period} />;
}
