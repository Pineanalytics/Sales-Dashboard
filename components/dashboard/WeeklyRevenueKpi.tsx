"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { AchievementBadge } from "@/components/ui/Badge";
import { formatCompact } from "@/lib/format";
import { CANONICAL_MONTHS, getCurrentMonthPeriod } from "@/lib/timeIntelligence";
import { getWeeksInMonth } from "@/lib/weeklyTargets";
import type { Dataset } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";

interface WeeklyTargetRow {
  weekLabel: string;
  weekStartDate: string;
  principal: string;
  targetValue: number;
}

/** Weekly Revenue KPI uses the compact daily customer/brand summary, keeping
 * transaction-level customer data out of the shared dashboard payload. */
export function WeeklyRevenueKpi({ dataset, principalKey }: { dataset: Dataset; principalKey: string | null }) {
  const selectedPrincipalKeys = useDashboardStore((state) => state.selectedPrincipalKeys);
  const [target, setTarget] = useState<number | null>(null);
  const [revenue, setRevenue] = useState(0);
  const currentPeriod = getCurrentMonthPeriod(dataset);
  const monthIndex = currentPeriod.month ? CANONICAL_MONTHS.indexOf(currentPeriod.month) : -1;
  const now = new Date();
  const currentWeek = monthIndex >= 0
    ? getWeeksInMonth(Number(currentPeriod.year), monthIndex).find((week) => now >= week.weekStartDate && now < new Date(week.weekStartDate.getTime() + 7 * 86400000))
    : undefined;
  const weekStart = currentWeek?.weekStartDate.toISOString().slice(0, 10) ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!currentPeriod.year || !currentPeriod.month || !weekStart) {
      setTarget(null);
      setRevenue(0);
      return;
    }
    (async () => {
      try {
        const params = new URLSearchParams({ year: currentPeriod.year, monthLabel: currentPeriod.month ?? "" });
        const actualParams = new URLSearchParams({ period: `${currentPeriod.year}-${String(monthIndex + 1).padStart(2, "0")}`, summary: "daily" });
        const principals = selectedPrincipalKeys.length > 0 ? selectedPrincipalKeys : principalKey ? [principalKey] : [];
        for (const principal of principals) {
          params.append("principal", principal);
          actualParams.append("principal", principal);
        }
        const [res, actualsRes] = await Promise.all([
          fetch(`/api/dashboard/targets?${params.toString()}`, { cache: "no-store" }),
          fetch(`/api/brand-customer?${actualParams.toString()}`, { cache: "no-store" }),
        ]);
        const [body, actualsBody] = await Promise.all([res.json(), actualsRes.json()]);
        if (!res.ok) throw new Error(body.error || "Failed to load Weekly Target.");
        if (!actualsRes.ok) throw new Error(actualsBody.error || "Failed to load weekly actuals.");
        if (!cancelled) {
          const weeklyTargets: WeeklyTargetRow[] = body.weeklyTargets ?? [];
          const sum = weeklyTargets
            .filter((wt) => new Date(wt.weekStartDate).toISOString().slice(0, 10) === weekStart)
            .reduce((s, wt) => s + wt.targetValue, 0);
          setTarget(sum);
          const weekEnd = new Date(`${weekStart}T00:00:00.000Z`).getTime() + 7 * 86400000;
          setRevenue((actualsBody.daily ?? [])
            .filter((row: { date: string }) => {
              const timestamp = new Date(`${row.date}T00:00:00.000Z`).getTime();
              return timestamp >= new Date(`${weekStart}T00:00:00.000Z`).getTime() && timestamp < weekEnd;
            })
            .reduce((sum: number, row: { revenue: number }) => sum + row.revenue, 0));
        }
      } catch {
        if (!cancelled) setTarget(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPeriod.year, currentPeriod.month, monthIndex, principalKey, selectedPrincipalKeys, weekStart]);

  const achievedPct = target !== null && target > 0 ? (revenue / target) * 100 : null;

  return (
    <KpiCard
      accent="growth"
      label="Weekly Revenue"
      value={<AnimatedValue value={revenue} format={formatCompact} />}
      sublabel={target !== null ? <AchievementBadge pct={achievedPct} /> : undefined}
    />
  );
}
