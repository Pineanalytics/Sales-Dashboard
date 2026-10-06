"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { customerLede, customerNote } from "@/lib/performanceAnalysis/narrative";
import type { AbcRow, CustomerRow, PerformancePayload } from "@/lib/performanceAnalysis/types";
import { monthLabels } from "./PrincipalsSection";
import { Growth, NameCell, Note, Panel, SectionHeading, Segmented, SortableTable, compact, count, kes, pct, type Column } from "./shared";

const ABC_LABELS: Record<AbcRow["cls"], string> = { A: "A · top 80% of sales", B: "B · next 15%", C: "C · last 5%" };

export function CustomersSection({ p }: { p: PerformancePayload }) {
  const [view, setView] = useState<"topTrade" | "topCustomers">("topTrade");
  const c = p.concentration;
  const comparison = p.labels.cq && p.labels.pq ? `${p.labels.cq} vs ${p.labels.pq}` : "Change";
  const labels = monthLabels(p);
  // Month-on-month movement starts at the second month and leaves out a month still in progress.
  const movement = p.movement.slice(1, p.mtd ? -1 : undefined);
  const moveData = movement.map((row, i) => ({ month: labels[i + 1], Retained: row.retained, Reactivated: row.reactivated, New: row.new, Lapsed: -row.lost }));

  const abcColumns: Column<AbcRow>[] = [
    { id: "cls", header: "Class", align: "left", render: (row) => ABC_LABELS[row.cls] },
    { id: "n", header: "Customers", render: (row) => count(row.n) },
    { id: "sales", header: "Net sales", render: (row) => kes(row.sales) },
    { id: "share", header: "Share", render: (row) => pct(row.share) },
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2) },
  ];
  const customerColumns: Column<CustomerRow>[] = [
    { id: "rank", header: "Rank", align: "left", render: (row) => row.rank, sortValue: (row) => row.rank },
    { id: "customer", header: "Customer", align: "left", render: (row) => <NameCell name={row.name} tag={row.internal ? "route/cash" : undefined} />, sortValue: (row) => row.name },
    { id: "sales", header: "Net sales", render: (row) => compact(row.sales), sortValue: (row) => row.sales },
    { id: "share", header: "Share", render: (row) => pct(row.share, 2), sortValue: (row) => row.share },
    { id: "cum", header: "Cum. share", render: (row) => pct(row.cum), sortValue: (row) => row.cum },
    { id: "gp", header: "GP", render: (row) => compact(row.gp), sortValue: (row) => row.gp },
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2), sortValue: (row) => row.gpm },
    { id: "qq", header: comparison, render: (row) => <Growth value={row.cqGrowth} />, sortValue: (row) => row.cqGrowth },
    { id: "months", header: "Months active", render: (row) => row.months, sortValue: (row) => row.months },
    { id: "skus", header: "SKUs", render: (row) => row.items, sortValue: (row) => row.items },
    { id: "princ", header: "Principals", render: (row) => row.princ, sortValue: (row) => row.princ },
    { id: "rep", header: "Main rep", align: "left", render: (row) => <NameCell name={row.rep} />, sortValue: (row) => row.rep },
  ];
  const note = customerNote(p);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="customers" title="4. Customer ranking and contribution" lede={customerLede(p)} />
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Concentration" hint="trade customers only" className="lg:col-span-5">
          <div className="mb-3 grid grid-cols-3 gap-2.5">
            {[
              { value: pct(c.tTop10), label: "Top 10 share" },
              { value: pct(c.tTop20), label: "Top 20 share" },
              { value: count(c.t80), label: "Customers = 80% of sales" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-md bg-background-elevated px-3 py-2.5">
                <b className="block text-xl text-foreground">{stat.value}</b>
                <span className="text-xs text-muted">{stat.label}</span>
              </div>
            ))}
          </div>
          {p.pareto.length > 0 ? (
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={p.pareto.map((point) => ({ share: `${point.x}%`, cumulative: point.y }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="share" stroke={CHART_AXIS_COLOR} fontSize={11} />
                <YAxis domain={[0, 100]} stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} labelFormatter={(label) => `Top ${label} of customers`} formatter={(value) => [`${value}% of trade sales`, "Cumulative share"]} />
                <Area type="monotone" dataKey="cumulative" stroke="#0b3d35" fill="#24754f" fillOpacity={0.18} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : null}
        </Panel>
        <Panel title="ABC segmentation" hint="trade customers" className="lg:col-span-7">
          <SortableTable columns={abcColumns} rows={p.abc} rowKey={(row) => row.cls} />
          <h3 className="mb-2 mt-5 text-sm font-semibold text-foreground">
            Customer movement <span className="ml-2 text-xs font-normal text-muted">trade customers buying each month</span>
          </h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={moveData} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [Math.abs(Number(value)), name === "Lapsed" ? "Lapsed (didn't buy vs prior month)" : String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Retained" stackId="m" fill="#24754f" />
              <Bar dataKey="Reactivated" stackId="m" fill="#4f86a6" />
              <Bar dataKey="New" stackId="m" fill="#b2863f" />
              <Bar dataKey="Lapsed" stackId="m" fill="#c16d4f" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel
        title="Customer ranking"
        action={
          <Segmented
            label="Customer set"
            value={view}
            onChange={setView}
            options={[
              { value: "topTrade", label: "Trade customers" },
              { value: "topCustomers", label: "All accounts" },
            ]}
          />
        }
      >
        <SortableTable columns={customerColumns} rows={p[view]} rowKey={(row) => row.code} />
        {note ? <Note>{note}</Note> : null}
      </Panel>
    </section>
  );
}
