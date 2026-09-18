"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { formatCompact, formatPercent, marginTier, tierTextClass } from "@/lib/format";
import { summarizeSalesForPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import type { ReceivablesDashboard } from "@/lib/receivables";

const RISK_BUCKETS = ["61–90 days", "Over 90 days"] as const;
const OVER_LIMIT_TABLE_LIMIT = 10;

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
  // Detail for the exceptions strip's "N customer(s) over credit limit" item
  // (#financials) — the KPI card above only ever showed the count.
  const overLimitCustomers = receivables
    ? [...receivables.customers].filter((c) => c.status === "Over limit").sort((a, b) => b.outstanding - a.outstanding).slice(0, OVER_LIMIT_TABLE_LIMIT)
    : [];

  return (
    <div id="financials" className="@container">
      <SectionCard title="Financials" accent="navy">
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
              <KpiCard accent="quarter" label="Credit Limit Breaches" value={receivables.creditLimitBreaches} />
            </div>
          )}
        </div>

        {overLimitCustomers.length > 0 ? (
          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Over credit limit (top {Math.min(OVER_LIMIT_TABLE_LIMIT, overLimitCustomers.length)})
            </h4>
            <TableWrap>
              <Thead>
                <Th>Customer</Th>
                <Th align="right">Outstanding</Th>
                <Th align="right">Credit Limit</Th>
                <Th align="right">Utilisation</Th>
              </Thead>
              <tbody>
                {overLimitCustomers.map((c) => (
                  <tr key={c.code}>
                    <Td>{c.name}</Td>
                    <Td align="right">{formatCompact(c.outstanding)}</Td>
                    <Td align="right">{formatCompact(c.creditLimit)}</Td>
                    <Td align="right">{formatPercent(c.utilisationPct)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        ) : null}
      </div>
      </SectionCard>
    </div>
  );
}
