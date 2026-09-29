"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { money } from "@/components/views/ReceivablesView";
import { formatPercent } from "@/lib/format";
import type { ReceivablesDashboard } from "@/lib/receivables";
import type { DebtAttribution } from "@/lib/financeDebtAttribution";

const TOP_N = 5;
const CUSTOMER_BREAKDOWN_LIMIT = 30;

export function DebtorsTab({ receivables, debtAttribution }: { receivables: ReceivablesDashboard; debtAttribution: DebtAttribution }) {
  const overdue = receivables.buckets["1–30 days"] + receivables.buckets["31–60 days"] + receivables.buckets["61–90 days"] + receivables.buckets["Over 90 days"];
  const topDebtors = receivables.customers.slice(0, TOP_N);
  const customerBreakdown = debtAttribution.customers.slice(0, CUSTOMER_BREAKDOWN_LIMIT);

  return (
    <div id="debtors" className="@container flex flex-col gap-4">
      <SectionCard title="Debtors summary" accent="red">
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
          <KpiCard accent="mission" label="Overall debt" value={money(receivables.ledgerBalance)} sublabel={`${receivables.customerCount} customers`} />
          <KpiCard accent="growth" label="Current debt" value={money(receivables.buckets.Current)} sublabel="Not overdue" />
          <KpiCard accent="quarter" label="Overdue debt" value={money(overdue)} sublabel="Past contractual due date" />
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
