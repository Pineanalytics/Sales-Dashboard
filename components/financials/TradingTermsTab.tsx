"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber, formatPercent } from "@/lib/format";
import type { TradingTermsSummary } from "@/lib/tradingTerms";

interface Payload {
  from: string;
  to: string;
  availablePrincipals: string[];
  missingMonths: string[];
  monthsWithoutTerms: string[];
  dataAsOf: string | null;
  summary: TradingTermsSummary;
}

const kes = (value: number) => `KES ${formatNumber(value)}`;
const share = (part: number, whole: number) => (whole > 0 ? formatPercent((part / whole) * 100) : "—");
const controlClass = "rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue";
const buttonClass = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow";

/** Cash and credit sales by principal, sales by payment term, and the headline figures of the customers behind them. The
 *  customer rows (who makes up 80% of sales, and whose terms differ between principals) are in the Excel report and the
 *  CSV, filtered the same way. See lib/tradingTerms.ts. */
export function TradingTermsTab() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [from, setFrom] = useState(`${thisMonth.slice(0, 4)}-01`);
  const [to, setTo] = useState(thisMonth);
  const [principals, setPrincipals] = useState<string[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(true);
  const principalMenu = useRef<HTMLDetailsElement>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    for (const name of principals) params.append("principal", name);
    return params.toString();
  }, [from, to, principals]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setUpdating(true);
      try {
        const res = await fetch(`/api/receivables/trading-terms?${query}`, { cache: "no-store", signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Failed to load the trading terms report.");
        setData(body as Payload);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load the trading terms report.");
      }
      setUpdating(false);
    }, 300);
    return () => {
      controller.abort();
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

  const principalLabel = principals.length === 0 ? "All principals" : principals.length === 1 ? principals[0] : `${principals.length} principals`;
  const summary = data?.summary;
  const total = summary?.total;

  return (
    <SectionCard
      title="Trading Terms"
      accent="navy"
      action={
        <div className="flex flex-wrap items-center gap-3">
          {data?.dataAsOf ? <span className="text-xs text-muted">Sales read from SAP {new Date(data.dataAsOf).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</span> : null}
          <a href={`/api/receivables/trading-terms?${query}&format=xlsx`} className={buttonClass} title="Excel report: cash and credit by principal, month, branch and term, the customers making 80% of sales, and customers on different terms with different principals">
            Export to Excel
          </a>
          <a href={`/api/receivables/trading-terms?${query}&format=csv`} className={buttonClass} title="Every customer's terms with every principal, as CSV">
            All customer terms (CSV)
          </a>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <details ref={principalMenu} className="relative">
            <summary className={`${controlClass} cursor-pointer list-none select-none`}>{principalLabel} ▾</summary>
            <div className="absolute left-0 z-20 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-lg">
              <button type="button" onClick={() => setPrincipals([])} className="mb-1 w-full rounded-lg px-2 py-1 text-left text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
                All principals
              </button>
              {(data?.availablePrincipals ?? []).map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-accent-blue-soft">
                  <input type="checkbox" checked={principals.includes(name)} onChange={() => setPrincipals((current) => (current.includes(name) ? current.filter((p) => p !== name) : [...current, name]))} />
                  <span className="truncate">{name}</span>
                </label>
              ))}
            </div>
          </details>
          <input type="month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={controlClass} aria-label="From month" />
          <span className="text-xs text-muted">to</span>
          <input type="month" value={to} min={from} max={thisMonth} onChange={(e) => e.target.value && setTo(e.target.value)} className={controlClass} aria-label="To month" />
          {updating ? <span className="text-xs text-muted">Updating…</span> : null}
        </div>
        {error ? <p className="text-xs text-accent-red">{error}</p> : null}
        {data && data.missingMonths.length > 0 ? <p className="text-xs text-accent-red">Invoice lines are not loaded for {data.missingMonths.join(", ")}, so those months are left out.</p> : null}
        {data && data.monthsWithoutTerms.length > 0 ? (
          <p className="text-xs text-accent-red">{data.monthsWithoutTerms.join(", ")} was read from SAP before payment terms were carried: its sales show as Not recorded until the month is reloaded.</p>
        ) : null}

        {summary && total ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard accent="growth" label="Cash terms" value={share(total.cash, total.sales)} sublabel={kes(total.cash)} />
              <KpiCard accent="quarter" label="Credit terms" value={share(total.credit, total.sales)} sublabel={total.unrecorded ? `${kes(total.credit)} · ${share(total.unrecorded, total.sales)} not recorded` : kes(total.credit)} />
              <KpiCard accent="mission" label="Customers making 80% of sales" value={formatNumber(summary.topCustomers)} sublabel={`of ${formatNumber(summary.customers)} · ${kes(summary.topSales)}`} />
              <KpiCard accent="coverage" label="On different terms by principal" value={formatNumber(summary.differingCustomers)} sublabel={`${kes(summary.differingSales)} of sales`} />
            </div>
            <p className="-mt-2 text-[11px] text-muted">
              Net sales excluding VAT, by the payment term on each invoice and credit note. Cash is a term named Cash or COD; every other term is credit. It is the term agreed, not proof of when the money came in.
            </p>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Cash and credit by principal</h3>
              <TableWrap>
                <Thead>
                  <Th>Principal</Th>
                  <Th align="right">Net sales</Th>
                  <Th align="right">Cash sales</Th>
                  <Th align="right">Credit sales</Th>
                  <Th align="right">Cash %</Th>
                  <Th align="right">Credit %</Th>
                  <Th align="right">Customers</Th>
                  <Th align="right">Making 80%</Th>
                </Thead>
                <tbody>
                  {summary.principals.map((row) => (
                    <tr key={row.principal}>
                      <Td><span className="font-medium">{row.principal}</span></Td>
                      <Td align="right">{kes(row.sales)}</Td>
                      <Td align="right">{kes(row.cash)}</Td>
                      <Td align="right">{kes(row.credit)}</Td>
                      <Td align="right">{share(row.cash, row.sales)}</Td>
                      <Td align="right">{share(row.credit, row.sales)}</Td>
                      <Td align="right">{formatNumber(row.customers)}</Td>
                      <Td align="right">{formatNumber(row.topCustomers)}</Td>
                    </tr>
                  ))}
                  {summary.principals.length === 0 ? <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">No invoice lines for this selection.</td></tr> : null}
                </tbody>
                {summary.principals.length > 0 ? (
                  <tfoot>
                    <TotalRow>
                      <Td><span className="font-semibold">Total</span></Td>
                      <Td align="right">{kes(total.sales)}</Td>
                      <Td align="right">{kes(total.cash)}</Td>
                      <Td align="right">{kes(total.credit)}</Td>
                      <Td align="right">{share(total.cash, total.sales)}</Td>
                      <Td align="right">{share(total.credit, total.sales)}</Td>
                      <Td align="right">{formatNumber(summary.customers)}</Td>
                      <Td align="right">{formatNumber(summary.topCustomers)}</Td>
                    </TotalRow>
                  </tfoot>
                ) : null}
              </TableWrap>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Sales by payment term</h3>
              <TableWrap>
                <Thead>
                  <Th>Payment term</Th>
                  <Th>Cash or credit</Th>
                  <Th align="right">Days in SAP</Th>
                  <Th align="right">Net sales</Th>
                  <Th align="right">Share</Th>
                  <Th align="right">Customers</Th>
                </Thead>
                <tbody>
                  {summary.terms.map((term) => (
                    <tr key={term.term}>
                      <Td><span className="font-medium">{term.term}</span></Td>
                      <Td>{term.kind}</Td>
                      <Td align="right">{term.days ?? "—"}</Td>
                      <Td align="right">{kes(term.sales)}</Td>
                      <Td align="right">{share(term.sales, total.sales)}</Td>
                      <Td align="right">{formatNumber(term.customers)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
            {summary.leftOut.length > 0 ? (
              <p className="text-[11px] text-muted">
                Counted in the sales figures but left out of the customer rankings, as not normal customers: {summary.leftOut.map((entry) => `${entry.customer} (${kes(entry.sales)})`).join("; ")}.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
