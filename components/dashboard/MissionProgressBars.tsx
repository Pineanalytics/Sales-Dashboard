"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact } from "@/lib/format";
import type { PeriodSalesSummary } from "@/lib/timeIntelligence";

/** H1/H2 (or Q1/Q2, reused for either pairing) Mission & Actual progress bars for the
 *  YTD Summary tab — OverviewView.tsx already computes the same h1Summary/h2Summary
 *  shape, this just gives it the progress-bar visual the reference dashboard uses. */
export function MissionProgressBars({
  title,
  leftLabel,
  left,
  rightLabel,
  right,
}: {
  title: string;
  leftLabel: string;
  left: PeriodSalesSummary;
  rightLabel: string;
  right: PeriodSalesSummary;
}) {
  const totalActual = left.revenue + right.revenue;
  const totalTarget = (left.target ?? 0) + (right.target ?? 0);
  const pct = totalTarget > 0 ? Math.min(100, (totalActual / totalTarget) * 100) : 0;

  return (
    <SectionCard title={title}>
      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div>
          <span className="block text-muted-strong text-xs">{leftLabel}</span>
          <span className="font-semibold tabular-nums text-foreground">{formatCompact(left.revenue)}</span>
        </div>
        <div>
          <span className="block text-muted-strong text-xs">{rightLabel}</span>
          <span className="font-semibold tabular-nums text-foreground">{formatCompact(right.revenue)}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-strong shrink-0">Total: {formatCompact(totalActual)}</span>
        <div className="flex-1 h-3 rounded-full bg-background-elevated overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">{pct.toFixed(0)}%</span>
      </div>
    </SectionCard>
  );
}
