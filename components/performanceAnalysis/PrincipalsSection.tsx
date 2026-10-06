"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { principalLede, principalNote } from "@/lib/performanceAnalysis/narrative";
import type { PerformancePayload } from "@/lib/performanceAnalysis/types";
import { Growth, Note, OTHERS_COLOR, PALETTE, Panel, SectionHeading, SortableTable, compact, kes, millions, monthShort, pct, type Column } from "./shared";

const TOP_PRINCIPALS = 7;
/** Months shown for context but outside the selected period are drawn faint. */
const CONTEXT_OPACITY = 0.35;

export function monthLabels(p: PerformancePayload): string[] {
  return p.months.map((m, i) => (p.mtd && i === p.months.length - 1 ? `${monthShort(m)} MTD` : monthShort(m)));
}

/** The "A vs B" heading for the comparison window, or a plain word when the period has none. */
export function comparisonText(p: PerformancePayload): string {
  return p.labels.cq && p.labels.pq ? `${p.labels.cq} vs ${p.labels.pq}` : "Change";
}

export function PrincipalsSection({ p }: { p: PerformancePayload }) {
  const labels = useMemo(() => monthLabels(p), [p]);
  const scope = useMemo(() => new Set(p.scope), [p.scope]);
  const top = p.principals.slice(0, TOP_PRINCIPALS);
  const rest = p.principals.slice(TOP_PRINCIPALS);
  const showMonthColumn = p.labels.cm !== null && p.labels.pm !== null && p.labels.cm !== p.labels.cq;

  const stackData = useMemo(
    () =>
      p.months.map((month, i) => {
        const row: Record<string, string | number | boolean> = { month: labels[i], inScope: scope.has(month) };
        for (const principal of top) row[principal.p] = principal.m[i];
        row.Others = rest.reduce((sum, principal) => sum + principal.m[i], 0);
        return row;
      }),
    [p, labels, scope, top, rest]
  );
  const shareData = useMemo(() => {
    const slices = top.map((principal, index) => ({ name: principal.p, value: Math.max(principal.sales, 0), fill: PALETTE[index % PALETTE.length] }));
    const others = rest.reduce((sum, principal) => sum + Math.max(principal.sales, 0), 0);
    return others > 0 ? [...slices, { name: "Others", value: others, fill: OTHERS_COLOR }] : slices;
  }, [top, rest]);

  const selectable = p.principals.filter((principal) => principal.sales > 0);
  const [selected, setSelected] = useState<string>("");
  const one = selectable.find((principal) => principal.p === selected) ?? selectable[0];
  const oneData = one ? p.months.map((month, i) => ({ month: labels[i], inScope: scope.has(month), sales: one.m[i], margin: one.m[i] ? Math.round((one.g[i] / one.m[i]) * 1000) / 10 : null })) : [];

  const peak = Math.max(1, ...p.principals.flatMap((principal) => principal.m.filter((_, i) => scope.has(p.months[i]) && !(p.mtd && i === p.months.length - 1))));
  type Row = PerformancePayload["principals"][number];
  const columns: Column<Row>[] = [
    { id: "principal", header: "Principal", align: "left", render: (row) => row.p, sortValue: (row) => row.p },
    ...p.months.map((month, i) => ({
      id: `m${i}`,
      header: labels[i],
      render: (row: Row) => millions(row.m[i]),
      sortValue: (row: Row) => row.m[i],
      cellClassName: scope.has(month) ? "" : "text-muted",
      cellStyle: (row: Row) => (scope.has(month) ? { backgroundColor: `rgba(36,117,79,${Math.max(0, Math.min(0.4, (row.m[i] / peak) * 0.4)).toFixed(2)})` } : undefined),
    })),
    { id: "period", header: "Period", render: (row) => millions(row.sales), sortValue: (row) => row.sales },
    { id: "share", header: "Share", render: (row) => pct(row.share), sortValue: (row) => row.share },
    { id: "qq", header: comparisonText(p), render: (row) => <Growth value={row.cqGrowth} />, sortValue: (row) => row.cqGrowth },
    ...(showMonthColumn
      ? [{ id: "mm", header: `${p.labels.cm} vs ${p.labels.pm}`, render: (row: Row) => <Growth value={row.cmGrowth} />, sortValue: (row: Row) => row.cmGrowth }]
      : []),
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2), sortValue: (row) => row.gpm },
  ];

  const note = principalNote(p);
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="principals" title="1. Trended performance per principal" lede={principalLede(p)} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Net sales by principal, monthly" hint={`KES M; months outside the selected period are faint${p.mtd ? "; the latest month is month to date" : ""}`} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={stackData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [kes(Number(value)), String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
              {top.map((principal, index) => (
                <Bar key={principal.p} dataKey={principal.p} stackId="sales" fill={PALETTE[index % PALETTE.length]}>
                  {stackData.map((row) => (
                    <Cell key={String(row.month)} fillOpacity={row.inScope ? 1 : CONTEXT_OPACITY} />
                  ))}
                </Bar>
              ))}
              <Bar dataKey="Others" stackId="sales" fill={OTHERS_COLOR}>
                {stackData.map((row) => (
                  <Cell key={String(row.month)} fillOpacity={row.inScope ? 1 : CONTEXT_OPACITY} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Share of net sales" hint="selected period">
          <ResponsiveContainer width="100%" height={340}>
            <PieChart>
              <Pie data={shareData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={104} paddingAngle={2}>
                {shareData.map((slice) => (
                  <Cell key={slice.name} fill={slice.fill} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [`${kes(Number(value))} (${pct(p.kpi.sales ? (Number(value) / p.kpi.sales) * 100 : null)})`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {one ? (
        <Panel
          title="Single-principal trend"
          hint="sales bars, GP margin line"
          action={
            <select
              aria-label="Principal"
              value={one.p}
              onChange={(event) => setSelected(event.target.value)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
            >
              {selectable.map((principal) => (
                <option key={principal.p} value={principal.p}>
                  {principal.p}
                </option>
              ))}
            </select>
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={oneData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis yAxisId="sales" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
              <YAxis yAxisId="margin" orientation="right" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [name === "GP margin %" ? pct(Number(value), 2) : kes(Number(value)), String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="sales" dataKey="sales" name="Net sales" fill="#24754f" radius={[4, 4, 0, 0]}>
                {oneData.map((row) => (
                  <Cell key={row.month} fillOpacity={row.inScope ? 1 : CONTEXT_OPACITY} />
                ))}
              </Bar>
              <Line yAxisId="margin" type="monotone" dataKey="margin" name="GP margin %" stroke="#b2863f" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      ) : null}

      <Panel title="Principal by month" hint="net sales, KES M; the selected period is shaded; click a header to sort">
        <SortableTable columns={columns} rows={p.principals} rowKey={(row) => row.p} />
        {note ? <Note>{note}</Note> : null}
      </Panel>
    </section>
  );
}
