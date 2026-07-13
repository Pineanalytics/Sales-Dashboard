"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { Badge } from "@/components/ui/Badge";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCompact, formatNumber, formatPercent, productivityTier, tierTextClass } from "@/lib/format";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle, CHART_COLORS } from "@/components/charts/theme";
import { Clock20Regular } from "@fluentui/react-icons";

interface RepCallRow {
  date: string;
  employeeCode: string;
  salesRep: string;
  employeeGroup: string;
  salesRole: string;
  region: string;
  callSequence: number;
  callTime: string;
  callOutcome: string;
  noSaleReason: string | null;
  outletId: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  costCentresBought: string;
  intervalMins: number | null;
  documents: number;
  sales: number;
  qty: number;
  firstCallOfDay: string;
  lastCallOfDay: string;
  hoursInDay: number;
  callsInDay: number;
  productiveInDay: number;
}

interface RepDaySummary {
  date: string;
  employeeCode: string;
  salesRep: string;
  employeeGroup: string;
  region: string;
  firstCall: string;
  lastCall: string;
  hoursInDay: number;
  callsMade: number;
  productiveCalls: number;
  noSaleCalls: number;
  strikeRatePct: number;
  outletsCovered: number;
  avgIntervalMins: number | null;
  costCentresCovered: string;
  documents: number;
  sales: number;
}

export default function TimestampsPage() {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [calls, setCalls] = useState<RepCallRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/timestamps", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load Timestamps data.");
        if (!cancelled) {
          setCalls(body.calls);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") return <FullPageSpinner label="Loading Timestamps…" />;
  if (status === "error") {
    return (
      <EmptyState
        icon={<Clock20Regular className="h-10 w-10" />}
        title="Couldn't load Timestamps"
        description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule."
      />
    );
  }
  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<Clock20Regular className="h-10 w-10" />}
        title="No call activity recorded yet this month"
        description="This page always reflects the current calendar month only and refreshes automatically from the twice-daily direct-SQL sync — no manual upload needed."
      />
    );
  }

  const totalCalls = calls.length;
  const productiveCalls = calls.filter((c) => c.callOutcome === "Sale").length;
  const strikeRate = totalCalls > 0 ? Math.round((productiveCalls / totalCalls) * 1000) / 10 : 0;
  const outletsCovered = new Set(calls.map((c) => c.outletId)).size;
  const intervals = calls.map((c) => c.intervalMins).filter((v): v is number => v !== null);
  const avgInterval = intervals.length > 0 ? Math.round((intervals.reduce((s, v) => s + v, 0) / intervals.length) * 10) / 10 : null;

  // Rep-daily summary, aggregated live from RepCall rows — one row per Rep x Day,
  // reading the day-level fields the sync already computed (callsInDay etc. are
  // identical across every call in that rep-day) rather than re-deriving them.
  const byRepDay = new Map<string, RepCallRow[]>();
  for (const c of calls) {
    const key = `${c.date}|${c.employeeCode}`;
    if (!byRepDay.has(key)) byRepDay.set(key, []);
    byRepDay.get(key)!.push(c);
  }
  const avgHoursInDay = calls.length > 0 ? [...byRepDay.values()].reduce((s, day) => s + day[0].hoursInDay, 0) / byRepDay.size : 0;

  const repDaySummaries: RepDaySummary[] = Array.from(byRepDay.entries()).map(([, dayCalls]) => {
    const first = dayCalls[0];
    const outlets = new Set(dayCalls.map((c) => c.outletId));
    const dayIntervals = dayCalls.map((c) => c.intervalMins).filter((v): v is number => v !== null);
    const costCentres = new Set<string>();
    dayCalls.forEach((c) => c.costCentresBought.split(", ").filter(Boolean).forEach((cc) => costCentres.add(cc)));
    return {
      date: first.date,
      employeeCode: first.employeeCode,
      salesRep: first.salesRep,
      employeeGroup: first.employeeGroup,
      region: first.region,
      firstCall: first.firstCallOfDay,
      lastCall: first.lastCallOfDay,
      hoursInDay: first.hoursInDay,
      callsMade: first.callsInDay,
      productiveCalls: first.productiveInDay,
      noSaleCalls: first.callsInDay - first.productiveInDay,
      strikeRatePct: first.callsInDay > 0 ? Math.round((first.productiveInDay / first.callsInDay) * 1000) / 10 : 0,
      outletsCovered: outlets.size,
      avgIntervalMins: dayIntervals.length > 0 ? Math.round((dayIntervals.reduce((s, v) => s + v, 0) / dayIntervals.length) * 10) / 10 : null,
      costCentresCovered: Array.from(costCentres).sort().join(", "),
      documents: dayCalls.reduce((s, c) => s + c.documents, 0),
      sales: dayCalls.reduce((s, c) => s + c.sales, 0),
    };
  });
  repDaySummaries.sort((a, b) => (a.date === b.date ? a.salesRep.localeCompare(b.salesRep) : a.date.localeCompare(b.date)));

  // Call-time-of-day distribution (24 hourly buckets).
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, "0")}:00`, value: 0 }));
  for (const c of calls) {
    const hour = new Date(c.callTime).getUTCHours();
    hourBuckets[hour].value += 1;
  }

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="coverage" label="Total Calls (This Month)" value={<AnimatedValue value={totalCalls} format={formatNumber} />} />
        <KpiCard accent="coverage" label="Productive Calls" value={<AnimatedValue value={productiveCalls} format={formatNumber} />} />
        <KpiCard
          accent="growth"
          label="Strike Rate"
          value={<span className={tierTextClass[productivityTier(strikeRate)]}>{formatPercent(strikeRate)}</span>}
        />
        <KpiCard accent="quarter" label="Outlets Covered" value={<AnimatedValue value={outletsCovered} format={formatNumber} />} />
        <KpiCard accent="mission" label="Avg Hours in Day" value={avgHoursInDay.toFixed(1)} sublabel="per rep, per working day" />
        <KpiCard accent="revenue" label="Avg Interval Between Calls" value={avgInterval !== null ? `${avgInterval.toFixed(0)}m` : "—"} />
      </KpiGrid>

      <SectionCard title="Calls by Time of Day">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={hourBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} interval={1} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={CHART_COLORS[0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="Rep Daily Summary" action={<span className="text-xs text-muted">Current calendar month, all reps</span>}>
        <TableWrap>
          <Thead>
            <Th>Date</Th>
            <Th>Sales Rep</Th>
            <Th>Region</Th>
            <Th>First Call</Th>
            <Th>Last Call</Th>
            <Th align="right">Hours in Day</Th>
            <Th align="right">Calls Made</Th>
            <Th align="right">Productive</Th>
            <Th align="center">Strike Rate</Th>
            <Th align="right">Outlets Covered</Th>
            <Th align="right">Avg Interval (mins)</Th>
            <Th align="right">Sales</Th>
          </Thead>
          <tbody>
            {repDaySummaries.map((r) => (
              <tr key={`${r.date}|${r.employeeCode}`}>
                <Td>{r.date}</Td>
                <Td>{r.salesRep}</Td>
                <Td>{r.region}</Td>
                <Td>{new Date(r.firstCall).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</Td>
                <Td>{new Date(r.lastCall).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</Td>
                <Td align="right">{r.hoursInDay.toFixed(1)}</Td>
                <Td align="right">{formatNumber(r.callsMade)}</Td>
                <Td align="right">{formatNumber(r.productiveCalls)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.strikeRatePct)}>{r.strikeRatePct.toFixed(1)}%</Badge>
                </Td>
                <Td align="right">{formatNumber(r.outletsCovered)}</Td>
                <Td align="right">{r.avgIntervalMins !== null ? r.avgIntervalMins.toFixed(0) : "—"}</Td>
                <Td align="right">{formatCompact(r.sales)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td align="right">{avgHoursInDay.toFixed(1)}</Td>
              <Td align="right">{formatNumber(totalCalls)}</Td>
              <Td align="right">{formatNumber(productiveCalls)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(strikeRate)}>{strikeRate.toFixed(1)}%</Badge>
              </Td>
              <Td align="right">{formatNumber(outletsCovered)}</Td>
              <Td align="right">{avgInterval !== null ? avgInterval.toFixed(0) : "—"}</Td>
              <Td align="right">{formatCompact(calls.reduce((s, c) => s + c.sales, 0))}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
