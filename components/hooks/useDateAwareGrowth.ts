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
}

/** Loads the compact daily SAP aggregate for a fair day-aligned MoM comparison. */
export function useDateAwareGrowth(period: PeriodSelection | null, selectedPrincipalKey: string | null) {
  const year = period?.year ?? "";
  const month = period?.month ? CANONICAL_MONTHS.indexOf(period.month) + 1 : 0;
  const requestKey = month ? `${year}|${month}|${selectedPrincipalKey ?? ""}` : null;
  const [result, setResult] = useState<{ key: string; data: DateMatchedGrowth } | null>(null);
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ year, month: String(month) });
    if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
    fetch(`/api/dashboard/date-aware-growth?${params}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Growth comparison unavailable"))))
      .then((data: DateMatchedGrowth) => setResult({ key: requestKey, data }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResult({ key: requestKey, data: { available: false } });
        }
      });
    return () => controller.abort();
  }, [month, requestKey, selectedPrincipalKey, year]);
  const data = requestKey && result?.key === requestKey ? result.data : null;
  const loading = Boolean(requestKey && result?.key !== requestKey);
  return { data, loading };
}
