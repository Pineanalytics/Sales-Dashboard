"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { summarizeSalesForPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
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

  return (
    <SectionCard title="Sales vs. Target" accent="blue">
      <div className="flex flex-col gap-4">
        <KpiGrid>
          <KpiCard accent="revenue" label="Revenue" value={formatCompact(summary.revenue)} />
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
