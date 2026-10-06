"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { principalLede, principalNote } from "@/lib/performanceAnalysis/narrative";
import type { PerformancePayload } from "@/lib/performanceAnalysis/types";
import { Growth, Note, OTHERS_COLOR, PALETTE, Panel, SectionHeading, SortableTable, compact, kes, millions, monthShort, pct, type Column } from "./shared";

const TOP_PRINCIPALS = 7;

export function monthLabels(p: PerformancePayload): string[] {
  return p.months.map((m, i) => (p.mtd && i === p.months.length - 1 ? `${monthShort(m)} MTD` : monthShort(m)));
}

export function PrincipalsSection({ p }: { p: PerformancePayload }) {
  const labels = useMemo(() => monthLabels(p), [p]);
  const top = p.principals.slice(0, TOP_PRINCIPALS);
  const rest = p.principals.slice(TOP_PRINCIPALS);
  const quarterText = p.labels.cq && p.labels.pq ? `${p.labels.cq} vs ${p.labels.pq}` : "Quarter";
  const monthText = p.labels.cm && p.labels.pm ? `${p.labels.cm} vs ${p.labels.pm}` : "Month";

  const stackData = useMemo(
    () =>
      p.months.map((_, i) => {
        const row: Record<string, string | number> = { month: labels[i] };
        for (const principal of top) row[principal.p] = principal.m[i];
        row.Others = rest.reduce((sum, principal) => sum + principal.m[i], 0);
        return row;
      }),
    [p, labels, top, rest]
  );
  const shareData = useMemo(() => {
    const slices = top.map((principal, index) => ({ name: principal.p, value: Math.max(principal.sales, 0), fill: PALETTE[index % PALETTE.length] }));
    const others = rest.reduce((sum, principal) => sum + Math.max(principal.sales, 0), 0);
    return others > 0 ? [...slices, { name: "Others", value: others, fill: OTHERS_COLOR }] : slices;
  }, [top, rest]);

  const selectable = p.principals.filter((principal) => principal.sales > 1e6);
  const [selected, setSelected] = useState<string>(selectable[0]?.p ?? "");
  const one = p.principals.find((principal) => principal.p === selected) ?? selectable[0];
  const oneData = one ? p.months.map((_, i) => ({ month: labels[i], sales: one.m[i], margin: one.m[i] ? Math.round((one.g[i] / one.m[i]) * 1000) / 10 : null })) : [];

  const full = p.mtd ? p.months.length - 1 : p.months.length;
  const peak = Math.max(1, ...p.principals.flatMap((principal) => principal.m.slice(0, full)));
  const columns: Column<PerformancePayload["principals"][number]>[] = [
    { id: "principal", header: "Principal", align: "left", render: (row) => row.p, sortValue: (row) => row.p },
    ...p.months.map((_, i) => ({
      id: `m${i}`,
      header: labels[i],
      render: (row: PerformancePayload["principals"][number]) => millions(row.m[i]),
      sortValue: (row: PerformancePayload["principals"][number]) => row.m[i],
      cellStyle: (row: PerformancePayload["principals"][number]) => ({ backgroundColor: `rgba(36,117,79,${Math.max(0, Math.min(0.4, (row.m[i] / peak) * 0.4)).toFixed(2)})` }),
    })),
    { id: "ytd", header: "YTD", render: (row) => millions(row.sales), sortValue: (row) => row.sales },
    { id: "share", header: "Share", render: (row) => pct(row.share), sortValue: (row) => row.share },
    { id: "qq", header: quarterText, render: (row) => <Growth value={row.cqGrowth} />, sortValue: (row) => row.cqGrowth },
    { id: "mm", header: monthText, render: (row) => <Growth value={row.cmGrowth} />, sortValue: (row) => row.cmGrowth },
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2), sortValue: (row) => row.gpm },
  ];

  const note = principalNote(p);
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="principals" title="1. Trended performance per principal" lede={principalLede(p)} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Net sales by principal, monthly" hint={`KES M${p.mtd ? "; latest month is month to date" : ""}`} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={stackData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [kes(Number(value)), String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
              {top.map((principal, index) => (
                <Bar key={principal.p} dataKey={principal.p} stackId="sales" fill={PALETTE[index % PALETTE.length]} />
              ))}
              <Bar dataKey="Others" stackId="sales" fill={OTHERS_COLOR} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="YTD share of net sales">
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
              <Bar yAxisId="sales" dataKey="sales" name="Net sales" fill="#24754f" radius={[4, 4, 0, 0]} />
              <Line yAxisId="margin" type="monotone" dataKey="margin" name="GP margin %" stroke="#b2863f" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      ) : null}

      <Panel title="Principal by month" hint="net sales, KES M; click a header to sort">
        <SortableTable columns={columns} rows={p.principals} rowKey={(row) => row.p} />
        {note ? <Note>{note}</Note> : null}
      </Panel>
    </section>
  );
}
