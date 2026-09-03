"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardStore } from "@/lib/store";
import { CoverageSnapshot } from "@/components/overview/CoverageSnapshot";
import { CoverageRoleToggle } from "@/components/overview/CoverageRoleToggle";
import { WeekDailyActuals } from "@/components/dashboard/WeekDailyActuals";
import { TlRankingTable } from "@/components/dashboard/TlRankingTable";
import { PrincipalMarginsBars } from "@/components/dashboard/PrincipalMarginsBars";
import { MissionProgressBars } from "@/components/dashboard/MissionProgressBars";
import { SalesSectionNav, type SalesSection } from "@/components/dashboard/SalesSectionNav";
import { SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { formatCompact } from "@/lib/format";
import {
  summarizeSalesForPeriod,
  summarizeCoverageForPeriod,
  summarizeSalesByPrincipal,
  getCurrentMonthPeriod,
  getPreviousMonthPeriod,
  getPriorYearPeriod,
  CANONICAL_MONTHS,
  type PeriodSalesSummary,
  type PeriodSelection,
  type RoleCategory,
} from "@/lib/timeIntelligence";

function Row({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-strong">{label}</span>
      <span className={`font-semibold tabular-nums ${negative ? "text-red-600" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

export default function DashboardPage({ embedded = false }: { embedded?: boolean }) {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const selectedDayNames = useDashboardStore((s) => s.selectedDayNames);
  const setSalesSection = useDashboardStore((s) => s.setSalesSection);
  const router = useRouter();
  const [coverageRole, setCoverageRole] = useState<Extract<RoleCategory, "primary" | "secondary">>("primary");

  if (!dataset) return null;

  // PrincipalSelector stores the raw principal/location labels selected by the
  // user. Pass that exact set to every executive API so multi-select scope is
  // preserved rather than collapsing back to an all-principal request.
  const selectedPrincipalNames = selectedPrincipalKeys;
  // The calendar filter chooses the reporting month. Full Month and MTD retain
  // the original operational layout (weekly targets, ranking and coverage);
  // choosing Year to Date restores the original executive/YTD module set.
  const selectedMonth: PeriodSelection = period.month
    ? { kind: "MONTH", year: period.year, month: period.month }
    : getCurrentMonthPeriod(dataset);
  const selectedMonthIndex = selectedMonth.month ? CANONICAL_MONTHS.indexOf(selectedMonth.month) : new Date().getUTCMonth();
  const monthSummary = summarizeSalesForPeriod(dataset, selectedMonth, selectedPrincipalKey);
  const previousMonthPeriod = getPreviousMonthPeriod(selectedMonth);
  const previousMonthSummary = previousMonthPeriod ? summarizeSalesForPeriod(dataset, previousMonthPeriod, selectedPrincipalKey) : null;
  const momPct =
    previousMonthSummary && previousMonthSummary.revenue > 0
      ? ((monthSummary.revenue - previousMonthSummary.revenue) / previousMonthSummary.revenue) * 100
      : null;
  const monthBalance = monthSummary.target !== null ? monthSummary.target - monthSummary.revenue : null;
  const principalRevenue = Array.from(summarizeSalesByPrincipal(dataset, selectedMonth).values())
    .filter((r) => !selectedPrincipalKey || r.principalKey === selectedPrincipalKey)
    .map((r) => ({ principal: r.principal, revenue: r.revenue }));
  const h1Summary = summarizeSalesForPeriod(dataset, { kind: "H1", year: period.year }, selectedPrincipalKey);
  const h2Summary = summarizeSalesForPeriod(dataset, { kind: "H2", year: period.year }, selectedPrincipalKey);
  const ytdPeriod: PeriodSelection = { kind: "YTD", year: period.year, month: period.month };
  const ytdSummary = summarizeSalesForPeriod(dataset, ytdPeriod, selectedPrincipalKey);
  const splySummary = summarizeSalesForPeriod(dataset, getPriorYearPeriod(ytdPeriod), selectedPrincipalKey);
  const yoyGrowth = ytdSummary.revenue - splySummary.revenue;
  const yoyPct = splySummary.revenue > 0 ? (yoyGrowth / splySummary.revenue) * 100 : null;
  const ytdCoverage = summarizeCoverageForPeriod(dataset, ytdPeriod, selectedPrincipalKey, coverageRole);
  const q1Summary = summarizeSalesForPeriod(dataset, { kind: "Q1", year: period.year }, selectedPrincipalKey);
  const q2Summary = summarizeSalesForPeriod(dataset, { kind: "Q2", year: period.year }, selectedPrincipalKey);
  const q3Summary = summarizeSalesForPeriod(dataset, { kind: "Q3", year: period.year }, selectedPrincipalKey);
  const q4Summary = summarizeSalesForPeriod(dataset, { kind: "Q4", year: period.year }, selectedPrincipalKey);

  const selectSalesSection = (section: SalesSection) => {
    setSalesSection(section);
    if (section !== "executive") router.push("/sales");
  };

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      {!embedded ? <SalesSectionNav active="executive" onSelect={selectSalesSection} /> : null}
      {period.kind === "YTD" ? (
        <div className="flex flex-col gap-3 md:gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SectionCard title="Total YTD Revenue" accent="green">
              <div className="flex flex-col gap-1.5">
                <span className="text-2xl font-bold tabular-nums text-foreground">{formatCompact(ytdSummary.revenue)}</span>
                <span className="text-xs text-muted-strong">H1: {formatCompact(h1Summary.revenue)} · H2: {formatCompact(h2Summary.revenue)}</span>
              </div>
            </SectionCard>
            <SectionCard title="Total YTD Mission" accent="green">
              <div className="flex flex-col gap-1.5">
                <span className="text-2xl font-bold tabular-nums text-foreground">{ytdSummary.target !== null ? formatCompact(ytdSummary.target) : "N/A"}</span>
                <span className="text-xs text-muted-strong">H1: {h1Summary.target !== null ? formatCompact(h1Summary.target) : "N/A"} · H2: {h2Summary.target !== null ? formatCompact(h2Summary.target) : "N/A"}</span>
              </div>
            </SectionCard>
            <SectionCard title="Growth v SPLY" accent="red">
              <div className="flex flex-col gap-1.5 text-sm">
                <Row label="SPLY Sales" value={formatCompact(splySummary.revenue)} />
                <Row label="Value" value={formatCompact(yoyGrowth)} negative={yoyGrowth < 0} />
                <Row label="YoY" value={yoyPct !== null ? `${yoyPct >= 0 ? "+" : ""}${yoyPct.toFixed(0)}%` : "N/A"} negative={yoyPct !== null && yoyPct < 0} />
              </div>
            </SectionCard>
            <SectionCard title="YTD % Achieved" accent="navy"><div className="flex justify-center"><AchievementGauge pct={ytdSummary.achievementPct} size={84} /></div></SectionCard>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CoverageScoreCard coverage={ytdCoverage} role={coverageRole} onRoleChange={setCoverageRole} />
            <QuarterAchievementCard title="Q1 Sales vs Mission" summary={q1Summary} accent="amber" />
            <QuarterAchievementCard title="Q2 Sales vs Mission" summary={q2Summary} accent="purple" />
            <SectionCard title="Profitability" accent="navy"><div className="flex flex-col gap-1.5 text-sm"><Row label="Gross Sales" value={formatCompact(ytdSummary.revenue)} /><Row label="Cost of Goods" value={formatCompact(ytdSummary.cogs)} /><Row label="Gross Profit" value={formatCompact(ytdSummary.grossProfit)} /><Row label="Margin" value={ytdSummary.grossMarginPct !== null ? `${ytdSummary.grossMarginPct.toFixed(0)}%` : "N/A"} /></div></SectionCard>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <PrincipalMarginsBars dataset={dataset} period={ytdPeriod} />
            <MissionProgressBars title="H1 Mission & Actual" leftLabel="Q1 Revenue" left={q1Summary} rightLabel="Q2 Revenue" right={q2Summary} />
            <MissionProgressBars title="H2 Mission & Actual" leftLabel="Q3 Revenue" left={q3Summary} rightLabel="Q4 Revenue" right={q4Summary} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 md:gap-4">
          <WeekDailyActuals
            year={selectedMonth.year}
            monthLabel={selectedMonth.month ?? ""}
            monthIndex={selectedMonthIndex}
            principals={selectedPrincipalNames}
            selectedDayNames={selectedDayNames}
            monthActuals={{
              revenue: monthSummary.revenue,
              target: monthSummary.target,
              achievementPct: monthSummary.achievementPct,
              balance: monthBalance,
              momPct,
            }}
          />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
            <TlRankingTable
              dataset={dataset}
              principalRevenue={principalRevenue}
              principalFilters={selectedPrincipalNames}
              year={selectedMonth.year}
              monthLabel={selectedMonth.month ?? ""}
            />
            <CoverageSnapshot dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={selectedMonth} role={coverageRole} onRoleChange={setCoverageRole} />
          </div>
        </div>
      )}
    </div>
  );
}

function CoverageScoreCard({ coverage, role, onRoleChange }: { coverage: ReturnType<typeof summarizeCoverageForPeriod>; role: Extract<RoleCategory, "primary" | "secondary">; onRoleChange: (role: Extract<RoleCategory, "primary" | "secondary">) => void }) {
  return <SectionCard title="Effective Coverage" accent="green" action={<CoverageRoleToggle value={role} onChange={onRoleChange} />}><div className="flex items-center gap-4"><AchievementGauge pct={coverage.productivityPct} size={76} /><div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm"><Row label="Coverage" value={coverage.coverage.toLocaleString()} /><Row label="Productive calls" value={coverage.productiveCalls.toLocaleString()} /><Row label="Productivity" value={`${coverage.productivityPct.toFixed(0)}%`} negative={coverage.productivityPct < 100} /></div></div></SectionCard>;
}

function QuarterAchievementCard({ title, summary, accent }: { title: string; summary: PeriodSalesSummary; accent: "amber" | "purple" }) {
  return <SectionCard title={title} accent={accent}><div className="flex items-center gap-4"><AchievementGauge pct={summary.achievementPct} size={76} /><div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm"><Row label="Revenue" value={formatCompact(summary.revenue)} /><Row label="Mission" value={summary.target !== null ? formatCompact(summary.target) : "N/A"} /><Row label="Achieved" value={summary.achievementPct !== null ? `${summary.achievementPct.toFixed(0)}%` : "N/A"} negative={summary.achievementPct !== null && summary.achievementPct < 100} /></div></div></SectionCard>;
}
