"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { money } from "@/components/views/ReceivablesView";
import { formatPercent } from "@/lib/format";
import type { KpiAccent } from "@/lib/format";
import type { ReceivablesDashboard } from "@/lib/receivables";
import type { DebtAttribution } from "@/lib/financeDebtAttribution";

const TOP_N = 5;
const CUSTOMER_BREAKDOWN_LIMIT = 30;

// "Consider all debts within 30 days as current debt" — merges the
// Receivables & Ageing tab's own "Current" and "1–30 days" buckets into one
// display-level "Current" figure here (that original tab's own bucket
// labels/logic are untouched; this is a presentation choice for the
// consolidated debtor module only). 31–60/61–90/Over 90 keep their existing
// boundaries, just relabeled to the guideline's own 60/90/over-90 wording.
function mergedBuckets(receivables: ReceivablesDashboard) {
  return {
    current: receivables.buckets.Current + receivables.buckets["1–30 days"],
    days60: receivables.buckets["31–60 days"],
    days90: receivables.buckets["61–90 days"],
    over90: receivables.buckets["Over 90 days"],
  };
}

const BUCKET_LABELS: { key: "current" | "days60" | "days90" | "over90"; label: string; icon: KpiAccent }[] = [
  { key: "current", label: "Current (0–30 days)", icon: "revenue" },
  { key: "days60", label: "60 days", icon: "quarter" },
  { key: "days90", label: "90 days", icon: "mission" },
  { key: "over90", label: "Over 90 days", icon: "coverage" },
];

/** This tab is now the module's one debtor view — it absorbs the former
 *  Debtors tab's summary/top-5/structure-by-principal content, so that tab
 *  no longer exists separately. The old "By age bucket" badge list is
 *  dropped as redundant with the bucket KPI cards above it. */
export function TotalOutstandingTab({ receivables, debtAttribution }: { receivables: ReceivablesDashboard; debtAttribution: DebtAttribution }) {
  const buckets = mergedBuckets(receivables);
  const total = buckets.current + buckets.days60 + buckets.days90 + buckets.over90;
  const overdue = buckets.days60 + buckets.days90 + buckets.over90;
  const topDebtors = receivables.customers.slice(0, TOP_N);
  const customerBreakdown = debtAttribution.customers.slice(0, CUSTOMER_BREAKDOWN_LIMIT);

  return (
    <div id="total-outstanding" className="@container flex flex-col gap-4">
      <SectionCard title="Debtors & Total Outstanding" accent="red">
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
          <KpiCard accent="mission" label="Overall debt" value={money(receivables.ledgerBalance)} sublabel={`${receivables.customerCount} customers`} />
          <KpiCard accent="growth" label="Current debt" value={money(buckets.current)} sublabel="Within 30 days" />
          <KpiCard accent="quarter" label="Overdue debt" value={money(overdue)} sublabel="Over 30 days past due" />
        </div>
      </SectionCard>

      <SectionCard title="Total outstanding by age" accent="amber">
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
          {BUCKET_LABELS.map((b) => (
            <KpiCard
              key={b.key}
              accent={b.icon}
              label={b.label}
              value={money(buckets[b.key])}
              sublabel={total > 0 ? `${((buckets[b.key] / total) * 100).toFixed(0)}% of outstanding` : "—"}
            />
          ))}
        </div>
      </SectionCard>

      <SectionCard title={`Top ${TOP_N} debt lines`} accent="amber" action={<span className="text-xs text-muted">Ranked by live open balance</span>}>
        <TableWrap>
          <Thead><Th>Customer</Th><Th>Status</Th><Th align="right">Outstanding</Th><Th align="right">Over 90 days</Th></Thead>
          <tbody>
            {topDebtors.map((customer) => (
              <tr key={customer.code}>
                <Td><span className="font-medium">{customer.name}</span><span className="ml-2 text-xs text-muted">{customer.code}</span></Td>
                <Td>{customer.status}</Td>
                <Td align="right">{money(customer.outstanding)}</Td>
                <Td align="right">{money(customer.buckets["Over 90 days"])}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard
        title="Structure debt per principal"
        accent="navy"
        action={<span className="text-xs text-muted">{debtAttribution.windowLabel} purchase mix per customer, top {CUSTOMER_BREAKDOWN_LIMIT} debtors</span>}
      >
        <TableWrap>
          <Thead><Th>Customer</Th><Th align="right">Outstanding</Th><Th>Principal split</Th></Thead>
          <tbody>
            {customerBreakdown.map((customer) => (
              <tr key={customer.customerCode}>
                <Td><span className="font-medium">{customer.customerName}</span><span className="ml-2 text-xs text-muted">{customer.customerCode}</span></Td>
                <Td align="right">{money(customer.outstanding)}</Td>
                <Td>
                  {customer.byPrincipal.length > 0
                    ? customer.byPrincipal.map((p) => `${p.principal} ${formatPercent(p.sharePct)}`).join(" · ")
                    : <span className="text-muted">Unattributed — no purchase history in window</span>}
                </Td>
              </tr>
            ))}
            {customerBreakdown.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">No outstanding debt to structure.</td></tr> : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
