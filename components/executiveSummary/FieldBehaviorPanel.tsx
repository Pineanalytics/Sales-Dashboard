"use client";

import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { formatNumber, formatPercent, strikeRateTier, tierTextClass } from "@/lib/format";
import { summarizeCoverageForPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

function StubTile({ label, href, note }: { label: string; href: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex h-full flex-col justify-between gap-1 rounded-xl border-t-4 border-t-border bg-surface p-3.5 shadow-[0_1px_3px_rgba(11,61,53,0.06)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(11,61,53,0.12)] hover:-translate-y-0.5"
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="text-sm font-semibold text-muted-strong">View full report →</span>
      <span className="text-[11px] text-muted">{note}</span>
    </Link>
  );
}

/** Coverage/Strike-Rate is wired live (summarizeCoverageForPeriod already
 *  accepts the same PeriodSelection + principal filter as Sales). JP
 *  Adherence, Time Management, and Universe status have no MTD/QTD/YTD
 *  rollup today — only single-date or single-month filters exist for those
 *  — so they render as stub tiles linking to their full reports until that
 *  aggregation is built (tracked as a phase 2 follow-up). */
export function FieldBehaviorPanel({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const coverage = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey);

  return (
    <SectionCard title="Field & Rep Behavior" accent="green">
      <KpiGrid>
        <KpiCard
          accent="coverage"
          label="Strike Rate"
          value={<span className={tierTextClass[strikeRateTier(coverage.productivityPct)]}>{formatPercent(coverage.productivityPct)}</span>}
          sublabel={`${formatNumber(coverage.productiveCalls)} of ${formatNumber(coverage.coverage)} calls`}
        />
        <StubTile label="JP Adherence" href="/jp-adherence" note="No MTD/QTD/YTD rollup yet — see full report" />
        <StubTile label="Time Management" href="/timestamps" note="No MTD/QTD/YTD rollup yet — see full report" />
        <StubTile label="Universe Status" href="/active-outlets" note="No MTD/QTD/YTD rollup yet — see full report" />
      </KpiGrid>
    </SectionCard>
  );
}
