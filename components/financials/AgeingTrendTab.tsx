"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { money } from "@/components/views/ReceivablesView";
import { formatPercent } from "@/lib/format";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { AgeingSnapshotPoint, AgeingTrendForMonth } from "@/lib/receivablesAgeing";

// Same "within 30 days = Current" merge as the Total Outstanding/Debtor
// module, applied here too so both views agree on what "Current" means.
// The underlying snapshot keeps all 5 raw buckets in storage; only the
// display folds current+days30 together.
const BUCKET_COLUMNS: { key: "current" | "days60" | "days90" | "daysOver90"; label: string }[] = [
  { key: "current", label: "Current (0–30 days)" },
  { key: "days60", label: "60 days" },
  { key: "days90", label: "90 days" },
  { key: "daysOver90", label: "Over 90 days" },
];

function mergedBuckets(raw: NonNullable<AgeingSnapshotPoint["buckets"]>) {
  return { current: raw.current + raw.days30, days60: raw.days60, days90: raw.days90, daysOver90: raw.daysOver90 };
}

function PointRow({ point }: { point: AgeingSnapshotPoint }) {
  const buckets = point.buckets ? mergedBuckets(point.buckets) : null;
  const total = buckets ? buckets.current + buckets.days60 + buckets.days90 + buckets.daysOver90 : 0;
  return (
    <tr>
      <Td>
        {point.label}
        {point.isApproximate ? <Badge tier="warn">Approximate — excludes since-cleared items</Badge> : null}
      </Td>
      {BUCKET_COLUMNS.map((col) => (
        <Td key={col.key} align="right">
          {buckets ? (
            <>
              {money(buckets[col.key])}
              <span className="ml-1 text-xs text-muted">({total > 0 ? formatPercent((buckets[col.key] / total) * 100) : "—"})</span>
            </>
          ) : "—"}
        </Td>
      ))}
      <Td align="right" className="font-semibold">{buckets ? money(total) : "—"}</Td>
      <Td className="text-xs text-muted">{point.snapshotDate ? new Date(point.snapshotDate).toLocaleDateString("en-KE") : "No snapshot yet"}</Td>
    </tr>
  );
}

export function AgeingTrendTab({ ageingTrend, year, month }: { ageingTrend: AgeingTrendForMonth; year: number; month: string }) {
  const years = Array.from({ length: 3 }, (_, i) => year - 1 + i);

  return (
    <div id="ageing-trend" className="@container flex flex-col gap-4">
      <SectionCard title="Select month" accent="blue">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="ageing-trend" />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-strong">Year</label>
            <select name="year" defaultValue={year} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-strong">Month</label>
            <select name="month" defaultValue={month} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              {CANONICAL_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button type="submit" className="rounded-full bg-[#075a4b] px-4 py-2 text-xs font-semibold text-white">View</button>
        </form>
      </SectionCard>

      <SectionCard
        title={`Ageing trend — ${month} ${year}`}
        accent="navy"
        action={<span className="text-xs text-muted">Closing balance last month, then each week of the current month distinctly — figures and % of that period&apos;s own total</span>}
      >
        <TableWrap>
          <Thead>
            <Th>Period</Th>
            {BUCKET_COLUMNS.map((col) => <Th key={col.key} align="right">{col.label}</Th>)}
            <Th align="right">Total</Th>
            <Th>As of</Th>
          </Thead>
          <tbody>
            <PointRow point={ageingTrend.lastMonth} />
            {ageingTrend.weeks.map((point) => <PointRow key={point.label} point={point} />)}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
