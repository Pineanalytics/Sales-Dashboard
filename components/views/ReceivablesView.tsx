"use client";

import { Badge } from "@/components/ui/Badge";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatCompact, formatNumber, type Tier } from "@/lib/format";
import type { AgeingBucket, ReceivablesDashboard } from "@/lib/receivables";

const BUCKETS: AgeingBucket[] = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"];
const bucketTier = (bucket: AgeingBucket): Tier => bucket === "Over 90 days" ? "bad" : bucket === "61–90 days" ? "warn" : "neutral";
const money = (value: number) => `KES ${formatCompact(value)}`;

function ReceivablesKpi({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return <div className="rounded-xl border-t-4 border-t-primary-blue bg-surface p-3.5 shadow-[0_1px_3px_rgba(11,61,53,0.06)]"><div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums text-brand-navy">{value}</div><div className="mt-1 text-[11px] text-muted-strong">{sublabel}</div></div>;
}

export function ReceivablesView({ data }: { data: ReceivablesDashboard }) {
  const overdue = data.buckets["1–30 days"] + data.buckets["31–60 days"] + data.buckets["61–90 days"] + data.buckets["Over 90 days"];
  const asOf = new Date(data.asOf).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-primary-blue">Receivables & Ageing</h1>
          <p className="text-sm text-muted">Live SAP open-item ledger · as at {asOf}</p>
        </div>
        <Badge tier={Math.abs(data.variance) <= 5 ? "good" : "bad"}>Ledger variance {money(data.variance)}</Badge>
      </div>

      <KpiGrid>
        <ReceivablesKpi label="Open receivables" value={money(data.ledgerBalance)} sublabel={`${formatNumber(data.customerCount)} customers`} />
        <ReceivablesKpi label="Overdue" value={money(overdue)} sublabel="Past contractual due date" />
        <ReceivablesKpi label="Over 90 days" value={money(data.buckets["Over 90 days"])} sublabel="Requires collection action" />
        <ReceivablesKpi label="Credit-limit breaches" value={formatNumber(data.creditLimitBreaches)} sublabel="Across all synced customers" />
        <ReceivablesKpi label="Open ledger items" value={formatNumber(data.openItemCount)} sublabel="Credits retained in ageing" />
        <ReceivablesKpi label="SAP master balance" value={money(data.masterBalance)} sublabel="Reconciled customer master" />
      </KpiGrid>

      <SectionCard title="Ageing profile">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          {BUCKETS.map((bucket) => (
            <div key={bucket} className="rounded-lg border border-border/60 p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{bucket}</div>
              <div className="text-xl font-semibold tabular-nums text-brand-navy">{money(data.buckets[bucket])}</div>
              <Badge tier={bucketTier(bucket)}>{bucket === "Current" ? "Not overdue" : "Due-date ageing"}</Badge>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Credit terms">
        <TableWrap>
          <Thead><Th>Payment term</Th><Th align="right">Days</Th><Th align="right">Customers</Th><Th align="right">Credit limit</Th><Th align="right">Outstanding</Th></Thead>
          <tbody>{data.terms.map((term) => <tr key={`${term.name}-${term.days}`}><Td>{term.name}</Td><Td align="right">{term.days}</Td><Td align="right">{formatNumber(term.customers)}</Td><Td align="right">{money(term.creditLimit)}</Td><Td align="right">{money(term.outstanding)}</Td></tr>)}</tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Customer credit exposure" action={<span className="text-xs text-muted">Top 250 by current open balance</span>}>
        <TableWrap>
          <Thead><Th>Customer</Th><Th>Term</Th><Th align="right">Credit limit</Th><Th align="right">Outstanding</Th><Th align="right">Over 90</Th><Th align="center">Utilisation</Th></Thead>
          <tbody>{data.customers.map((customer) => {
            const tier: Tier = customer.utilisationPct === null ? "neutral" : customer.utilisationPct > 100 ? "bad" : customer.utilisationPct >= 80 ? "warn" : "good";
            return <tr key={customer.code} className={!customer.active ? "opacity-60" : undefined}><Td><span className="font-medium">{customer.name}</span><span className="ml-2 text-xs text-muted">{customer.code}</span></Td><Td>{customer.term} ({customer.termDays}d)</Td><Td align="right">{money(customer.creditLimit)}</Td><Td align="right">{money(customer.outstanding)}</Td><Td align="right">{money(customer.buckets["Over 90 days"])}</Td><Td align="center"><Badge tier={tier}>{customer.utilisationPct === null ? "No limit" : `${customer.utilisationPct.toFixed(0)}%`}</Badge></Td></tr>;
          })}</tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Largest open items" action={<span className="text-xs text-muted">Includes credits where SAP still shows an open balance</span>}>
        <TableWrap>
          <Thead><Th>Customer</Th><Th>Document</Th><Th>Due date</Th><Th>Ageing</Th><Th align="right">Open balance</Th></Thead>
          <tbody>{data.largestItems.map((item, index) => <tr key={`${item.customerCode}-${item.documentRef ?? "none"}-${index}`}><Td>{item.customer}</Td><Td>{item.documentRef ?? "—"}</Td><Td>{new Date(item.dueDate).toLocaleDateString("en-KE")}</Td><Td><Badge tier={bucketTier(item.bucket)}>{item.bucket}</Badge></Td><Td align="right">{money(item.openBalance)}</Td></tr>)}</tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
