"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { formatCompact } from "@/lib/format";
import { getWeeksInMonth, type WeekInfo } from "@/lib/weeklyTargets";

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

/** "Aug 3 - Aug 9" — the real calendar range a "Week N" label covers, so it's
 *  clear (and verifiable) which days are counted without having to know the
 *  Monday-anchored week convention (a week belongs to whichever month
 *  contains its Monday — see lib/weeklyTargets.ts). A month whose 1st isn't a
 *  Monday has its first couple of days fall inside the PREVIOUS month's last
 *  week instead of any of this month's own Week 1-N cards — by design, kept
 *  consistent with how WeeklyTarget is entered admin-side — this range makes
 *  that visible rather than silently unclear. */
function formatWeekRange(weekStart: Date): string {
  const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(weekStart)} - ${fmt(weekEnd)}`;
}

/** Week 1-4 (or 5) + This Week + Daily Projection cards. Actuals come from a
 * compact, on-demand daily summary rather than the shared customer-detail payload. */
export function WeekDailyActuals({
  year,
  monthLabel,
  monthIndex,
  principals,
  selectedDayNames,
  monthActuals,
}: {
  year: string;
  monthLabel: string;
  monthIndex: number;
  principals: string[];
  selectedDayNames: Set<string>;
  monthActuals: {
    revenue: number;
    target: number | null;
    achievementPct: number | null;
    balance: number | null;
    momPct: number | null;
  };
}) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [weeklyTargets, setWeeklyTargets] = useState<WeeklyTargetRow[]>([]);
  const [dailyTargets, setDailyTargets] = useState<DailyTargetRow[]>([]);
  const [dailyActuals, setDailyActuals] = useState<{ date: string; revenue: number }[]>([]);
  const principalKey = principals.join(",");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const targetParams = new URLSearchParams({ year, monthLabel });
        const actualParams = new URLSearchParams({ period: `${year}-${String(monthIndex + 1).padStart(2, "0")}`, summary: "daily" });
        for (const principal of principals) {
          targetParams.append("principal", principal);
          actualParams.append("principal", principal);
        }
        const [targetsRes, actualsRes] = await Promise.all([
          fetch(`/api/dashboard/targets?${targetParams.toString()}`, { cache: "no-store" }),
          fetch(`/api/brand-customer?${actualParams.toString()}`, { cache: "no-store" }),
        ]);
        const [targetsBody, actualsBody] = await Promise.all([targetsRes.json(), actualsRes.json()]);
        if (!targetsRes.ok) throw new Error(targetsBody.error || "Failed to load targets.");
        if (!actualsRes.ok) throw new Error(actualsBody.error || "Failed to load actuals.");

        if (!cancelled) {
          setWeeklyTargets(targetsBody.weeklyTargets ?? []);
          setDailyTargets(targetsBody.dailyTargets ?? []);
          setDailyActuals(actualsBody.daily ?? []);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, monthLabel, monthIndex, principalKey, principals]);

  // Only count days whose weekday is in the Day Name filter — the one place on the
  // page that the shared Daily breakdown filter actually changes.
  const filteredSales = dailyActuals.filter((r) => selectedDayNames.has(dayNameOf(r.date)));
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
    const projection = weeklyTargets
      .filter((wt) => toDateKey(new Date(wt.weekStartDate)) === toDateKey(w.weekStartDate))
      .reduce((s, wt) => s + wt.targetValue, 0);
    let actual = 0;
    for (const [dateKey, revenue] of revenueByDate) {
      const d = new Date(`${dateKey}T00:00:00Z`);
      if (d >= weekStart && d <= weekEnd) actual += revenue;
    }
    const variance = actual - projection;
    const achievedPct = projection > 0 ? (actual / projection) * 100 : null;
    const isCurrentWeek = today >= weekStart && today <= weekEnd;
    return { label: w.weekLabel, index: i + 1, range: formatWeekRange(weekStart), projection, actual, variance, achievedPct, isCurrentWeek };
  });

  const currentWeek = weekCards.find((w) => w.isCurrentWeek) ?? weekCards[weekCards.length - 1];

  const todayProjection = targetByDate.get(todayKey) ?? 0;
  const todayActual = revenueByDate.get(todayKey) ?? 0;
  const todayVariance = todayActual - todayProjection;
  const todayAchievedPct = todayProjection > 0 ? (todayActual / todayProjection) * 100 : null;

  const WEEK_ACCENTS = ["green", "amber", "purple", "blue"] as const;

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ProgressCard title="This Month Actuals" pct={monthActuals.achievementPct} accent="green">
          <Row label="MTD Revenue" value={formatCompact(monthActuals.revenue)} />
          <Row label="Monthly Mission" value={monthActuals.target !== null ? formatCompact(monthActuals.target) : "N/A"} />
          <Row label="MoM" value={monthActuals.momPct !== null ? `${monthActuals.momPct >= 0 ? "+" : ""}${monthActuals.momPct.toFixed(0)}%` : "N/A"} negative={monthActuals.momPct !== null && monthActuals.momPct < 0} />
        </ProgressCard>
        <ProgressCard title="MTD % Achieved" pct={monthActuals.achievementPct} accent="red">
          <Row label="MTD Mission" value={monthActuals.target !== null ? formatCompact(monthActuals.target) : "N/A"} />
          <Row label="BOM Balance" value={monthActuals.balance !== null ? formatCompact(monthActuals.balance) : "N/A"} negative={monthActuals.balance !== null && monthActuals.balance > 0} />
        </ProgressCard>
        <ProgressCard title={`This Week Projection${currentWeek ? ` (${currentWeek.range})` : ""}`} pct={currentWeek?.achievedPct ?? null} accent="navy" loading={status === "loading"}>
          <Row label="Weekly Target" value={status === "loading" ? "…" : formatCompact(currentWeek?.projection ?? 0)} />
          <Row label="Actual" value={status === "loading" ? "…" : formatCompact(currentWeek?.actual ?? 0)} />
          <Row label="Variance" value={status === "loading" ? "…" : formatCompact(currentWeek?.variance ?? 0)} negative={(currentWeek?.variance ?? 0) < 0} />
        </ProgressCard>
        <ProgressCard title="Daily Projection vs Target" pct={todayAchievedPct} accent="navy" loading={status === "loading"}>
          <Row label="Daily Target" value={status === "loading" ? "…" : formatCompact(todayProjection)} />
          <Row label="Actual" value={status === "loading" ? "…" : formatCompact(todayActual)} />
          <Row label="Variance" value={status === "loading" ? "…" : formatCompact(todayVariance)} negative={todayVariance < 0} />
        </ProgressCard>
      </div>

      {status === "error" ? (
        <SectionCard title="Weekly Projections">Couldn&apos;t load targets — the underlying feed may not have synced yet.</SectionCard>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(235px,1fr))] gap-3">
          {weekCards.map((w, i) => (
            <SectionCard key={w.label} title={`Week ${w.index} (${w.range})${w.isCurrentWeek ? " — Current Week" : ""}`} accent={w.isCurrentWeek ? "purple" : WEEK_ACCENTS[i % WEEK_ACCENTS.length]}>
              <div className="flex items-center gap-3">
                <AchievementGauge pct={w.achievedPct} size={62} />
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <Row label="Projection" value={formatCompact(w.projection)} />
                  <Row label="Actual" value={formatCompact(w.actual)} />
                  <Row label="Variance" value={formatCompact(w.variance)} negative={w.variance < 0} />
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressCard({ title, pct, accent, loading = false, children }: { title: string; pct: number | null; accent: "green" | "red" | "navy"; loading?: boolean; children: ReactNode }) {
  return (
    <SectionCard title={title} accent={accent}>
      <div className="flex items-center gap-3">
        <AchievementGauge pct={loading ? null : pct} size={72} />
        <div className="min-w-0 flex-1 space-y-1 text-sm">{children}</div>
      </div>
    </SectionCard>
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
