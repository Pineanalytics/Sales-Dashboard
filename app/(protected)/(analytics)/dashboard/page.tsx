"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardStore } from "@/lib/store";
import { CoverageSnapshot } from "@/components/overview/CoverageSnapshot";
import { WeekDailyActuals } from "@/components/dashboard/WeekDailyActuals";
import { TlRankingTable } from "@/components/dashboard/TlRankingTable";
import { PrincipalMarginsBars } from "@/components/dashboard/PrincipalMarginsBars";
import { SalesSectionNav, type SalesSection } from "@/components/dashboard/SalesSectionNav";
import { SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { formatCompact } from "@/lib/format";
import {
  summarizeSalesForPeriod,
  summarizeSalesByPrincipal,
  getPreviousMonthPeriod,
  getPriorYearPeriod,
  CANONICAL_MONTHS,
  resolvePeriodMonths,
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
  const periodMonths = resolvePeriodMonths(period);
  const selectedMonth = periodMonths.length === 1 ? periodMonths[0] : null;
  const summary = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);
  const previousMonthPeriod = getPreviousMonthPeriod(period);
  const previousMonthSummary = previousMonthPeriod ? summarizeSalesForPeriod(dataset, previousMonthPeriod, selectedPrincipalKey) : null;
  const momPct =
    previousMonthSummary && previousMonthSummary.revenue > 0
      ? ((summary.revenue - previousMonthSummary.revenue) / previousMonthSummary.revenue) * 100
      : null;
  const balance = summary.target !== null ? summary.target - summary.revenue : null;
  const priorYearSummary = summarizeSalesForPeriod(dataset, getPriorYearPeriod(period), selectedPrincipalKey);
  const yoyGrowth = summary.revenue - priorYearSummary.revenue;
  const yoyPct = priorYearSummary.revenue > 0 ? (yoyGrowth / priorYearSummary.revenue) * 100 : null;
  const principalRevenue = selectedMonth
    ? Array.from(summarizeSalesByPrincipal(dataset, period).values())
        .filter((r) => !selectedPrincipalKey || r.principalKey === selectedPrincipalKey)
        .map((r) => ({ principal: r.principal, revenue: r.revenue }))
    : [];

  const selectSalesSection = (section: SalesSection) => {
    setSalesSection(section);
    if (section !== "executive") router.push("/sales");
  };

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      {!embedded ? <SalesSectionNav active="executive" onSelect={selectSalesSection} /> : null}
      <div className="flex flex-col gap-3 md:gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SectionCard title={`${period.kind} Revenue`} accent="green">
            <span className="text-2xl font-bold tabular-nums text-foreground">{formatCompact(summary.revenue)}</span>
            <span className="mt-1 block text-xs text-muted-strong">{summary.monthsIncluded} month{summary.monthsIncluded === 1 ? "" : "s"} included</span>
          </SectionCard>
          <SectionCard title={`${period.kind} Mission`} accent="green">
            <span className="text-2xl font-bold tabular-nums text-foreground">{summary.target !== null ? formatCompact(summary.target) : "N/A"}</span>
            <span className="mt-1 block text-xs text-muted-strong">{balance !== null ? `${balance >= 0 ? "Balance" : "Ahead by"} ${formatCompact(Math.abs(balance))}` : "No target loaded"}</span>
          </SectionCard>
          <SectionCard title="Growth vs prior year" accent="red">
            <div className="flex flex-col gap-1.5 text-sm">
              <Row label="Prior-year sales" value={formatCompact(priorYearSummary.revenue)} />
              <Row label="Value" value={formatCompact(yoyGrowth)} negative={yoyGrowth < 0} />
              <Row label="YoY" value={yoyPct !== null ? `${yoyPct >= 0 ? "+" : ""}${yoyPct.toFixed(0)}%` : "N/A"} negative={yoyPct !== null && yoyPct < 0} />
            </div>
          </SectionCard>
          <SectionCard title={`${period.kind} % Achieved`} accent="navy">
            <div className="flex justify-center"><AchievementGauge pct={summary.achievementPct} size={84} /></div>
          </SectionCard>
        </div>

        {selectedMonth ? (
          <>
          <WeekDailyActuals
            year={selectedMonth.year}
            monthLabel={CANONICAL_MONTHS[selectedMonth.monthIndex]}
            monthIndex={selectedMonth.monthIndex}
            principals={selectedPrincipalNames}
            selectedDayNames={selectedDayNames}
            monthActuals={{
              revenue: summary.revenue,
              target: summary.target,
              achievementPct: summary.achievementPct,
              balance,
              momPct,
            }}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
            <TlRankingTable
              dataset={dataset}
              principalRevenue={principalRevenue}
              principalFilters={selectedPrincipalNames}
              year={selectedMonth.year}
              monthLabel={CANONICAL_MONTHS[selectedMonth.monthIndex]}
            />
            <CoverageSnapshot dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} role={coverageRole} onRoleChange={setCoverageRole} />
          </div>
          </>
        ) : (
          <CoverageSnapshot dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} role={coverageRole} onRoleChange={setCoverageRole} />
        )}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SectionCard title="Profitability" accent="navy">
            <div className="flex flex-col gap-1.5 text-sm">
              <Row label="Gross Sales" value={formatCompact(summary.revenue)} />
              <Row label="Cost of Goods" value={formatCompact(summary.cogs)} />
              <Row label="Gross Profit" value={formatCompact(summary.grossProfit)} />
              <Row label="Margin" value={summary.grossMarginPct !== null ? `${summary.grossMarginPct.toFixed(0)}%` : "N/A"} />
            </div>
          </SectionCard>
          <PrincipalMarginsBars dataset={dataset} period={period} />
        </div>
      </div>
    </div>
  );
}
