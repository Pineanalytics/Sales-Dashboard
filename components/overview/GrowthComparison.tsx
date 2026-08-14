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

/** Revenue growth cards. A selected calendar month uses the daily SAP feed so
 * partial months are compared only with the equivalent completed days. */
export function GrowthComparison({ dataset, selectedPrincipalKey, period }: { dataset: Dataset; selectedPrincipalKey: string | null; period: PeriodSelection }) {
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
  const dateYoyRevenue = dateMatched?.yoy?.revenue;
  const dateMomRevenue = dateMatched?.mom?.revenue;
  const useDateMatched = Boolean(dateMatched?.available && dateCurrentRevenue !== null && dateCurrentRevenue !== undefined);
  const dateMatchedYoy = useDateMatched && dateYoyRevenue !== null && dateYoyRevenue !== undefined ? growthPct(dateCurrentRevenue!, dateYoyRevenue) : null;
  const dateMatchedMom = useDateMatched && dateMomRevenue !== null && dateMomRevenue !== undefined ? growthPct(dateCurrentRevenue!, dateMomRevenue) : null;

  return (
    <SectionCard title="Growth Comparison">
      <KpiGrid>
        <KpiCard accent="revenue" label={useDateMatched ? `YoY through ${dateMatched?.asOf ?? "selected date"}` : `vs ${priorYearPeriod.year} (YoY)`} value={<span className={tierTextClass[trendTier(useDateMatched ? dateMatchedYoy : yoyPct)]}>{loading ? "…" : formatTrendPercent(useDateMatched ? dateMatchedYoy : yoyPct)}</span>} sublabel={useDateMatched ? (dateYoyRevenue !== null && dateYoyRevenue !== undefined ? `Was ${formatCompact(dateYoyRevenue)} through ${dateMatched?.yoy?.through ?? "the matching date"}` : "No matching prior-year daily data") : priorYear.revenue > 0 ? `Was ${formatCompact(priorYear.revenue)}` : "No prior-year data"} />
        <KpiCard accent="growth" label={useDateMatched ? `MoM through ${dateMatched?.asOf ?? "selected date"}` : previousMonthPeriod ? `vs ${previousMonthPeriod.month} (MoM)` : "MoM"} value={<span className={tierTextClass[trendTier(useDateMatched ? dateMatchedMom : momPct)]}>{loading ? "…" : formatTrendPercent(useDateMatched ? dateMatchedMom : momPct)}</span>} sublabel={useDateMatched ? (dateMomRevenue !== null && dateMomRevenue !== undefined ? `Was ${formatCompact(dateMomRevenue)} through ${dateMatched?.mom?.through ?? "the matching date"}` : "No matching prior-month daily data") : previousMonth && previousMonth.revenue > 0 ? `Was ${formatCompact(previousMonth.revenue)}` : "No prior-month data"} />
      </KpiGrid>
      {period.month && !loading && !useDateMatched ? <p className="mt-3 text-xs text-muted">Date-matched daily SAP history is not available for this selection yet; the comparison above uses the monthly sales history.</p> : null}
    </SectionCard>
  );
}
