import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { formatNumber, formatPercent } from "@/lib/format";
import { summarizeCoverageForPeriod, summarizeCoverageByRep, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

/** Executive Overview add-on — a compact coverage/productivity summary next to the
 *  full OverviewView, built entirely from existing summarizers. Does not modify
 *  OverviewView.tsx or CoverageView.tsx. */
export function CoverageSnapshot({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const summary = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey);
  const topReps = summarizeCoverageByRep(dataset, period, selectedPrincipalKey)
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, 5);

  return (
    <SectionCard title="Coverage & Productivity Snapshot">
      <div className="flex flex-col gap-4 p-1">
        <KpiGrid>
          <KpiCard accent="coverage" label="Coverage" value={<AnimatedValue value={summary.coverage} format={formatNumber} />} />
          <KpiCard accent="coverage" label="Productive Calls" value={<AnimatedValue value={summary.productiveCalls} format={formatNumber} />} />
          <KpiCard accent="coverage" label="Productivity %" value={formatPercent(summary.productivityPct)} />
        </KpiGrid>

        {topReps.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Top Reps by Coverage</span>
            {topReps.map((r) => (
              <div key={r.employeeName} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-strong">{r.employeeName}</span>
                <span className="shrink-0 tabular-nums font-semibold text-foreground">{formatNumber(r.coverage)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
