"use client";

import { useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import type { ReckittSummary, ReckittTable } from "@/lib/outletUniverse/reckitt";
import { RECKITT_TENURES } from "@/lib/outletUniverse/reckittTenures";

const download = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow";

interface Preview {
  window: string;
  outletCount: number;
  activeCount: number;
  selectedCount: number;
  systemOutlets: number;
  duplicatesMerged: number;
  summary: ReckittSummary;
}

function TenureTable({ table }: { table: ReckittTable }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-primary-blue">{table.title}</h4>
      <TableWrap>
        <Thead>
          <Th>{table.rowHeader}</Th>
          {RECKITT_TENURES.map((t) => <Th key={t}>{t}</Th>)}
          <Th>Total Distinct Coverage</Th>
        </Thead>
        <tbody>
          {[...table.rows, table.total].map((row) => (
            <tr key={row.label} className={row === table.total ? "font-semibold" : undefined}>
              <Td>{row.label}</Td>
              {RECKITT_TENURES.map((t) => <Td key={t}>{formatNumber(row.counts[t])}</Td>)}
              <Td>{formatNumber(row.total)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

/** The Reckitt universe: every shop that bought in the last six months, by buying tenure and Direct / Indirect, with the part selected for Reckitt. Excel (summary + raw rows + definitions) or CSV. */
export function ReckittExtract() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function loadPreview() {
    setState("loading");
    try {
      const response = await fetch("/api/outlet-universe/reckitt?format=json", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setPreview(await response.json());
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <SectionCard
      title="Reckitt universe"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/outlet-universe/reckitt?format=xlsx" className={download} download>Download Excel (summary + data)</a>
          <a href="/api/outlet-universe/reckitt?format=csv" className={download} download>Download raw CSV</a>
        </div>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-muted">
        The entire universe, and the part selected for Reckitt: every shop that <em>bought</em> in the last six months (this month included), counted once, with its buying tenure
        (<strong>Once in 6 Months</strong>, <strong>Once in 3 Months</strong> or <strong>Once Per Month</strong>, the strictest it kept up), Direct (Primary) or Indirect, and its segment restructured from the source system&apos;s own (highlighted in the Excel).
        The active universe (bought in the last 90 days) is grouped the same way. Selected for Reckitt means a segment Reckitt can stock spending above KSh 20k a purchase (wholesalers) or KSh 1k (everything else); Beauty Shop, Pharmacies, Baby Shop and Institutions are always in. Whole universe within your principals: the filters above do not narrow it.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={loadPreview} disabled={state === "loading"} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-60">
          {state === "loading" ? "Loading…" : "Preview summary"}
        </button>
      </div>
      {state === "error" ? <p className="text-sm text-muted">The preview could not be loaded.</p> : null}
      {preview ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted">
            <strong>{preview.window}</strong>: {formatNumber(preview.outletCount)} shops bought in the window ({formatNumber(preview.systemOutlets)} system outlets, {formatNumber(preview.duplicatesMerged)} merged as duplicates);
            {" "}{formatNumber(preview.activeCount)} of them bought in the last 90 days; {formatNumber(preview.selectedCount)} are selected for Reckitt.
          </p>
          <TenureTable table={preview.summary.entire.all} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TenureTable table={preview.summary.entire.directSegment} />
            <TenureTable table={preview.summary.entire.indirectSegment} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold text-primary-blue">Active universe: bought in the last 90 days ({formatNumber(preview.activeCount)} shops)</h4>
            <p className="text-xs text-muted">The dashboard&apos;s Active outlets, grouped by buying tenure. The last table counts system outlets, as the Outlet Cleanup tile does.</p>
          </div>
          <TenureTable table={preview.summary.active.all} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TenureTable table={preview.summary.active.directSegment} />
            <TenureTable table={preview.summary.active.indirectSegment} />
          </div>
          <TenureTable table={preview.summary.activeOutlets} />
          <TenureTable table={preview.summary.selected.all} />
          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold text-primary-blue">Recommended coverage for Reckitt</h4>
            <TableWrap>
              <Thead>
                <Th>Segment / Type</Th>
                <Th>Direct</Th>
                <Th>Indirect</Th>
                <Th>Total Distinct Coverage</Th>
              </Thead>
              <tbody>
                {preview.summary.recommended.map((row) => (
                  <tr key={row.label}>
                    <Td>{row.label}</Td>
                    <Td>{formatNumber(row.direct)}</Td>
                    <Td>{formatNumber(row.indirect)}</Td>
                    <Td>{formatNumber(row.total)}</Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td>Grand Total</Td>
                  <Td>{formatNumber(preview.summary.recommended.reduce((s, r) => s + r.direct, 0))}</Td>
                  <Td>{formatNumber(preview.summary.recommended.reduce((s, r) => s + r.indirect, 0))}</Td>
                  <Td>{formatNumber(preview.summary.recommended.reduce((s, r) => s + r.total, 0))}</Td>
                </tr>
              </tbody>
            </TableWrap>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
