"use client";

import { useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { CoverageSnapshot } from "@/components/overview/CoverageSnapshot";
import { WeekDailyActuals } from "@/components/dashboard/WeekDailyActuals";
import { TlRankingTable } from "@/components/dashboard/TlRankingTable";
import { PrincipalMarginsBars } from "@/components/dashboard/PrincipalMarginsBars";
import { MissionProgressBars } from "@/components/dashboard/MissionProgressBars";
import { DayNameFilter } from "@/components/dashboard/DayNameFilter";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { DashboardControls, type DashboardView } from "@/components/dashboard/DashboardControls";
import { SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { formatCompact } from "@/lib/format";
import {
  summarizeSalesForPeriod,
  summarizeCoverageForPeriod,
  summarizeBrandCustomerByRepAndPrincipal,
  getCurrentMonthPeriod,
  getPreviousMonthPeriod,
  getPriorYearPeriod,
  CANONICAL_MONTHS,
  type PeriodSalesSummary,
  type PeriodSelection,
} from "@/lib/timeIntelligence";

function Row({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-strong">{label}</span>
      <span className={`font-semibold tabular-nums ${negative ? "text-red-600" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const selectedDayNames = useDashboardStore((s) => s.selectedDayNames);
  const [tab, setTab] = useState<DashboardView>("mtd");

  if (!dataset) return null;

  // Week 1-4/Daily/TL Ranking are always anchored to the real current calendar month
  // (matching the reference dashboard's "MTD Sales Overview" concept), independent of
  // whatever broader period the top selector happens to be on.
  const currentMonth = getCurrentMonthPeriod(dataset);
  const currentMonthIndex = currentMonth.month ? CANONICAL_MONTHS.indexOf(currentMonth.month) : new Date().getUTCMonth();
  const repRevenue = summarizeBrandCustomerByRepAndPrincipal(dataset, currentMonth, selectedPrincipalKey).map((r) => ({
    salesEmployee: r.salesEmployee,
    principal: r.principal,
    revenue: r.revenue,
  }));

  const h1Summary = summarizeSalesForPeriod(dataset, { kind: "H1", year: period.year }, selectedPrincipalKey);
  const h2Summary = summarizeSalesForPeriod(dataset, { kind: "H2", year: period.year }, selectedPrincipalKey);

  // "This Month Actuals" / "MTD % Achieved" — the reference dashboard's own top-row
  // pair, always anchored to the real current month like the Week/Daily cards below,
  // not whatever the global PeriodSelector happens to be set to.
  const mtdSummary = summarizeSalesForPeriod(dataset, currentMonth, selectedPrincipalKey);
  const previousMonthPeriod = getPreviousMonthPeriod(currentMonth);
  const previousMonthSummary = previousMonthPeriod ? summarizeSalesForPeriod(dataset, previousMonthPeriod, selectedPrincipalKey) : null;
  const momPct =
    previousMonthSummary && previousMonthSummary.revenue > 0
      ? ((mtdSummary.revenue - previousMonthSummary.revenue) / previousMonthSummary.revenue) * 100
      : null;
  const mtdBalance = mtdSummary.target !== null ? mtdSummary.target - mtdSummary.revenue : null;

  // "Total YTD Revenue" / "Total YTD Mission" / "Growth v SPLY" / "YTD % Achieved" —
  // the YTD Summary tab's own top row, fixed to YTD regardless of the global
  // PeriodSelector (same rationale as mtdSummary above for the MTD tab).
  const ytdPeriod: PeriodSelection = { kind: "YTD", year: period.year, month: period.month };
  const ytdSummary = summarizeSalesForPeriod(dataset, ytdPeriod, selectedPrincipalKey);
  const splySummary = summarizeSalesForPeriod(dataset, getPriorYearPeriod(ytdPeriod), selectedPrincipalKey);
  const yoyGrowth = ytdSummary.revenue - splySummary.revenue;
  const yoyPct = splySummary.revenue > 0 ? (yoyGrowth / splySummary.revenue) * 100 : null;
  const ytdCoverage = summarizeCoverageForPeriod(dataset, ytdPeriod, selectedPrincipalKey);
  const q1Summary = summarizeSalesForPeriod(dataset, { kind: "Q1", year: period.year }, selectedPrincipalKey);
  const q2Summary = summarizeSalesForPeriod(dataset, { kind: "Q2", year: period.year }, selectedPrincipalKey);
  const q3Summary = summarizeSalesForPeriod(dataset, { kind: "Q3", year: period.year }, selectedPrincipalKey);
  const q4Summary = summarizeSalesForPeriod(dataset, { kind: "Q4", year: period.year }, selectedPrincipalKey);

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <DashboardHero title={tab === "mtd" ? "MTD Sales Overview" : "YTD Summary"} />
      <DashboardControls view={tab} onViewChange={setTab} />

      {tab === "mtd" ? (
        <div className="flex flex-col gap-4 md:gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SectionCard title="This Month Actuals" accent="green">
                  <div className="flex flex-col gap-1.5 text-sm">
                    <Row label="Total MTD Revenue" value={formatCompact(mtdSummary.revenue)} />
                    <Row label="Monthly Mission" value={mtdSummary.target !== null ? formatCompact(mtdSummary.target) : "N/A"} />
                    <Row
                      label="vs Full Target"
                      value={mtdSummary.achievementPct !== null ? `${mtdSummary.achievementPct.toFixed(0)}%` : "N/A"}
                      negative={mtdSummary.achievementPct !== null && mtdSummary.achievementPct < 100}
                    />
                    <Row
                      label="MoM"
                      value={momPct !== null ? `${momPct >= 0 ? "+" : ""}${momPct.toFixed(0)}%` : "N/A"}
                      negative={momPct !== null && momPct < 0}
                    />
                  </div>
                </SectionCard>

                <SectionCard title="MTD % Achieved" accent="red">
                  <div className="flex items-center gap-4">
                    <AchievementGauge pct={mtdSummary.achievementPct} size={84} />
                    <div className="flex flex-1 flex-col gap-1.5 text-sm">
                      <Row label="MTD Mission" value={mtdSummary.target !== null ? formatCompact(mtdSummary.target) : "N/A"} />
                      <Row
                        label="BOM (Balance)"
                        value={mtdBalance !== null ? formatCompact(mtdBalance) : "N/A"}
                        negative={mtdBalance !== null && mtdBalance > 0}
                      />
                    </div>
                  </div>
                </SectionCard>
          </div>

          <details className="group rounded-xl border border-border bg-surface px-4 py-2.5 shadow-[0_2px_8px_rgba(10,31,82,0.05)]">
            <summary className="cursor-pointer text-xs font-semibold text-muted-strong marker:text-primary-blue">
              Daily breakdown options
              <span className="ml-2 font-normal text-muted">Filter the weekly and daily projection cards by weekday.</span>
            </summary>
            <div className="mt-3 max-w-md">
              <DayNameFilter />
            </div>
          </details>

          <WeekDailyActuals
            dataset={dataset}
            year={currentMonth.year}
            monthLabel={currentMonth.month ?? ""}
            monthIndex={currentMonthIndex}
            principal={selectedPrincipalKey}
            selectedDayNames={selectedDayNames}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
            <TlRankingTable
              repRevenue={repRevenue}
              principalFilter={selectedPrincipalKey}
              year={currentMonth.year}
              monthLabel={currentMonth.month ?? ""}
            />
            <CoverageSnapshot dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={currentMonth} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <SectionCard title="Total YTD Revenue" accent="green">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-2xl font-bold tabular-nums text-foreground">{formatCompact(ytdSummary.revenue)}</span>
                    <span className="text-xs text-muted-strong">H1: {formatCompact(h1Summary.revenue)} · H2: {formatCompact(h2Summary.revenue)}</span>
                  </div>
                </SectionCard>

                <SectionCard title="Total YTD Mission" accent="green">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-2xl font-bold tabular-nums text-foreground">
                      {ytdSummary.target !== null ? formatCompact(ytdSummary.target) : "N/A"}
                    </span>
                    <span className="text-xs text-muted-strong">
                      H1: {h1Summary.target !== null ? formatCompact(h1Summary.target) : "N/A"} · H2: {h2Summary.target !== null ? formatCompact(h2Summary.target) : "N/A"}
                    </span>
                  </div>
                </SectionCard>

                <SectionCard title="Growth v SPLY" accent="red">
                  <div className="flex flex-col gap-1.5 text-sm">
                    <Row label="SPLY Sales" value={formatCompact(splySummary.revenue)} />
                    <Row label="Value" value={formatCompact(yoyGrowth)} negative={yoyGrowth < 0} />
                    <Row label="YoY" value={yoyPct !== null ? `${yoyPct >= 0 ? "+" : ""}${yoyPct.toFixed(0)}%` : "N/A"} negative={yoyPct !== null && yoyPct < 0} />
                  </div>
                </SectionCard>

                <SectionCard title="YTD % Achieved" accent="navy">
                  <div className="flex justify-center">
                    <AchievementGauge pct={ytdSummary.achievementPct} size={84} />
                  </div>
                </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CoverageScoreCard coverage={ytdCoverage} />
            <QuarterAchievementCard title="Q1 Sales vs Mission" summary={q1Summary} accent="amber" />
            <QuarterAchievementCard title="Q2 Sales vs Mission" summary={q2Summary} accent="purple" />
            <SectionCard title="Profitability" accent="navy">
              <div className="flex flex-col gap-1.5 text-sm">
                <Row label="Gross Sales" value={formatCompact(ytdSummary.revenue)} />
                <Row label="Cost of Goods" value={formatCompact(ytdSummary.cogs)} />
                <Row label="Gross Profit" value={formatCompact(ytdSummary.grossProfit)} />
                <Row label="Margin" value={ytdSummary.grossMarginPct !== null ? `${ytdSummary.grossMarginPct.toFixed(0)}%` : "N/A"} />
              </div>
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <PrincipalMarginsBars dataset={dataset} period={ytdPeriod} />
            <MissionProgressBars title="H1 Mission & Actual" leftLabel="Q1 Revenue" left={q1Summary} rightLabel="Q2 Revenue" right={q2Summary} />
            <MissionProgressBars title="H2 Mission & Actual" leftLabel="Q3 Revenue" left={q3Summary} rightLabel="Q4 Revenue" right={q4Summary} />
          </div>
        </div>
      )}
    </div>
  );
}

function CoverageScoreCard({ coverage }: { coverage: ReturnType<typeof summarizeCoverageForPeriod> }) {
  return (
    <SectionCard title="Effective Coverage" accent="green">
      <div className="flex items-center gap-4">
        <AchievementGauge pct={coverage.productivityPct} size={76} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <Row label="Coverage" value={coverage.coverage.toLocaleString()} />
          <Row label="Productive calls" value={coverage.productiveCalls.toLocaleString()} />
          <Row label="Productivity" value={`${coverage.productivityPct.toFixed(0)}%`} negative={coverage.productivityPct < 100} />
        </div>
      </div>
    </SectionCard>
  );
}

function QuarterAchievementCard({ title, summary, accent }: { title: string; summary: PeriodSalesSummary; accent: "amber" | "purple" }) {
  return (
    <SectionCard title={title} accent={accent}>
      <div className="flex items-center gap-4">
        <AchievementGauge pct={summary.achievementPct} size={76} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <Row label="Revenue" value={formatCompact(summary.revenue)} />
          <Row label="Mission" value={summary.target !== null ? formatCompact(summary.target) : "N/A"} />
          <Row label="Achieved" value={summary.achievementPct !== null ? `${summary.achievementPct.toFixed(0)}%` : "N/A"} negative={summary.achievementPct !== null && summary.achievementPct < 100} />
        </div>
      </div>
    </SectionCard>
  );
}
