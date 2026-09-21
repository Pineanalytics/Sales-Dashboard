"use client";

import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatPercent, marginTier, tierTextClass } from "@/lib/format";
import { summarizeSalesForPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import type { ReceivablesDashboard } from "@/lib/receivables";

const RISK_BUCKETS = ["61–90 days", "Over 90 days"] as const;
const CREDIT_EXPOSURE_HREF = "/financials?tab=credit-exposure&status=over-limit";

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
    <div id="financials" className="@container h-full">
      <SectionCard
        title="Financials"
        accent="navy"
        action={
          canViewReceivables ? (
            <Link href={CREDIT_EXPOSURE_HREF} className="text-xs font-semibold text-primary-blue hover:underline">
              View credit exposure →
            </Link>
          ) : undefined
        }
      >
      <div className="flex flex-col gap-4">
        {/* Container-relative, not viewport-relative — see StockRiskPanel's
            matching comment; this panel is paired half-width the same way. */}
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
          <KpiCard accent="revenue" label="Cost of Goods" value={formatCompact(summary.cogs)} />
          <KpiCard accent="revenue" label="Gross Profit" value={formatCompact(summary.grossProfit)} />
          <KpiCard
            accent="growth"
            label="Gross Margin"
            value={<span className={tierTextClass[marginTier(summary.grossMarginPct)]}>{formatPercent(summary.grossMarginPct)}</span>}
          />
        </div>

        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Receivables — company-wide{receivables ? `, as of ${new Date(receivables.asOf).toLocaleDateString()}` : ""} — not filtered by principal or period
          </h4>
          {!canViewReceivables ? (
            <p className="text-xs text-muted">You don&apos;t have access to Receivables.</p>
          ) : !receivables ? (
            <p className="text-xs text-muted">Receivables have not synced yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
              <KpiCard accent="mission" label="Outstanding" value={formatCompact(receivables.masterBalance)} sublabel={`${receivables.customerCount} customers`} />
              <KpiCard accent="growth" label="61+ Days Overdue" value={formatCompact(atRiskBalance)} />
              <KpiCard
                accent="quarter"
                label="Credit Limit Breaches"
                value={receivables.creditLimitBreaches}
                sublabel={
                  receivables.creditLimitBreaches > 0 ? (
                    <Link href={CREDIT_EXPOSURE_HREF} className="font-semibold text-primary-blue hover:underline">
                      View customers →
                    </Link>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>
      </div>
      </SectionCard>
    </div>
  );
}
