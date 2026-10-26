"use client";

import { useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import { CADENCES, isoWeekOf, isoWeeksInYear, type FrequencyPeriodKind } from "@/lib/outletUniverse/frequencyPeriod";
import type { FrequencySummary, FrequencyTable } from "@/lib/outletUniverse/frequency";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const select = "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-primary-blue";
const download = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow";

interface Preview {
  period: { label: string };
  outletCount: number;
  systemOutlets: number;
  duplicatesMerged: number;
  summary: FrequencySummary;
}

function SummaryTable({ table }: { table: FrequencyTable }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-primary-blue">{table.title}</h4>
      <TableWrap>
        <Thead>
          <Th>{table.rowHeader}</Th>
          {CADENCES.map((c) => <Th key={c}>{c}</Th>)}
          <Th>Total Outlets</Th>
        </Thead>
        <tbody>
          {[...table.rows, table.total].map((row) => (
            <tr key={row.label} className={row === table.total ? "font-semibold" : undefined}>
              <Td>{row.label}</Td>
              {CADENCES.map((c) => <Td key={c}>{formatNumber(row.counts[c])}</Td>)}
              <Td>{formatNumber(row.total)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

/** Coverage frequency for a year, quarter, month or week: the outlets that bought in the period and how often, as Excel (summary + raw rows) or CSV. */
export function FrequencyExtract({ baseParams, minYear = 2026 }: { baseParams: string; minYear?: number }) {
  const now = useMemo(() => new Date(), []);
  const currentWeek = useMemo(() => isoWeekOf(now), [now]);
  const [kind, setKind] = useState<FrequencyPeriodKind>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [week, setWeek] = useState(currentWeek.week);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = now.getFullYear(); y >= minYear; y -= 1) list.push(y);
    return list.length > 0 ? list : [now.getFullYear()];
  }, [now, minYear]);
  const weeks = isoWeeksInYear(year);

  const query = useMemo(() => {
    const params = new URLSearchParams(baseParams);
    params.set("kind", kind);
    params.set("year", String(year));
    if (kind === "quarter") params.set("quarter", String(quarter));
    if (kind === "month") params.set("month", String(month));
    if (kind === "week") params.set("week", String(Math.min(week, weeks)));
    return params;
  }, [baseParams, kind, year, quarter, month, week, weeks]);
  const href = (format: "xlsx" | "csv") => `/api/outlet-universe/frequency?${new URLSearchParams([...query.entries(), ["format", format]]).toString()}`;

  async function loadPreview() {
    setState("loading");
    try {
      const response = await fetch(href("xlsx").replace("format=xlsx", "format=json"), { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setPreview(await response.json());
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const stale = () => setPreview(null);

  return (
    <SectionCard
      title="Coverage frequency extract"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <a href={href("xlsx")} className={download} download>Download Excel (summary + data)</a>
          <a href={href("csv")} className={download} download>Download raw CSV</a>
        </div>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Every shop that <em>bought</em> in the period, once (outlets the cleanup found to be the same shop are merged, and territories are the unified names), with how often it did: Once per Month, in 3 Months, in 6 Months or per Year (its best cadence), its Tier and Average Sales (built as in the Outlet Listing CSV), its Absolute Principal and Direct / Indirect.
        The Excel summary (Total Coverage by channel, and Direct and Indirect by channel and by region) is made of formulas over the Raw Data sheet, so it can be re-cut. It follows the filters above.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Period type" className={select} value={kind} onChange={(e) => { setKind(e.target.value as FrequencyPeriodKind); stale(); }}>
          <option value="year">Yearly</option>
          <option value="quarter">Quarterly</option>
          <option value="month">Monthly</option>
          <option value="week">Weekly</option>
        </select>
        <select aria-label="Year" className={select} value={year} onChange={(e) => { setYear(Number(e.target.value)); stale(); }}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {kind === "quarter" ? (
          <select aria-label="Quarter" className={select} value={quarter} onChange={(e) => { setQuarter(Number(e.target.value)); stale(); }}>
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
          </select>
        ) : null}
        {kind === "month" ? (
          <select aria-label="Month" className={select} value={month} onChange={(e) => { setMonth(Number(e.target.value)); stale(); }}>
            {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
        ) : null}
        {kind === "week" ? (
          <select aria-label="Week" className={select} value={Math.min(week, weeks)} onChange={(e) => { setWeek(Number(e.target.value)); stale(); }}>
            {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
        ) : null}
        <button type="button" onClick={loadPreview} disabled={state === "loading"} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-60">
          {state === "loading" ? "Loading…" : "Preview summary"}
        </button>
      </div>
      {state === "error" ? <p className="text-sm text-muted">The preview could not be loaded.</p> : null}
      {preview ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted"><strong>{preview.period.label}</strong>: {formatNumber(preview.outletCount)} shops bought in the period ({formatNumber(preview.systemOutlets)} system outlets, {formatNumber(preview.duplicatesMerged)} merged as duplicates).</p>
          <SummaryTable table={preview.summary.all} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SummaryTable table={preview.summary.directChannel} />
            <SummaryTable table={preview.summary.indirectChannel} />
            <SummaryTable table={preview.summary.directRegion} />
            <SummaryTable table={preview.summary.indirectRegion} />
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
