"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { money } from "@/components/views/ReceivablesView";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { AgeingSnapshotPoint, AgeingTrendForMonth } from "@/lib/receivablesAgeing";

const BUCKET_COLUMNS: { key: keyof NonNullable<AgeingSnapshotPoint["buckets"]>; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "days30", label: "30 days" },
  { key: "days60", label: "60 days" },
  { key: "days90", label: "90 days" },
  { key: "daysOver90", label: "Over 90 days" },
];

function PointRow({ point }: { point: AgeingSnapshotPoint }) {
  return (
    <tr>
      <Td>
        {point.label}
        {point.isApproximate ? <Badge tier="warn">Approximate — excludes since-cleared items</Badge> : null}
      </Td>
      {BUCKET_COLUMNS.map((col) => (
        <Td key={col.key} align="right">{point.buckets ? money(point.buckets[col.key]) : "—"}</Td>
      ))}
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

      <SectionCard title={`Ageing trend — ${month} ${year}`} accent="navy" action={<span className="text-xs text-muted">Last month + calendar weeks, defaults per selected month</span>}>
        <TableWrap>
          <Thead>
            <Th>Period</Th>
            {BUCKET_COLUMNS.map((col) => <Th key={col.key} align="right">{col.label}</Th>)}
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
