"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import type { GlobalAgeingReport } from "@/lib/globalAgeing";
import { updatePdqChequeAction } from "@/app/(protected)/(analytics)/financials/actions";

const DETAIL_ROW_CAP = 200;

function kes(value: number): string {
  return `KES ${formatNumber(value)}`;
}

/** Matches your own SAP ageing query's bucket set (Future / Current month /
 *  1-12 months ago / Over 12), unlike the days-past-due buckets the other
 *  Financials tabs use — see lib/globalAgeing.ts for why these are kept
 *  separate rather than merged. Always "as of" the latest receivables sync:
 *  there is no per-customer history to query a past date from. */
export function GlobalAgeingTab({ isAdmin }: { isAdmin: boolean }) {
  const [report, setReport] = useState<GlobalAgeingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [pdqDrafts, setPdqDrafts] = useState<Record<string, string>>({});
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/receivables/global-ageing", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Failed to load the Global Ageing report.");
        if (!cancelled) {
          setReport(body as GlobalAgeingReport);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the Global Ageing report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleCustomers = useMemo(() => {
    if (!report) return [];
    const matches = normalizedSearch
      ? report.byCustomer.filter(
          (c) => c.customerName.toLowerCase().includes(normalizedSearch) || c.customerCode.toLowerCase().includes(normalizedSearch) || c.principal.toLowerCase().includes(normalizedSearch)
        )
      : report.byCustomer;
    const sorted = [...matches].sort((a, b) => Math.abs(b.totalDebts) - Math.abs(a.totalDebts));
    return normalizedSearch ? sorted : sorted.slice(0, DETAIL_ROW_CAP);
  }, [report, normalizedSearch]);

  async function savePdq(customerCode: string) {
    const raw = pdqDrafts[customerCode];
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return;
    setSavingCode(customerCode);
    try {
      const result = await updatePdqChequeAction(customerCode, amount);
      if (!result.ok) {
        setError(result.error ?? "Failed to save PDQ cheques.");
        return;
      }
      setReloadTick((tick) => tick + 1);
      setPdqDrafts((prev) => {
        const next = { ...prev };
        delete next[customerCode];
        return next;
      });
    } finally {
      setSavingCode(null);
    }
  }

  if (loading) {
    return (
      <SectionCard title="Global Ageing" accent="navy">
        <p className="text-sm text-muted">Loading the Global Ageing report…</p>
      </SectionCard>
    );
  }

  if (error && !report) {
    return (
      <SectionCard title="Global Ageing" accent="red">
        <p className="text-sm text-accent-red">{error}</p>
      </SectionCard>
    );
  }

  if (!report) return null;

  const monthCols = [report.currentMonthLabel, ...report.monthLabels];

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Global Ageing"
        accent="navy"
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">As of {new Date(report.asOf).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</span>
            <a
              href="/api/receivables/global-ageing/export"
              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            >
              Export to Excel
            </a>
          </div>
        }
      >
        {error ? <p className="mb-3 text-xs text-accent-red">{error}</p> : null}
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
          <KpiCard accent="mission" label="Total debts" value={kes(report.grandTotal.totalDebts)} sublabel={`${report.byCustomer.length} customer(s) with a balance`} />
          <KpiCard accent="quarter" label="PDQ cheques held" value={kes(report.grandTotal.pdqCheques)} sublabel="Manually tracked — not in SAP's open ledger" />
          <KpiCard accent="growth" label="Balance due" value={kes(report.grandTotal.balanceDue)} sublabel="From SAP's open receivables ledger" />
        </div>
      </SectionCard>

      <SectionCard title="Ageing by Principal" accent="amber" action={<span className="text-xs text-muted">{report.byPrincipal.length} principal(s)</span>}>
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Total Debts</Th>
            <Th align="right">PDQ Cheques</Th>
            <Th align="right">Balance Due</Th>
            <Th align="right">Future</Th>
            {monthCols.map((label) => <Th key={label} align="right">{label}</Th>)}
            <Th align="right">Over 12 Mth Ago</Th>
          </Thead>
          <tbody>
            {report.byPrincipal.map((row) => (
              <tr key={row.principal}>
                <Td><span className="font-medium">{row.principal}</span></Td>
                <Td align="right">{kes(row.totalDebts)}</Td>
                <Td align="right">{kes(row.pdqCheques)}</Td>
                <Td align="right">{kes(row.balanceDue)}</Td>
                <Td align="right">{kes(row.buckets.future)}</Td>
                <Td align="right">{kes(row.buckets.currentMonth)}</Td>
                {row.buckets.monthsAgo.map((v, i) => <Td key={i} align="right">{kes(v)}</Td>)}
                <Td align="right">{kes(row.buckets.over12)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <TotalRow>
              <Td><span className="font-semibold">Grand Total</span></Td>
              <Td align="right">{kes(report.grandTotal.totalDebts)}</Td>
              <Td align="right">{kes(report.grandTotal.pdqCheques)}</Td>
              <Td align="right">{kes(report.grandTotal.balanceDue)}</Td>
              <Td align="right">{kes(report.grandTotal.buckets.future)}</Td>
              <Td align="right">{kes(report.grandTotal.buckets.currentMonth)}</Td>
              {report.grandTotal.buckets.monthsAgo.map((v, i) => <Td key={i} align="right">{kes(v)}</Td>)}
              <Td align="right">{kes(report.grandTotal.buckets.over12)}</Td>
            </TotalRow>
          </tfoot>
        </TableWrap>
      </SectionCard>

      <SectionCard
        title="Customer Detail"
        accent="navy"
        action={
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, BP code or principal…"
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
          />
        }
      >
        <p className="mb-2 text-xs text-muted">
          {normalizedSearch
            ? `${visibleCustomers.length} matching customer(s) of ${report.byCustomer.length}.`
            : `Showing the top ${Math.min(DETAIL_ROW_CAP, report.byCustomer.length)} of ${report.byCustomer.length} customer(s) by balance — search to find a specific one, or export for the full list.`}
        </p>
        <TableWrap>
          <Thead>
            <Th>BP Code</Th>
            <Th>Principal</Th>
            <Th>BP Name</Th>
            <Th align="right">Total Debts</Th>
            <Th align="right">PDQ Cheques</Th>
            <Th align="right">Balance Due</Th>
          </Thead>
          <tbody>
            {visibleCustomers.map((row) => (
              <tr key={row.customerCode}>
                <Td className="text-muted">{row.customerCode}</Td>
                <Td>{row.principal}</Td>
                <Td><span className="font-medium">{row.customerName}</span></Td>
                <Td align="right">{kes(row.totalDebts)}</Td>
                <Td align="right">
                  {isAdmin ? (
                    <div className="inline-flex items-center gap-1.5">
                      <input
                        type="number"
                        value={pdqDrafts[row.customerCode] ?? String(row.pdqCheques)}
                        onChange={(e) => setPdqDrafts((prev) => ({ ...prev, [row.customerCode]: e.target.value }))}
                        className="w-28 rounded-full border border-border bg-surface px-2 py-1 text-right text-xs outline-none focus:border-secondary-blue"
                      />
                      <button
                        type="button"
                        onClick={() => savePdq(row.customerCode)}
                        disabled={savingCode === row.customerCode}
                        className="rounded-full bg-background px-2.5 py-1 text-[11px] font-medium text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50"
                      >
                        {savingCode === row.customerCode ? "Saving…" : "Save"}
                      </button>
                    </div>
                  ) : (
                    kes(row.pdqCheques)
                  )}
                </Td>
                <Td align="right">{kes(row.balanceDue)}</Td>
              </tr>
            ))}
            {visibleCustomers.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No customers match this search.</td></tr>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
