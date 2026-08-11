"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact } from "@/lib/format";
import { getWeeksInMonth, type WeekInfo } from "@/lib/weeklyTargets";
import type { Dataset } from "@/lib/types";

interface WeeklyTargetRow {
  weekLabel: string;
  weekStartDate: string;
  principal: string;
  targetValue: number;
}

interface DailyTargetRow {
  date: string;
  principal: string;
  targetValue: number;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayNameOf(dateKey: string): string {
  // dateKey is a UTC-midnight "YYYY-MM-DD" — parse as UTC to get a stable weekday
  // regardless of the browser's local timezone.
  const d = new Date(`${dateKey}T00:00:00Z`);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()];
}

/** Week 1-4 (or 5) + This Week + Daily Projection cards for the redesigned Executive
 *  Overview. Actuals are read straight from the already-loaded Excel Dataset's
 *  Brand&Customer Listing (MonthlyBrandCustomerRow.date carries a real per-day
 *  date for the current month — see lib/parseWorkbook.ts), the same reliable,
 *  Task-Scheduler-fed pipeline WeeklyRevenueKpi.tsx uses. Previously sourced from
 *  DailySalesActual, a separate table fed only by a manually-triggered script
 *  (scripts/db-bridge/sales-sync.ts — "not wired into Task Scheduler," per its
 *  own header comment) that wasn't reliably kept current, which is why this card
 *  was showing all-zero actuals in production. Targets (WeeklyTarget/DailyTarget)
 *  are still DB-backed and still need their own fetch, since the Dataset doesn't
 *  carry them. */
export function WeekDailyActuals({
  dataset,
  year,
  monthLabel,
  monthIndex,
  principal,
  selectedDayNames,
}: {
  dataset: Dataset;
  year: string;
  monthLabel: string;
  monthIndex: number;
  principal: string | null;
  selectedDayNames: Set<string>;
}) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [weeklyTargets, setWeeklyTargets] = useState<WeeklyTargetRow[]>([]);
  const [dailyTargets, setDailyTargets] = useState<DailyTargetRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const targetsUrl = `/api/dashboard/targets?year=${year}&monthLabel=${encodeURIComponent(monthLabel)}${principal ? `&principal=${encodeURIComponent(principal)}` : ""}`;
        const targetsRes = await fetch(targetsUrl, { cache: "no-store" });
        const targetsBody = await targetsRes.json();
        if (!targetsRes.ok) throw new Error(targetsBody.error || "Failed to load targets.");

        if (!cancelled) {
          setWeeklyTargets(targetsBody.weeklyTargets ?? []);
          setDailyTargets(targetsBody.dailyTargets ?? []);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, monthLabel, principal]);

  if (status === "loading") {
    return <SectionCard title="Week & Daily Projection">Loading…</SectionCard>;
  }
  if (status === "error") {
    return <SectionCard title="Week & Daily Projection">Couldn&apos;t load targets — the underlying feed may not have synced yet.</SectionCard>;
  }

  // Same raw-Principal-string match Brand&Customer Listing always uses (location-
  // granular, not brand-normalized — see lib/timeIntelligence.ts's filterBrandCustomer).
  const monthBrandCustomer = dataset.monthlyBrandCustomer.filter(
    (r) => r.year === year && r.monthIndex === monthIndex && (!principal || r.principal === principal)
  );

  // Only count days whose weekday is in the Day Name filter — the one place on the
  // page that filter actually changes anything (see DayNameFilter.tsx).
  const filteredSales = monthBrandCustomer.filter((r) => selectedDayNames.has(dayNameOf(r.date)));
  const filteredDailyTargets = dailyTargets.filter((r) => selectedDayNames.has(dayNameOf(toDateKey(new Date(r.date)))));

  const revenueByDate = new Map<string, number>();
  for (const r of filteredSales) revenueByDate.set(r.date, (revenueByDate.get(r.date) ?? 0) + r.revenue);
  const targetByDate = new Map<string, number>();
  for (const r of filteredDailyTargets) {
    const key = toDateKey(new Date(r.date));
    targetByDate.set(key, (targetByDate.get(key) ?? 0) + r.targetValue);
  }

  const weeks: WeekInfo[] = getWeeksInMonth(Number(year), monthIndex);
  const today = new Date();
  const todayKey = toDateKey(today);

  const weekCards = weeks.map((w, i) => {
    const weekStart = w.weekStartDate;
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    const projection = weeklyTargets.filter((wt) => wt.weekLabel === w.weekLabel).reduce((s, wt) => s + wt.targetValue, 0);
    let actual = 0;
    for (const [dateKey, revenue] of revenueByDate) {
      const d = new Date(`${dateKey}T00:00:00Z`);
      if (d >= weekStart && d <= weekEnd) actual += revenue;
    }
    const variance = actual - projection;
    const achievedPct = projection > 0 ? (actual / projection) * 100 : null;
    const isCurrentWeek = today >= weekStart && today <= weekEnd;
    return { label: w.weekLabel, index: i + 1, projection, actual, variance, achievedPct, isCurrentWeek };
  });

  const currentWeek = weekCards.find((w) => w.isCurrentWeek) ?? weekCards[weekCards.length - 1];

  const todayProjection = targetByDate.get(todayKey) ?? 0;
  const todayActual = revenueByDate.get(todayKey) ?? 0;
  const todayVariance = todayActual - todayProjection;

  const WEEK_ACCENTS = ["green", "amber", "purple", "blue"] as const;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <SectionCard title="This Week Projection" accent="navy">
        <div className="flex flex-col gap-1.5 text-sm">
          <Row label="Weeks Projection" value={formatCompact(currentWeek?.projection ?? 0)} />
          <Row label="Actuals" value={formatCompact(currentWeek?.actual ?? 0)} />
          <Row label="Variance" value={formatCompact(currentWeek?.variance ?? 0)} negative={(currentWeek?.variance ?? 0) < 0} />
        </div>
      </SectionCard>

      <SectionCard title="Daily Projection" accent="navy">
        <div className="flex flex-col gap-1.5 text-sm">
          <Row label="Daily Projection" value={formatCompact(todayProjection)} />
          <Row label="Actuals" value={formatCompact(todayActual)} />
          <Row label="Variance" value={formatCompact(todayVariance)} negative={todayVariance < 0} />
        </div>
      </SectionCard>

      {weekCards.map((w, i) => (
        <SectionCard key={w.label} title={`Week ${w.index}${w.isCurrentWeek ? " (Current Week)" : ""}`} accent={w.isCurrentWeek ? "purple" : WEEK_ACCENTS[i % WEEK_ACCENTS.length]}>
          <div className="flex flex-col gap-1.5 text-sm">
            <Row label="Projection" value={formatCompact(w.projection)} />
            <Row label="Actual" value={formatCompact(w.actual)} />
            <Row label="Variance" value={formatCompact(w.variance)} negative={w.variance < 0} />
            <Row label="Achieved" value={w.achievedPct !== null ? `${w.achievedPct.toFixed(0)}%` : "N/A"} negative={w.achievedPct !== null && w.achievedPct < 100} />
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

function Row({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-strong">{label}</span>
      <span className={`font-semibold tabular-nums ${negative ? "text-accent-red" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
