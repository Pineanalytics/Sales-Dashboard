"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { summarizeSalesForPeriod, summarizeSalesByPrincipal, getPreviousMonthPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import { computeSalesRunRate } from "@/lib/executiveSummary";
import type { Dataset } from "@/lib/types";

const OFF_TARGET_TABLE_LIMIT = 5;

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

  // Detail for the exceptions strip's "N principal(s) well off target" item
  // (#sales-summary) — only meaningful company-wide; a single selected
  // principal already sees its own achievement in the KPI cards above.
  const offTargetPrincipals = selectedPrincipalKey
    ? []
    : Array.from(summarizeSalesByPrincipal(dataset, period).values())
        .filter((r) => achievementTier(r.achievementPct) === "bad")
        .sort((a, b) => (a.achievementPct ?? 0) - (b.achievementPct ?? 0));

  return (
    <div id="sales-summary" className="@container h-full">
      <SectionCard title="Sales vs. Target" accent="blue">
        <div className="flex flex-col gap-4">
          {/* Sized to this panel's own (container-query) width, not the
              viewport — now that this panel pairs half-width with Stock Risk
              (see ExecutiveSummaryClient), KpiGrid's viewport breakpoints
              would misfire the same way round 3 fixed for the other four
              panels; this one just never needed it before while full-width.
              Run Rate's three tiles now share this same grid instead of
              their own row below — GrowthComparison's MoM tile (its second,
              `compact`-mode card) used to wrap alone into a near-empty row;
              folding Run Rate in behind it fills that row instead of leaving
              it mostly blank. */}
          <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-5">
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
            {runRate ? (
              <>
                <KpiCard accent="revenue" size="md" label={`Daily${runRate.basis === "live" ? " run rate" : " avg"}`} value={formatCompact(runRate.daily)} />
                <KpiCard accent="revenue" size="md" label={`Weekly${runRate.basis === "live" ? " run rate" : " avg"}`} value={formatCompact(runRate.weekly)} />
                <KpiCard accent="revenue" size="md" label={`Monthly${runRate.basis === "live" ? " run rate" : " avg"}`} value={formatCompact(runRate.monthly)} />
              </>
            ) : null}
          </div>
          {!runRate ? <p className="text-xs text-muted">No revenue-bearing month in this selection to pace a run rate from.</p> : null}

          {offTargetPrincipals.length > 0 ? (
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Well off target {offTargetPrincipals.length > OFF_TARGET_TABLE_LIMIT ? `(top ${OFF_TARGET_TABLE_LIMIT} of ${offTargetPrincipals.length})` : ""}
              </h4>
              <TableWrap>
                <Thead>
                  <Th>Principal</Th>
                  <Th align="right">Achievement</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">Target</Th>
                </Thead>
                <tbody>
                  {offTargetPrincipals.slice(0, OFF_TARGET_TABLE_LIMIT).map((r) => (
                    <tr key={r.principalKey}>
                      <Td>{r.principal}</Td>
                      <Td align="right">
                        <span className={tierTextClass[achievementTier(r.achievementPct)]}>{formatPercent(r.achievementPct)}</span>
                      </Td>
                      <Td align="right">{formatCompact(r.revenue)}</Td>
                      <Td align="right">{r.target !== null ? formatCompact(r.target) : "N/T"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              {offTargetPrincipals.length > OFF_TARGET_TABLE_LIMIT ? (
                <p className="mt-1.5 text-[11px] text-muted">+{offTargetPrincipals.length - OFF_TARGET_TABLE_LIMIT} more off-target principal(s) not shown.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
