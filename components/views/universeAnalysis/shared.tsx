"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { TableWrap, Td, Th, Thead, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, strikeRateTier } from "@/lib/format";
import type { SummaryGroup, SummaryRow } from "@/lib/universeAnalysis/metrics";

export interface AnalysisMeta {
  month: { monthIndex: number; label: string };
  availableMonths: { monthIndex: number; label: string }[];
  defaultMonthIndex: number;
  builtAt: string;
  rowCount: number;
  sourcesWithoutCalls: string[];
}

export type LoadStatus = "loading" | "ready" | "error";

/** Fetches one section of the analysis and refetches when the query changes. */
export function useSection<T>(section: string, query: string, enabled = true): { data: T | null; status: LoadStatus } {
  const [state, setState] = useState<{ data: T | null; status: LoadStatus; key: string }>({ data: null, status: "loading", key: "" });
  const key = `${section}?${query}`;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/universe-analysis?section=${section}&${query}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load.");
        if (!cancelled) setState({ data: body as T, status: "ready", key });
      } catch {
        if (!cancelled) setState({ data: null, status: "error", key });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section, query, enabled, key]);
  // Until the response for the current query arrives, show the loading state (keep the old data out of view so a changed filter never shows stale numbers).
  return state.key === key ? { data: state.data, status: state.status } : { data: null, status: "loading" };
}

/** A ratio (0..1) as a percentage, or a dash. */
export const ratioPct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? "–" : `${(value * 100).toFixed(digits)}%`);
/** A value already in percent. */
export const plainPct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? "–" : `${value.toFixed(digits)}%`);
export const millions = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? "–" : (value / 1e6).toFixed(digits));
export const kes = (value: number | null | undefined) => (value === null || value === undefined || Number.isNaN(value) ? "–" : `KES ${formatCompact(value)}`);
export const count = (value: number | null | undefined) => formatNumber(value);

/** Strike rate (a ratio) as a coloured badge. Same bands as the Coverage page: 75%+ good, 50-74.9% watch, under 50% needs attention. */
export function StrikeBadge({ ratio }: { ratio: number | null | undefined }) {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return <span className="text-muted">n/a</span>;
  return <Badge tier={strikeRateTier(ratio * 100)}>{(ratio * 100).toFixed(1)}%</Badge>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted">{children}</p>;
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(11,61,53,0.06)]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-tight text-foreground">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">{children}</div>;
}

/** The strike table every breakdown shares: pairs, calls with an outcome, productive, unproductive, strike rate, unproductive value and year-to-date sales. */
export function StrikeGroupTable({ groups, labelHeader, label, total = true }: { groups: SummaryGroup[]; labelHeader: string; label: (key: SummaryGroup["key"]) => string; total?: boolean }) {
  const sum = (pick: (g: SummaryRow) => number) => groups.reduce((s, g) => s + pick(g), 0);
  const calls = sum((g) => g.callsWithOutcome);
  const productive = sum((g) => g.productiveCalls);
  return (
    <TableWrap>
      <Thead>
        <Th>{labelHeader}</Th>
        <Th align="right">Outlet-principal pairs</Th>
        <Th align="right">Calls with outcome</Th>
        <Th align="right">Productive</Th>
        <Th align="right">Unproductive</Th>
        <Th align="right">Strike rate</Th>
        <Th align="right">Unproductive value (KES M)</Th>
        <Th align="right">YTD sales (KES M)</Th>
      </Thead>
      <tbody>
        {groups.map((g, i) => (
          <tr key={`${i}-${label(g.key)}`}>
            <Td>{label(g.key)}</Td>
            <Td align="right">{count(g.outletPrincipalPairs)}</Td>
            <Td align="right">{count(g.callsWithOutcome)}</Td>
            <Td align="right">{count(g.productiveCalls)}</Td>
            <Td align="right">{count(g.unproductiveCalls)}</Td>
            <Td align="right"><StrikeBadge ratio={g.strikeRate} /></Td>
            <Td align="right">{millions(g.unproductiveValue)}</Td>
            <Td align="right">{millions(g.sales)}</Td>
          </tr>
        ))}
        {total && groups.length > 1 ? (
          <TotalRow>
            <Td>Total</Td>
            <Td align="right">{count(sum((g) => g.outletPrincipalPairs))}</Td>
            <Td align="right">{count(calls)}</Td>
            <Td align="right">{count(productive)}</Td>
            <Td align="right">{count(sum((g) => g.unproductiveCalls))}</Td>
            <Td align="right">{calls ? `${((productive / calls) * 100).toFixed(1)}%` : "–"}</Td>
            <Td align="right">{millions(sum((g) => g.unproductiveValue))}</Td>
            <Td align="right">{millions(sum((g) => g.sales))}</Td>
          </TotalRow>
        ) : null}
      </tbody>
    </TableWrap>
  );
}

export const keyLabel = (key: SummaryGroup["key"], ...names: string[]) =>
  names.map((n) => (key[n] === null || key[n] === undefined || key[n] === "" ? "Unassigned" : String(key[n]))).join(" · ");

export function CsvLink({ href, label = "Download CSV" }: { href: string; label?: string }) {
  return (
    <a href={href} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
      {label}
    </a>
  );
}

export function SectionState({ status, children }: { status: LoadStatus; children: ReactNode }) {
  if (status === "loading") return <div className="rounded-2xl bg-surface p-10 text-center text-sm text-muted">Building the analysis…</div>;
  if (status === "error") return <div className="rounded-2xl bg-surface p-10 text-center text-sm text-muted">Couldn&apos;t load this section. Try again in a moment.</div>;
  return <>{children}</>;
}
