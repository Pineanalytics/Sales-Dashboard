"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { summarizeSalesForPeriod, getPreviousMonthPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import { computeSalesRunRate } from "@/lib/executiveSummary";
import type { Dataset } from "@/lib/types";

export function SalesSummaryPanel({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const summary = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);
  const runRate = computeSalesRunRate(summary, period);

  // Trailing 6-month revenue trend for the Revenue KpiCard's sparkline, built
  // by walking getPreviousMonthPeriod (already used elsewhere for MoM growth)
  // back from the selected period's anchor month, rather than a new
  // aggregation helper. Skipped for a period with no single anchor month
  // (shouldn't occur for MTD/MONTH/QTD/YTD, all of which carry `.month`).
  const anchorMonthPeriod: PeriodSelection | null = period.month ? { kind: "MONTH", year: period.year, month: period.month } : null;
  const revenueTrend: number[] = [];
  if (anchorMonthPeriod) {
    let cursor: PeriodSelection | null = anchorMonthPeriod;
    for (let i = 0; i < 6 && cursor; i++) {
      revenueTrend.unshift(summarizeSalesForPeriod(dataset, cursor, selectedPrincipalKey).revenue);
      cursor = getPreviousMonthPeriod(cursor);
    }
  }

  return (
    <SectionCard title="Sales vs. Target" accent="blue">
      <div className="flex flex-col gap-4">
        <KpiGrid>
          <KpiCard
            accent="revenue"
            label="Revenue"
            value={formatCompact(summary.revenue)}
            sparkline={revenueTrend.length > 1 ? revenueTrend : undefined}
          />
          <KpiCard accent="mission" label="Target" value={summary.target !== null ? formatCompact(summary.target) : "N/T"} />
          <KpiCard
            accent="quarter"
            size="md"
            label="Achievement"
            value={
              <div className="flex items-center gap-2">
                <AchievementGauge pct={summary.achievementPct} size={48} />
                <span className={tierTextClass[achievementTier(summary.achievementPct)]}>{formatPercent(summary.achievementPct)}</span>
              </div>
            }
          />
          <KpiCard
            accent="growth"
            label="Gross Margin"
            value={<span className={tierTextClass[marginTier(summary.grossMarginPct)]}>{formatPercent(summary.grossMarginPct)}</span>}
            sublabel={`GP ${formatCompact(summary.grossProfit)}`}
          />
          <GrowthComparison dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} compact />
        </KpiGrid>

        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Run Rate {runRate?.basis === "live" ? "(live pacing this month)" : "(period average)"}
          </h4>
          {runRate ? (
            <KpiGrid>
              <KpiCard accent="revenue" size="md" label="Daily" value={formatCompact(runRate.daily)} />
              <KpiCard accent="revenue" size="md" label="Weekly" value={formatCompact(runRate.weekly)} />
              <KpiCard accent="revenue" size="md" label="Monthly" value={formatCompact(runRate.monthly)} />
            </KpiGrid>
          ) : (
            <p className="text-xs text-muted">No revenue-bearing month in this selection to pace a run rate from.</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
