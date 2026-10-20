"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import type { GlobalAgeingSummary } from "@/lib/globalAgeing";

type PeriodMode = "all" | "month" | "range";

function kes(value: number): string {
  return `KES ${formatNumber(value)}`;
}

const controlClass = "rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue";

/** Global Ageing: one module with the filters, the summary strip and the per-Principal pivot. Matches your own SAP ageing query's
 *  bucket set (Future / Current month / 1-12 months ago / Over 12), unlike the days-past-due buckets the other Financials tabs use -
 *  see lib/globalAgeing.ts. Always "as of" the latest receivables sync. The customer detail and the post-dated cheque list are in the
 *  Excel report, filtered the same way. */
export function GlobalAgeingTab() {
  const [summary, setSummary] = useState<GlobalAgeingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [principals, setPrincipals] = useState<string[]>([]);
  const [mode, setMode] = useState<PeriodMode>("all");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const principalMenu = useRef<HTMLDetailsElement>(null);

  // The filters as a query string: the screen and the Excel report read the same one.
  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const name of principals) params.append("principal", name);
    if (mode === "month" && month) params.set("month", month);
    if (mode === "range") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    return params.toString();
  }, [principals, mode, month, from, to]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setUpdating(true);
      try {
        const res = await fetch(`/api/receivables/global-ageing${query ? `?${query}` : ""}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Failed to load the Global Ageing report.");
        if (!cancelled) {
          setSummary(body as GlobalAgeingSummary);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the Global Ageing report.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setUpdating(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close the principal list when the user clicks elsewhere.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const menu = principalMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function togglePrincipal(name: string) {
    setPrincipals((current) => (current.includes(name) ? current.filter((p) => p !== name) : [...current, name]));
  }

  function clearFilters() {
    setPrincipals([]);
    setMode("all");
    setMonth("");
    setFrom("");
    setTo("");
  }

  if (loading) {
    return (
      <SectionCard title="Global Ageing" accent="navy">
        <p className="text-sm text-muted">Loading the Global Ageing report…</p>
      </SectionCard>
    );
  }

  if (error && !summary) {
    return (
      <SectionCard title="Global Ageing" accent="red">
        <p className="text-sm text-accent-red">{error}</p>
      </SectionCard>
    );
  }

  if (!summary) return null;

  const monthCols = [summary.currentMonthLabel, ...summary.monthLabels];
  const filtered = principals.length > 0 || mode !== "all";
  const principalLabel = principals.length === 0 ? "All principals" : principals.length === 1 ? principals[0] : `${principals.length} principals`;

  return (
    <SectionCard
      title="Global Ageing"
      accent="navy"
      action={
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted">As of {new Date(summary.asOf).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</span>
          <a
            href={`/api/receivables/global-ageing/export${query ? `?${query}` : ""}`}
            className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            title="Excel report: summary, ageing by principal, customer detail and post-dated cheques, for the filters below"
          >
            Export to Excel
          </a>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Filters: they narrow the summary below and the Excel report. */}
        <div className="flex flex-wrap items-center gap-2">
          <details ref={principalMenu} className="relative">
            <summary className={`${controlClass} cursor-pointer list-none select-none`}>{principalLabel} ▾</summary>
            <div className="absolute left-0 z-20 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-lg">
              <button type="button" onClick={() => setPrincipals([])} className="mb-1 w-full rounded-lg px-2 py-1 text-left text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
                All principals
              </button>
              {summary.availablePrincipals.map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-accent-blue-soft">
                  <input type="checkbox" checked={principals.includes(name)} onChange={() => togglePrincipal(name)} />
                  <span className="truncate">{name}</span>
                </label>
              ))}
            </div>
          </details>

          <select value={mode} onChange={(e) => setMode(e.target.value as PeriodMode)} className={controlClass} aria-label="Period">
            <option value="all">All dates</option>
            <option value="month">Month</option>
            <option value="range">From - to date</option>
          </select>
          {mode === "month" ? <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={controlClass} aria-label="Month" /> : null}
          {mode === "range" ? (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={controlClass} aria-label="From date" />
              <span className="text-xs text-muted">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={controlClass} aria-label="To date" />
            </>
          ) : null}
          {filtered ? (
            <button type="button" onClick={clearFilters} className="rounded-full bg-background px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
              Clear filters
            </button>
          ) : null}
          {updating ? <span className="text-xs text-muted">Updating…</span> : null}
        </div>
        {mode !== "all" ? (
          <p className="-mt-2 text-[11px] text-muted">The period filters invoices and credits by their document date and post-dated cheques by their due date; the month columns stay relative to the as-of date.</p>
        ) : null}
        {error ? <p className="text-xs text-accent-red">{error}</p> : null}

        {/* Summary strip: one horizontal row. */}
        <div className="grid grid-cols-3 gap-3">
          <KpiCard accent="mission" label="Total debts" value={kes(summary.grandTotal.totalDebts)} sublabel={`${formatNumber(summary.customerCount)} customer(s) with a balance`} />
          <KpiCard accent="quarter" label="PDQ cheques held" value={kes(summary.grandTotal.pdqCheques)} sublabel={`${formatNumber(summary.chequeCount)} post-dated cheque(s), from SAP`} />
          <KpiCard accent="growth" label="Balance due" value={kes(summary.grandTotal.balanceDue)} sublabel="SAP open receivables ledger" />
        </div>

        {/* Ageing by principal, in the same module. */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Ageing by Principal</h3>
            <span className="text-xs text-muted">{summary.byPrincipal.length} principal(s) · customer detail is in the Excel report</span>
          </div>
          {summary.principalNotes.inferredCustomers + summary.principalNotes.unclassifiedCustomers > 0 ? (
            <p className="mb-2 text-[11px] text-muted">
              {summary.principalNotes.inferredCustomers > 0
                ? `${formatNumber(summary.principalNotes.inferredCustomers)} customer(s) (${kes(summary.principalNotes.inferredDebts)}) have no Property in SAP and are placed under the principal they buy most. `
                : ""}
              {summary.principalNotes.unclassifiedCustomers > 0
                ? `${formatNumber(summary.principalNotes.unclassifiedCustomers)} customer(s) (${kes(summary.principalNotes.unclassifiedDebts)}) have no Property and no sales yet, so they stay Unclassified. `
                : ""}
              The Excel report&apos;s Customer Detail shows the source of each; set the Property in SAP to settle them.
            </p>
          ) : null}
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
              {summary.byPrincipal.map((row) => (
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
              {summary.byPrincipal.length === 0 ? (
                <tr><td colSpan={monthCols.length + 5} className="px-3 py-6 text-center text-muted">No balances or post-dated cheques for this selection.</td></tr>
              ) : null}
            </tbody>
            {summary.byPrincipal.length > 0 ? (
              <tfoot>
                <TotalRow>
                  <Td><span className="font-semibold">Grand Total</span></Td>
                  <Td align="right">{kes(summary.grandTotal.totalDebts)}</Td>
                  <Td align="right">{kes(summary.grandTotal.pdqCheques)}</Td>
                  <Td align="right">{kes(summary.grandTotal.balanceDue)}</Td>
                  <Td align="right">{kes(summary.grandTotal.buckets.future)}</Td>
                  <Td align="right">{kes(summary.grandTotal.buckets.currentMonth)}</Td>
                  {summary.grandTotal.buckets.monthsAgo.map((v, i) => <Td key={i} align="right">{kes(v)}</Td>)}
                  <Td align="right">{kes(summary.grandTotal.buckets.over12)}</Td>
                </TotalRow>
              </tfoot>
            ) : null}
          </TableWrap>
        </div>
      </div>
    </SectionCard>
  );
}
