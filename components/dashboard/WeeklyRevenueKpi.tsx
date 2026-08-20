"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { AchievementBadge } from "@/components/ui/Badge";
import { formatCompact } from "@/lib/format";
import { summarizeBrandCustomerForCurrentWeek } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

interface WeeklyTargetRow {
  weekLabel: string;
  weekStartDate: string;
  principal: string;
  targetValue: number;
}

/** Weekly Revenue KPI — sourced from the Excel-uploaded Brand&Customer Listing's
 *  real per-day dates (MonthlyBrandCustomerRow.date) now that the "Weekly
 *  Projection" sheet is retired (it was a single current-week-only snapshot with
 *  no history, per real-per-day data now covering the current month). Revenue is
 *  computed client-side from the already-loaded Dataset, same as every other KPI
 *  on these pages; the WeeklyTarget comparison is DB-backed (the same table TL
 *  Ranking and WeekDailyActuals already use) and needs its own fetch, since the
 *  Zustand-held Dataset doesn't carry it. */
export function WeeklyRevenueKpi({ dataset, principalKey }: { dataset: Dataset; principalKey: string | null }) {
  const week = summarizeBrandCustomerForCurrentWeek(dataset, principalKey);
  const [target, setTarget] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!week.weekLabel) {
      setTarget(null);
      return;
    }
    (async () => {
      try {
        const year = week.year;
        const monthLabel = week.monthLabel;
        const url = `/api/dashboard/targets?year=${year}&monthLabel=${encodeURIComponent(monthLabel)}${principalKey ? `&principal=${encodeURIComponent(principalKey)}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load Weekly Target.");
        if (!cancelled) {
          const weeklyTargets: WeeklyTargetRow[] = body.weeklyTargets ?? [];
          const weekStart = week.weekStartDate.toISOString().slice(0, 10);
          const sum = weeklyTargets
            .filter((wt) => new Date(wt.weekStartDate).toISOString().slice(0, 10) === weekStart)
            .reduce((s, wt) => s + wt.targetValue, 0);
          setTarget(sum);
        }
      } catch {
        if (!cancelled) setTarget(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // week.weekStartDate is a new Date instance every render (summarizeBrandCustomerForCurrentWeek
    // recomputes it fresh) — week.weekLabel alone already uniquely identifies the
    // week+month and only changes once a week, so it's the stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.weekLabel, principalKey]);

  const achievedPct = target !== null && target > 0 ? (week.revenue / target) * 100 : null;

  return (
    <KpiCard
      accent="growth"
      label="Weekly Revenue"
      value={<AnimatedValue value={week.revenue} format={formatCompact} />}
      sublabel={target !== null ? <AchievementBadge pct={achievedPct} /> : undefined}
    />
  );
}
