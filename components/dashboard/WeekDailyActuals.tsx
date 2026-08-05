"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact } from "@/lib/format";
import { getWeeksInMonth, type WeekInfo } from "@/lib/weeklyTargets";

interface DailySalesRow {
  date: string;
  principal: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
}

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
 *  Overview — the one section on the page backed by DailySalesActual/DailyTarget
 *  (day-grain) rather than the Excel-sourced Dataset (month-grain), so it fetches its
 *  own data client-side (same pattern as AiInsightsCard.tsx) instead of reading the
 *  Zustand-held dataset. */
export function WeekDailyActuals({
  year,
  monthLabel,
  monthIndex,
  principal,
  selectedDayNames,
}: {
  year: string;
  monthLabel: string;
  monthIndex: number;
  principal: string | null;
  selectedDayNames: Set<string>;
}) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [dailySales, setDailySales] = useState<DailySalesRow[]>([]);
  const [weeklyTargets, setWeeklyTargets] = useState<WeeklyTargetRow[]>([]);
  const [dailyTargets, setDailyTargets] = useState<DailyTargetRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const monthStart = new Date(Date.UTC(Number(year), monthIndex, 1));
        const monthEnd = new Date(Date.UTC(Number(year), monthIndex + 1, 0));
        const today = new Date();
        // Never ask for future dates beyond today — DailySalesActual only ever has
        // history up to "now".
        const effectiveEnd = monthEnd < today ? monthEnd : today;

        const dailySalesUrl = `/api/dashboard/daily-sales?from=${toDateKey(monthStart)}&to=${toDateKey(effectiveEnd)}${principal ? `&principal=${encodeURIComponent(principal)}` : ""}`;
        const targetsUrl = `/api/dashboard/targets?year=${year}&monthLabel=${encodeURIComponent(monthLabel)}${principal ? `&principal=${encodeURIComponent(principal)}` : ""}`;

        const [salesRes, targetsRes] = await Promise.all([fetch(dailySalesUrl, { cache: "no-store" }), fetch(targetsUrl, { cache: "no-store" })]);
        const salesBody = await salesRes.json();
        const targetsBody = await targetsRes.json();
        if (!salesRes.ok) throw new Error(salesBody.error || "Failed to load daily sales.");
        if (!targetsRes.ok) throw new Error(targetsBody.error || "Failed to load targets.");

        if (!cancelled) {
          setDailySales(salesBody.rows ?? []);
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
  }, [year, monthLabel, monthIndex, principal]);

  if (status === "loading") {
    return <SectionCard title="Week & Daily Projection">Loading…</SectionCard>;
  }
  if (status === "error") {
    return <SectionCard title="Week & Daily Projection">Couldn&apos;t load day-grain actuals — the underlying feed may not have synced yet.</SectionCard>;
  }

  // Only count days whose weekday is in the Day Name filter — the one place on the
  // page that filter actually changes anything (see DayNameFilter.tsx).
  const filteredSales = dailySales.filter((r) => selectedDayNames.has(dayNameOf(r.date)));
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
