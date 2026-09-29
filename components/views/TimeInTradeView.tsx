"use client";

import { useEffect, useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { useCurrentUser } from "@/components/dashboard/UserContext";
import { InlineReportExport } from "@/components/reports/InlineReportExport";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionCard } from "@/components/ui/KpiGrid";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { TableWrap, Td, Th, Thead, TotalRow } from "@/components/ui/Table";
import { RoleToggle, type RoleFilter } from "@/components/ui/RoleToggle";
import { formatNumber } from "@/lib/format";
import { Clock20Regular } from "@fluentui/react-icons";

// Mirrors lib/timeInTrade.ts's own shapes, kept as a local, independent copy
// (not imported) — that module pulls in Prisma for its raw SQL, which must
// never end up in a client bundle. Every other Coverage tab's view component
// follows the same "own local DTO, fetched via API route" convention.
type TimeInTradeSource = "pine" | "eabl" | "upfield" | "unilever";

const SOURCE_LABELS: Record<TimeInTradeSource, string> = {
  pine: "Pine",
  eabl: "EABL",
  upfield: "Upfield",
  unilever: "Unilever",
};

interface TimeInTradeRow {
  source: TimeInTradeSource;
  principalKey: string;
  principal: string;
  bucketKey: string;
  bucketLabel: string;
  repDays: number;
  visits: number;
  productiveVisits: number | null;
  productivityPct: number | null;
  avgStartTime: string | null;
  avgCloseTime: string | null;
  avgHoursInTrade: number | null;
  newOutlets: number | null;
}

interface TimeInTradeResponse {
  buckets: { key: string; label: string }[];
  rows: TimeInTradeRow[];
}

/** Whole-period roll-up per principal, for the summary table — a total
 *  across every bucket the trend covers, not just the latest one. */
function summarizePrincipal(rows: TimeInTradeRow[], principalKey: string) {
  const principalRows = rows.filter((r) => r.principalKey === principalKey);
  const source = principalRows[0]?.source ?? "pine";
  const principal = principalRows[0]?.principal ?? principalKey;
  const visits = principalRows.reduce((sum, r) => sum + r.visits, 0);
  const repDays = principalRows.reduce((sum, r) => sum + r.repDays, 0);
  const productiveRows = principalRows.filter((r) => r.productiveVisits !== null);
  const productivityPct = productiveRows.length > 0 && visits > 0
    ? Math.round((productiveRows.reduce((sum, r) => sum + (r.productiveVisits ?? 0), 0) / visits) * 1000) / 10
    : null;
  return { source, principal, visits, repDays, productivityPct };
}

export function TimeInTradeView() {
  const currentUser = useCurrentUser();
  const period = useDashboardStore((s) => s.selectedPeriod);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [data, setData] = useState<TimeInTradeResponse | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      try {
        const params = new URLSearchParams({ kind: period.kind, year: period.year, role: roleFilter });
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
  }, [period.kind, period.year, period.month, period.toYear, period.toMonth, roleFilter]);

  if (status === "loading") return <FullPageSpinner label="Loading Time in Trade…" />;
  if (status === "error" || !data) {
    return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Couldn't load Time in Trade" description="Try refreshing the page. If this keeps happening, the underlying Timestamp syncs may be behind schedule." />;
  }
  if (data.buckets.length === 0) {
    return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Select a Month, Quarter, or Year filter" description="Time in Trade trends by week within a month, by month within a quarter, or by quarter within a year — pick one of those periods above to see a trend." />;
  }

  const principalKeys = Array.from(new Set(data.rows.map((r) => r.principalKey)));
  const principalSummaries = principalKeys.map((key) => summarizePrincipal(data.rows, key)).sort((a, b) => b.visits - a.visits);
  const totalVisits = principalSummaries.reduce((sum, p) => sum + p.visits, 0);
  const totalRepDays = principalSummaries.reduce((sum, p) => sum + p.repDays, 0);

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        accent="navy"
        title="Time in Trade"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted">Average start/close time and productivity per principal</span>
            <InlineReportExport reportKey="time-in-trade" allowedPages={currentUser?.allowedPages ?? []} isAdmin={currentUser?.role === "ADMIN"} />
          </div>
        }
      >
        <p className="text-sm text-muted-strong">
          Consolidates each principal&apos;s own average outlet start/close time, productivity, and incremental (new)
          outlets — sourced from whichever Timestamp system tracks that principal (Pine covers most; EABL, Upfield and
          Unilever each track their own) — trended as weeks within a month, months within a quarter, or quarters within
          a year, matching the period filter above.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-muted-strong">Sales Role</span>
          <RoleToggle value={roleFilter} onChange={setRoleFilter} />
          <span className="text-xs text-muted">Only narrows Pine — EABL, Upfield and Unilever have no Primary/Secondary role of their own</span>
        </div>
      </SectionCard>

      <SectionCard title="By Principal" action={<span className="text-xs text-muted">Totals across {data.buckets.length} period(s) in the current filter</span>}>
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th>System</Th>
            <Th align="right">Rep-Days</Th>
            <Th align="right">Visits</Th>
            <Th align="center">Productivity %</Th>
          </Thead>
          <tbody>
            {principalSummaries.map((p) => (
              <tr key={p.principal}>
                <Td className="font-semibold">{p.principal}</Td>
                <Td>{SOURCE_LABELS[p.source]}</Td>
                <Td align="right">{formatNumber(p.repDays)}</Td>
                <Td align="right">{formatNumber(p.visits)}</Td>
                <Td align="center">{p.productivityPct !== null ? `${p.productivityPct}%` : "—"}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">{formatNumber(totalRepDays)}</Td>
              <Td align="right">{formatNumber(totalVisits)}</Td>
              <Td align="center">—</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Trend by Principal" action={<span className="text-xs text-muted">{data.buckets.map((b) => b.label).join(" · ")}</span>}>
        <TableWrap>
          <Thead>
            <Th>Period</Th>
            <Th>Principal</Th>
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
              <tr key={`${row.bucketKey}|${row.principalKey}`}>
                <Td>{row.bucketLabel}</Td>
                <Td>{row.principal}</Td>
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
