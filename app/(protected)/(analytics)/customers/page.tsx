"use client";

import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { CustomerBrandView } from "@/components/views/CustomerBrandView";
import { CANONICAL_MONTHS, resolvePeriodMonths } from "@/lib/timeIntelligence";
import type { CustomerPortfolioSummary } from "@/lib/customerPortfolio";
import { FullPageSpinner } from "@/components/ui/Spinner";

export default function CustomersPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const [portfolio, setPortfolio] = useState<CustomerPortfolioSummary | null>(null);
  const [error, setError] = useState(false);
  const periodKey = useMemo(
    () => resolvePeriodMonths(period).map(({ year, monthIndex }) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`).join(","),
    [period]
  );
  const principalKey = selectedPrincipalKeys.join(",");

  useEffect(() => {
    if (!periodKey) return;
    const controller = new AbortController();
    setPortfolio(null);
    setError(false);
    const params = new URLSearchParams();
    const selectedMonths = resolvePeriodMonths(period);
    for (const value of selectedMonths) params.append("period", `${value.year}-${String(value.monthIndex + 1).padStart(2, "0")}`);
    const latest = selectedMonths[selectedMonths.length - 1];
    if (latest) {
      params.append("latestPeriod", `${latest.year}-${String(latest.monthIndex + 1).padStart(2, "0")}`);
      const previousYear = latest.monthIndex === 0 ? String(Number(latest.year) - 1) : latest.year;
      const previousMonthIndex = latest.monthIndex === 0 ? 11 : latest.monthIndex - 1;
      params.append("previousPeriod", `${previousYear}-${String(previousMonthIndex + 1).padStart(2, "0")}`);
    }
    for (const value of selectedMonths) params.append("priorYearPeriod", `${Number(value.year) - 1}-${String(value.monthIndex + 1).padStart(2, "0")}`);
    for (const value of selectedPrincipalKeys) params.append("principal", value);
    fetch(`/api/customer-portfolio?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load customer portfolio.");
        return body.portfolio as CustomerPortfolioSummary;
      })
      .then((nextPortfolio) => { if (!controller.signal.aborted) setPortfolio(nextPortfolio); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  // selectedPrincipalKeys is represented by principalKey so array identity does not refetch unchanged scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, principalKey]);

  if (!dataset) return null;
  if (portfolio === null && !error) return <FullPageSpinner label="Loading customer portfolio analysis…" />;
  if (error) return <p className="py-16 text-center text-sm text-accent-red">Couldn&apos;t load customer portfolio analysis.</p>;
  const selectedMonths = resolvePeriodMonths(period);
  const latest = selectedMonths[selectedMonths.length - 1];
  const previousMonthIndex = latest ? (latest.monthIndex === 0 ? 11 : latest.monthIndex - 1) : 0;
  const previousYear = latest ? (latest.monthIndex === 0 ? String(Number(latest.year) - 1) : latest.year) : "";
  return (
    <CustomerBrandView
      portfolio={portfolio!}
      selectedPrincipalKey={selectedPrincipalKey}
      period={period}
      latestMonthLabel={latest ? `${CANONICAL_MONTHS[latest.monthIndex]} ${latest.year}` : "Latest month"}
      previousMonthLabel={latest ? `${CANONICAL_MONTHS[previousMonthIndex]} ${previousYear}` : "Previous month"}
    />
  );
}
