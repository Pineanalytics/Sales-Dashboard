"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatPercent, marginTier, tierTextClass } from "@/lib/format";
import { summarizeSalesForPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import type { ReceivablesDashboard } from "@/lib/receivables";

const RISK_BUCKETS = ["61–90 days", "Over 90 days"] as const;

export function FinancialsPanel({
  dataset,
  selectedPrincipalKey,
  period,
  receivables,
  canViewReceivables,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
  receivables: ReceivablesDashboard | null;
  canViewReceivables: boolean;
}) {
  const summary = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);
  const atRiskBalance = receivables ? RISK_BUCKETS.reduce((sum, bucket) => sum + receivables.buckets[bucket], 0) : 0;

  return (
    <SectionCard title="Financials" accent="navy">
      <div className="flex flex-col gap-4">
        <KpiGrid>
          <KpiCard accent="revenue" label="Cost of Goods" value={formatCompact(summary.cogs)} />
          <KpiCard accent="revenue" label="Gross Profit" value={formatCompact(summary.grossProfit)} />
          <KpiCard
            accent="growth"
            label="Gross Margin"
            value={<span className={tierTextClass[marginTier(summary.grossMarginPct)]}>{formatPercent(summary.grossMarginPct)}</span>}
          />
        </KpiGrid>

        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Receivables — company-wide{receivables ? `, as of ${new Date(receivables.asOf).toLocaleDateString()}` : ""} — not filtered by principal or period
          </h4>
          {!canViewReceivables ? (
            <p className="text-xs text-muted">You don&apos;t have access to Receivables.</p>
          ) : !receivables ? (
            <p className="text-xs text-muted">Receivables have not synced yet.</p>
          ) : (
            <KpiGrid>
              <KpiCard accent="mission" label="Outstanding" value={formatCompact(receivables.masterBalance)} sublabel={`${receivables.customerCount} customers`} />
              <KpiCard accent="growth" label="61+ Days Overdue" value={formatCompact(atRiskBalance)} />
              <KpiCard accent="quarter" label="Credit Limit Breaches" value={receivables.creditLimitBreaches} />
            </KpiGrid>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
