"use client";

import { useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { OverviewView } from "@/components/views/OverviewView";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { CoverageSnapshot } from "@/components/overview/CoverageSnapshot";
import { TopPerformers } from "@/components/overview/TopPerformers";
import { AiInsightsCard } from "@/components/dashboard/AiInsightsCard";
import { WeekDailyActuals } from "@/components/dashboard/WeekDailyActuals";
import { TlRankingTable } from "@/components/dashboard/TlRankingTable";
import { PrincipalMarginsBars } from "@/components/dashboard/PrincipalMarginsBars";
import { MissionProgressBars } from "@/components/dashboard/MissionProgressBars";
import { DayNameFilter } from "@/components/dashboard/DayNameFilter";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact } from "@/lib/format";
import {
  summarizeSalesForPeriod,
  summarizeBrandCustomerByRep,
  getCurrentMonthPeriod,
  CANONICAL_MONTHS,
  type PeriodSelection,
} from "@/lib/timeIntelligence";

type Tab = "mtd" | "ytd";

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-full bg-background-elevated p-1 w-fit">
        {(
          [
            { key: "mtd", label: "MTD Sales Overview" },
            { key: "ytd", label: "YTD Summary" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ${
              tab === t.key
                ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                : "text-muted-strong hover:text-brand-orange"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mtd" ? (
        <>
          <AiInsightsCard />
          <OverviewView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />

          <DayNameFilter />
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
        </>
      ) : (
        <>
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

          <SectionCard title="H1 vs H2">
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
  );
}
