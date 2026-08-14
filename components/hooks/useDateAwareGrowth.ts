"use client";

import { useEffect, useState } from "react";
import { CANONICAL_MONTHS, type PeriodSelection } from "@/lib/timeIntelligence";

export interface DateMatchedGrowthWindow {
  from: string;
  through: string;
  revenue: number | null;
  rows: number;
}

export interface DateMatchedGrowth {
  available: boolean;
  asOf?: string;
  current?: DateMatchedGrowthWindow;
  mom?: DateMatchedGrowthWindow;
  yoy?: DateMatchedGrowthWindow;
}

/** Loads the compact daily SAP aggregate for fair partial-month comparisons. */
export function useDateAwareGrowth(period: PeriodSelection, selectedPrincipalKey: string | null) {
  const [data, setData] = useState<DateMatchedGrowth | null>(null);
  const [loading, setLoading] = useState(Boolean(period.month));
  useEffect(() => {
    const month = period.month ? CANONICAL_MONTHS.indexOf(period.month) + 1 : 0;
    if (!month) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    const params = new URLSearchParams({ year: period.year, month: String(month) });
    if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
    fetch(`/api/dashboard/date-aware-growth?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Growth comparison unavailable"))))
      .then((result: DateMatchedGrowth) => setData(result))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setData({ available: false });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period.year, period.month, selectedPrincipalKey]);
  return { data, loading };
}
