"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatCompact, formatNumber, type Tier } from "@/lib/format";
import type { AgeingBucket, ReceivablesDashboard } from "@/lib/receivables";

const BUCKETS: AgeingBucket[] = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"];
const money = (value: number) => `KES ${formatCompact(value)}`;

function bucketTier(bucket: AgeingBucket): Tier {
  return bucket === "Over 90 days" ? "bad" : bucket === "61–90 days" ? "warn" : "neutral";
}

function statusTier(status: ReceivablesDashboard["customers"][number]["status"]): Tier {
  if (status === "Over limit") return "bad";
  if (status === "Watch") return "warn";
  if (status === "Within limit") return "good";
  return "neutral";
}

function ReceivablesKpi({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-xl border-t-4 border-t-primary-blue bg-surface p-3.5 shadow-[0_1px_3px_rgba(11,61,53,0.06)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-brand-navy">{value}</div>
      <div className="mt-1 text-[11px] text-muted-strong">{sublabel}</div>
    </div>
  );
}

function ScrollableTable({ children }: { children: ReactNode }) {
  return <div className="max-h-[520px] overflow-auto rounded-2xl">{children}</div>;
}

export function ReceivablesSummary({ data }: { data: ReceivablesDashboard }) {
  const overdue = data.buckets["1–30 days"] + data.buckets["31–60 days"] + data.buckets["61–90 days"] + data.buckets["Over 90 days"];
  const asOf = new Date(data.asOf).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#65766f]">Live SAP open-item ledger · as at {asOf}</p>
        <Badge tier={Math.abs(data.variance) <= 5 ? "good" : "bad"}>Ledger variance {money(data.variance)}</Badge>
      </div>
      <KpiGrid>
        <ReceivablesKpi label="Open receivables" value={money(data.ledgerBalance)} sublabel={`${formatNumber(data.customerCount)} customers`} />
        <ReceivablesKpi label="Overdue" value={money(overdue)} sublabel="Past contractual due date" />
        <ReceivablesKpi label="Over 90 days" value={money(data.buckets["Over 90 days"])} sublabel="Requires collection action" />
        <ReceivablesKpi label="Credit-limit breaches" value={formatNumber(data.creditLimitBreaches)} sublabel="Across all synced customers" />
        <ReceivablesKpi label="Open ledger items" value={formatNumber(data.openItemCount)} sublabel="Credits remain visible" />
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

      <SectionCard title="Credit terms" action={<Badge tier={Math.abs(data.variance) <= 5 ? "good" : "bad"}>Ledger variance {money(data.variance)}</Badge>}>
        <TableWrap>
          <Thead><Th>Payment term</Th><Th align="right">Days</Th><Th align="right">Customers</Th><Th align="right">Credit limit</Th><Th align="right">Outstanding</Th></Thead>
          <tbody>{data.terms.map((term) => <tr key={`${term.name}-${term.days}`}><Td>{term.name}</Td><Td align="right">{term.days}</Td><Td align="right">{formatNumber(term.customers)}</Td><Td align="right">{money(term.creditLimit)}</Td><Td align="right">{money(term.outstanding)}</Td></tr>)}</tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}

function CustomerRows({ rows, onSelect, selectedCode }: { rows: ReceivablesDashboard["customers"]; onSelect: (code: string) => void; selectedCode: string | null }) {
  return <>
    {rows.map((customer) => (
      <tr key={customer.code} className={`${!customer.active ? "opacity-60" : ""} ${selectedCode === customer.code ? "bg-accent-blue-soft" : ""}`}>
        <Td><span className="font-medium">{customer.name}</span><span className="ml-2 text-xs text-muted">{customer.code}</span></Td>
        <Td><Badge tier={statusTier(customer.status)}>{customer.status}</Badge></Td>
        <Td>{customer.term} ({customer.termDays}d)</Td>
        <Td align="right">{money(customer.creditLimit)}</Td>
        <Td align="right">{money(customer.outstanding)}</Td>
        <Td align="right">{money(customer.buckets["Over 90 days"])}</Td>
        <Td align="center"><Badge tier={customer.utilisationPct === null ? "neutral" : statusTier(customer.status)}>{customer.utilisationPct === null ? "No limit" : `${customer.utilisationPct.toFixed(0)}%`}</Badge></Td>
        <Td align="right"><button type="button" onClick={() => onSelect(customer.code)} className="text-xs font-semibold text-secondary-blue hover:text-primary-blue">Drill down</button></Td>
      </tr>
    ))}
  </>;
}

function CustomerTable({ rows, onSelect, selectedCode }: { rows: ReceivablesDashboard["customers"]; onSelect: (code: string) => void; selectedCode: string | null }) {
  return <ScrollableTable><TableWrap>
    <Thead><Th>Customer</Th><Th>Status</Th><Th>Term</Th><Th align="right">Credit limit</Th><Th align="right">Outstanding</Th><Th align="right">Over 90</Th><Th align="center">Utilisation</Th><Th align="right">Detail</Th></Thead>
    <tbody><CustomerRows rows={rows} onSelect={onSelect} selectedCode={selectedCode} /></tbody>
  </TableWrap></ScrollableTable>;
}

export function CustomerCreditExposure({ data }: { data: ReceivablesDashboard }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? data.customers.filter((customer) => `${customer.name} ${customer.code} ${customer.status}`.toLocaleLowerCase().includes(normalized)) : data.customers;
  }, [data.customers, query]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const allPage = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selected = data.customers.find((customer) => customer.code === selectedCode) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Top 50 customer credit exposure" action={<span className="text-xs text-muted">Ranked by live open balance</span>}>
        <CustomerTable rows={data.customers.slice(0, 50)} onSelect={setSelectedCode} selectedCode={selectedCode} />
      </SectionCard>

      {selected ? (
        <SectionCard title={`${selected.name} — credit drill-down`} action={<Badge tier={statusTier(selected.status)}>{selected.status}</Badge>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <ReceivablesKpi label="Outstanding" value={money(selected.outstanding)} sublabel={selected.code} />
            <ReceivablesKpi label="Credit limit" value={money(selected.creditLimit)} sublabel={selected.term} />
            <ReceivablesKpi label="Current" value={money(selected.buckets.Current)} sublabel="Not overdue" />
            <ReceivablesKpi label="1–30 days" value={money(selected.buckets["1–30 days"])} sublabel="Overdue" />
            <ReceivablesKpi label="31–60 days" value={money(selected.buckets["31–60 days"])} sublabel="Overdue" />
            <ReceivablesKpi label="Over 90 days" value={money(selected.buckets["Over 90 days"])} sublabel="Collection action" />
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="All customer statuses" action={<button type="button" onClick={() => setShowAll((value) => !value)} className="rounded-full border border-primary-blue/20 px-3 py-1 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">{showAll ? "Hide list" : `Browse all ${formatNumber(data.customers.length)}`}</button>}>
        {showAll ? <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search customer, code or status" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm md:max-w-sm" />
            <span className="text-xs text-muted">{formatNumber(filtered.length)} matching customers</span>
          </div>
          <CustomerTable rows={allPage} onSelect={setSelectedCode} selectedCode={selectedCode} />
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">Showing {formatNumber(currentPage * pageSize + 1)}–{formatNumber(Math.min((currentPage + 1) * pageSize, filtered.length))}</span>
            <div className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-full border border-border px-3 py-1 disabled:cursor-not-allowed disabled:opacity-40">Previous</button><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="rounded-full border border-border px-3 py-1 disabled:cursor-not-allowed disabled:opacity-40">Next</button></div>
          </div>
        </> : <p className="py-4 text-sm text-muted">Open the full list to search every customer and drill into their credit status without adding a long page to the dashboard.</p>}
      </SectionCard>
    </div>
  );
}

export function LargestOpenItems({ data }: { data: ReceivablesDashboard }) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? data.largestItems.filter((item) => `${item.customer} ${item.customerCode} ${item.documentRef ?? ""}`.toLocaleLowerCase().includes(normalized)) : data.largestItems;
  }, [data.largestItems, query]);
  return (
    <SectionCard title="Largest open items" action={<span className="text-xs text-muted">Top 50 by live open balance · credits retained</span>}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer or document" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm md:max-w-sm" /><span className="text-xs text-muted">{formatNumber(items.length)} displayed</span></div>
      <ScrollableTable><TableWrap>
        <Thead><Th>Customer</Th><Th>Document</Th><Th>Due date</Th><Th>Ageing</Th><Th align="right">Open balance</Th></Thead>
        <tbody>{items.map((item, index) => <tr key={`${item.customerCode}-${item.documentRef ?? "none"}-${index}`}><Td><span className="font-medium">{item.customer}</span><span className="ml-2 text-xs text-muted">{item.customerCode}</span></Td><Td>{item.documentRef ?? "—"}</Td><Td>{new Date(item.dueDate).toLocaleDateString("en-KE")}</Td><Td><Badge tier={bucketTier(item.bucket)}>{item.bucket}</Badge></Td><Td align="right">{money(item.openBalance)}</Td></tr>)}</tbody>
      </TableWrap></ScrollableTable>
    </SectionCard>
  );
}
