"use client";

import { useEffect, useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { useCurrentUser } from "@/components/dashboard/UserContext";
import { InlineReportExport } from "@/components/reports/InlineReportExport";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import { Clock20Regular } from "@fluentui/react-icons";
import { TIME_IN_TRADE_SOURCES, type TimeInTradeRow, type TimeInTradeSource } from "@/lib/timeInTrade";

interface TimeInTradeResponse {
  buckets: { key: string; label: string }[];
  rows: TimeInTradeRow[];
}

/** Whole-period roll-up per source, for the top KPI row — a visits-weighted
 *  average across every bucket the trend covers, not just the latest one. */
function summarizeSource(rows: TimeInTradeRow[], source: TimeInTradeSource) {
  const sourceRows = rows.filter((r) => r.source === source);
  const visits = sourceRows.reduce((sum, r) => sum + r.visits, 0);
  const repDays = sourceRows.reduce((sum, r) => sum + r.repDays, 0);
  const productiveRows = sourceRows.filter((r) => r.productiveVisits !== null);
  const productivityPct = productiveRows.length > 0 && visits > 0
    ? Math.round((productiveRows.reduce((sum, r) => sum + (r.productiveVisits ?? 0), 0) / visits) * 1000) / 10
    : null;
  const newOutletsRows = sourceRows.filter((r) => r.newOutlets !== null);
  const newOutlets = newOutletsRows.length > 0 ? newOutletsRows.reduce((sum, r) => sum + (r.newOutlets ?? 0), 0) : null;
  return { visits, repDays, productivityPct, newOutlets };
}

export function TimeInTradeView() {
  const currentUser = useCurrentUser();
  const period = useDashboardStore((s) => s.selectedPeriod);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [data, setData] = useState<TimeInTradeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      try {
        const params = new URLSearchParams({ kind: period.kind, year: period.year });
        if (period.month) params.set("month", period.month);
        if (period.toYear) params.set("toYear", period.toYear);
        if (period.toMonth) params.set("toMonth", period.toMonth);
        const res = await fetch(`/api/coverage/time-in-trade?${params.toString()}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load Time in Trade data.");
        if (!cancelled) {
          setData(body);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period.kind, period.year, period.month, period.toYear, period.toMonth]);

  if (status === "loading") return <FullPageSpinner label="Loading Time in Trade…" />;
  if (status === "error" || !data) {
    return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Couldn't load Time in Trade" description="Try refreshing the page. If this keeps happening, the underlying Timestamp syncs may be behind schedule." />;
  }
  if (data.buckets.length === 0) {
    return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Select a Month, Quarter, or Year filter" description="Time in Trade trends by week within a month, by month within a quarter, or by quarter within a year — pick one of those periods above to see a trend." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        accent="navy"
        title="Time in Trade"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted">Average start/close time and productivity per principal module</span>
            <InlineReportExport reportKey="time-in-trade" allowedPages={currentUser?.allowedPages ?? []} isAdmin={currentUser?.role === "ADMIN"} />
          </div>
        }
      >
        <p className="text-sm text-muted-strong">
          Consolidates each Timestamp module&apos;s own average outlet start/close time, productivity, and incremental
          (new) outlets — trended as weeks within a month, months within a quarter, or quarters within a year, matching
          the period filter above.
        </p>
      </SectionCard>

      <KpiGrid>
        {TIME_IN_TRADE_SOURCES.map((source) => {
          const summary = summarizeSource(data.rows, source);
          const label = source === "pine" ? "Pine (SalesEdge)" : source === "eabl" ? "EABL" : source === "upfield" ? "Upfield (DataEdge)" : "Unilever (Leverage)";
          return (
            <KpiCard
              key={source}
              accent="coverage"
              label={label}
              value={<span className="text-lg font-bold">{formatNumber(summary.visits)} visits</span>}
              sublabel={summary.productivityPct !== null ? `${summary.productivityPct}% productive · ${formatNumber(summary.repDays)} rep-days` : `${formatNumber(summary.repDays)} rep-days`}
            />
          );
        })}
      </KpiGrid>

      <SectionCard title="Trend by Principal Module" action={<span className="text-xs text-muted">{data.buckets.map((b) => b.label).join(" · ")}</span>}>
        <TableWrap>
          <Thead>
            <Th>Period</Th>
            <Th>Principal Module</Th>
            <Th align="right">Rep-Days</Th>
            <Th align="right">Visits</Th>
            <Th align="center">Avg Start</Th>
            <Th align="center">Avg Close</Th>
            <Th align="right">Hours in Trade</Th>
            <Th align="center">Productivity %</Th>
            <Th align="right">New Outlets</Th>
          </Thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.bucketKey}|${row.source}`}>
                <Td>{row.bucketLabel}</Td>
                <Td>{row.sourceLabel}</Td>
                <Td align="right">{formatNumber(row.repDays)}</Td>
                <Td align="right">{formatNumber(row.visits)}</Td>
                <Td align="center">{row.avgStartTime ?? "—"}</Td>
                <Td align="center">{row.avgCloseTime ?? "—"}</Td>
                <Td align="right">{row.avgHoursInTrade ?? "—"}</Td>
                <Td align="center">{row.productivityPct !== null ? `${row.productivityPct}%` : "—"}</Td>
                <Td align="right">{row.newOutlets ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-3 text-xs text-muted">
          &quot;—&quot; for Productivity % means the source has no unproductive-visit concept (Upfield/Unilever count only
          real transactions/visits); &quot;—&quot; for New Outlets means the source has no per-outlet identity to compare
          (Unilever) or this is the trend&apos;s first period (nothing prior to compare against).
        </p>
      </SectionCard>
    </div>
  );
}
