import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatTrendPercent, trendTier, tierTextClass } from "@/lib/format";
import {
  summarizeSalesForPeriod,
  getPriorYearPeriod,
  getPreviousMonthPeriod,
  type PeriodSelection,
} from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

function growthPct(current: number, prior: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null;
}

/** Executive Overview add-on — YoY (same period, prior year) and MoM (this
 *  calendar month vs the immediately preceding one) revenue growth, built
 *  entirely from existing summarizers. YoY follows whatever period kind is
 *  selected (YTD compares to last year's YTD, Q2 to last year's Q2, etc.);
 *  MoM is always anchored to a single month regardless of the selected
 *  period's kind, since "this month vs last month" is the only sensible
 *  reading of month-over-month. */
export function GrowthComparison({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const current = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);

  const priorYearPeriod = getPriorYearPeriod(period);
  const priorYear = summarizeSalesForPeriod(dataset, priorYearPeriod, selectedPrincipalKey);
  const yoyPct = growthPct(current.revenue, priorYear.revenue);

  const currentMonthPeriod: PeriodSelection = period.month
    ? { kind: "MONTH", year: period.year, month: period.month }
    : period;
  const currentMonth = summarizeSalesForPeriod(dataset, currentMonthPeriod, selectedPrincipalKey);
  const previousMonthPeriod = getPreviousMonthPeriod(period);
  const previousMonth = previousMonthPeriod ? summarizeSalesForPeriod(dataset, previousMonthPeriod, selectedPrincipalKey) : null;
  const momPct = previousMonth ? growthPct(currentMonth.revenue, previousMonth.revenue) : null;

  return (
    <SectionCard title="Growth Comparison">
      <KpiGrid>
        <KpiCard
          accent="revenue"
          label={`vs ${priorYearPeriod.year} (YoY)`}
          value={<span className={tierTextClass[trendTier(yoyPct)]}>{formatTrendPercent(yoyPct)}</span>}
          sublabel={priorYear.revenue > 0 ? `Was ${formatCompact(priorYear.revenue)}` : "No prior-year data"}
        />
        <KpiCard
          accent="growth"
          label={previousMonthPeriod ? `vs ${previousMonthPeriod.month} (MoM)` : "MoM"}
          value={<span className={tierTextClass[trendTier(momPct)]}>{formatTrendPercent(momPct)}</span>}
          sublabel={previousMonth && previousMonth.revenue > 0 ? `Was ${formatCompact(previousMonth.revenue)}` : "No prior-month data"}
        />
      </KpiGrid>
    </SectionCard>
  );
}
