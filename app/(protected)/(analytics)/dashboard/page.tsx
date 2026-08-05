"use client";

import { useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { OverviewView } from "@/components/views/OverviewView";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { CoverageSnapshot } from "@/components/overview/CoverageSnapshot";
import { TopPerformers } from "@/components/overview/TopPerformers";
import { WeekDailyActuals } from "@/components/dashboard/WeekDailyActuals";
import { TlRankingTable } from "@/components/dashboard/TlRankingTable";
import { PrincipalMarginsBars } from "@/components/dashboard/PrincipalMarginsBars";
import { MissionProgressBars } from "@/components/dashboard/MissionProgressBars";
import { DayNameFilter } from "@/components/dashboard/DayNameFilter";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { DashboardPrincipalRail } from "@/components/dashboard/DashboardPrincipalRail";
import { SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { formatCompact } from "@/lib/format";
import {
  summarizeSalesForPeriod,
  summarizeBrandCustomerByRep,
  getCurrentMonthPeriod,
  getPreviousMonthPeriod,
  getPriorYearPeriod,
  CANONICAL_MONTHS,
  type PeriodSelection,
} from "@/lib/timeIntelligence";

type Tab = "mtd" | "ytd";

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
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);
  const selectedDayNames = useDashboardStore((s) => s.selectedDayNames);
  const [tab, setTab] = useState<Tab>("mtd");

  if (!dataset) return null;

  // Matches OverviewView's own internal "YTD until touched" fallback, so the
  // existing sections below stay consistent with what OverviewView is already showing.
  const effectivePeriod: PeriodSelection = hasUserSelectedPeriod
    ? period
    : { kind: "YTD", year: period.year, month: period.month };

  // Week 1-4/Daily/TL Ranking are always anchored to the real current calendar month
  // (matching the reference dashboard's "MTD Sales Overview" concept), independent of
  // whatever broader period the top selector happens to be on.
  const currentMonth = getCurrentMonthPeriod(dataset);
  const currentMonthIndex = currentMonth.month ? CANONICAL_MONTHS.indexOf(currentMonth.month) : new Date().getUTCMonth();
  const repRevenue = summarizeBrandCustomerByRep(dataset, currentMonth, selectedPrincipalKey).map((r) => ({
    salesEmployee: r.salesEmployee,
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

  return (
    <div className="flex flex-col gap-6">
      <DashboardHero title={tab === "mtd" ? "MTD Sales Overview" : "YTD Summary"} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-col gap-1.5">
            {(
              [
                { key: "mtd", label: "MTD Sales Overview" },
                { key: "ytd", label: "YTD Summary" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-2 text-left text-[12px] font-semibold transition-colors duration-200 ${
                  tab === t.key ? "bg-brand-orange text-white" : "bg-dark-navy text-white/90 hover:bg-primary-blue"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <DashboardPrincipalRail />
          {tab === "mtd" ? <DayNameFilter /> : null}
        </aside>

        <div className="flex flex-col gap-6">
          {tab === "mtd" ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <WeekDailyActuals
                year={currentMonth.year}
                monthLabel={currentMonth.month ?? ""}
                monthIndex={currentMonthIndex}
                principal={selectedPrincipalKey}
                selectedDayNames={selectedDayNames}
              />

              <TlRankingTable
                repRevenue={repRevenue}
                principalFilter={selectedPrincipalKey}
                year={currentMonth.year}
                monthLabel={currentMonth.month ?? ""}
              />

              <CoverageSnapshot dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={currentMonth} />

              <OverviewView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

              <GrowthComparison dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={effectivePeriod} />
              <CoverageSnapshot dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={effectivePeriod} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MissionProgressBars
                  title="H1 Mission & Actual"
                  leftLabel="Q1 Revenue"
                  left={summarizeSalesForPeriod(dataset, { kind: "Q1", year: period.year }, selectedPrincipalKey)}
                  rightLabel="Q2 Revenue"
                  right={summarizeSalesForPeriod(dataset, { kind: "Q2", year: period.year }, selectedPrincipalKey)}
                />
                <MissionProgressBars
                  title="H2 Mission & Actual"
                  leftLabel="Q3 Revenue"
                  left={summarizeSalesForPeriod(dataset, { kind: "Q3", year: period.year }, selectedPrincipalKey)}
                  rightLabel="Q4 Revenue"
                  right={summarizeSalesForPeriod(dataset, { kind: "Q4", year: period.year }, selectedPrincipalKey)}
                />
              </div>

              <SectionCard title="H1 vs H2" accent="blue">
                <div className="flex gap-6 text-sm">
                  <span>
                    H1: <b className="text-foreground">{formatCompact(h1Summary.revenue)}</b>
                  </span>
                  <span>
                    H2: <b className="text-foreground">{formatCompact(h2Summary.revenue)}</b>
                  </span>
                </div>
              </SectionCard>

              <PrincipalMarginsBars dataset={dataset} period={effectivePeriod} />
              <TopPerformers dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={effectivePeriod} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
