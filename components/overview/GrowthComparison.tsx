"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { useDateAwareGrowth } from "@/components/hooks/useDateAwareGrowth";
import { formatCompact, formatTrendPercent, trendTier, tierTextClass } from "@/lib/format";
import { summarizeSalesForPeriod, getPriorYearPeriod, getPreviousMonthPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

function growthPct(current: number, prior: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
}

/** Revenue growth cards. YoY compares the selected month with the full same
 * calendar month last year; MoM remains day-aligned through the daily SAP feed. */
export function GrowthComparison({ dataset, selectedPrincipalKey, period, compact = false }: { dataset: Dataset; selectedPrincipalKey: string | null; period: PeriodSelection; compact?: boolean }) {
  const { data: dateMatched, loading } = useDateAwareGrowth(period, selectedPrincipalKey);
  const current = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);
  const priorYearPeriod = getPriorYearPeriod(period);
  const priorYear = summarizeSalesForPeriod(dataset, priorYearPeriod, selectedPrincipalKey);
  const yoyPct = growthPct(current.revenue, priorYear.revenue);
  const currentMonthPeriod: PeriodSelection = period.month ? { kind: "MONTH", year: period.year, month: period.month } : period;
  const currentMonth = summarizeSalesForPeriod(dataset, currentMonthPeriod, selectedPrincipalKey);
  const previousMonthPeriod = getPreviousMonthPeriod(period);
  const previousMonth = previousMonthPeriod ? summarizeSalesForPeriod(dataset, previousMonthPeriod, selectedPrincipalKey) : null;
  const momPct = previousMonth ? growthPct(currentMonth.revenue, previousMonth.revenue) : null;
  const dateCurrentRevenue = dateMatched?.current?.revenue;
  const dateMomRevenue = dateMatched?.mom?.revenue;
  const useDateMatched = Boolean(dateMatched?.available && dateCurrentRevenue !== null && dateCurrentRevenue !== undefined);
  const dateMatchedMom = useDateMatched && dateMomRevenue !== null && dateMomRevenue !== undefined ? growthPct(dateCurrentRevenue!, dateMomRevenue) : null;
  const yoyLabel = period.month
    ? `YoY · ${period.month} ${period.year} vs ${period.month} ${priorYearPeriod.year}`
    : `vs ${priorYearPeriod.year} (YoY)`;

  const cards = (
    <>
      <KpiCard accent="revenue" label={yoyLabel} value={<span className={tierTextClass[trendTier(yoyPct)]}>{formatTrendPercent(yoyPct)}</span>} sublabel={priorYear.revenue > 0 ? `Last-year same month: ${formatCompact(priorYear.revenue)}` : "No prior-year same-month data"} />
      <KpiCard accent="growth" label={useDateMatched ? `MoM through ${dateMatched?.asOf ?? "selected date"}` : previousMonthPeriod ? `vs ${previousMonthPeriod.month} (MoM)` : "MoM"} value={<span className={tierTextClass[trendTier(useDateMatched ? dateMatchedMom : momPct)]}>{loading ? "…" : formatTrendPercent(useDateMatched ? dateMatchedMom : momPct)}</span>} sublabel={useDateMatched ? (dateMomRevenue !== null && dateMomRevenue !== undefined ? `Was ${formatCompact(dateMomRevenue)} through ${dateMatched?.mom?.through ?? "the matching date"}` : "No matching prior-month daily data") : previousMonth && previousMonth.revenue > 0 ? `Was ${formatCompact(previousMonth.revenue)}` : "No prior-month data"} />
    </>
  );

  if (compact) return <div className="contents">{cards}</div>;

  return (
    <SectionCard title="Growth Comparison">
      <KpiGrid>{cards}</KpiGrid>
      {period.month && !loading && !useDateMatched ? <p className="mt-3 text-xs text-muted">Daily SAP history is not available for a date-matched MoM comparison; YoY still uses the monthly SAP history.</p> : null}
    </SectionCard>
  );
}
