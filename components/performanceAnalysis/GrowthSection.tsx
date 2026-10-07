"use client";

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { GP_DEFINITION_NOTE, gpNote, growthLede } from "@/lib/performanceAnalysis/narrative";
import type { PerformancePayload, PrincipalRow } from "@/lib/performanceAnalysis/types";
import { monthLabels } from "./PrincipalsSection";
import { Growth, Note, PALETTE, Panel, SectionHeading, SortableTable, compact, count, kes, pct, type Column } from "./shared";

export function GrowthSection({ p }: { p: PerformancePayload }) {
  const labels = monthLabels(p);
  const last = p.months.length - 1;
  const monthlyData = p.monthly.map((row, i) => ({ month: labels[i], gp: row.gp, margin: row.gpm, partial: p.mtd && i === last, inScope: row.inScope }));
  // Principals worth plotting: at least 1% of the period's sales (a fixed KES cut-off would hide most of a single month).
  const material = (row: PrincipalRow) => p.kpi.sales > 0 && row.share >= 1;
  const bubbles = p.principals.filter((row) => material(row) && row.gpm !== null);
  const maxGp = Math.max(1, ...bubbles.map((row) => Math.max(row.gp, 0)));
  const bridge = p.bridge.filter((row) => Math.abs(row.ds) > 1e5).sort((a, b) => b.ds - a.ds);
  const marginPairs = p.principals.filter((row) => material(row) && row.cqGpm !== null && row.cqSales > 1e5);
  const hasQuarters = p.labels.cq !== null && p.labels.pq !== null;

  const comparisonIds = ["pq", "cq", "sg", "gg", "pqm", "cqm"];
  const allColumns: Column<PrincipalRow>[] = [
    { id: "principal", header: "Principal", align: "left", render: (row) => row.p, sortValue: (row) => row.p },
    { id: "sales", header: "Sales", render: (row) => compact(row.sales), sortValue: (row) => row.sales },
    { id: "gp", header: "GP", render: (row) => compact(row.gp), sortValue: (row) => row.gp },
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2), sortValue: (row) => row.gpm },
    { id: "gpshare", header: "Share of GP", render: (row) => pct(p.kpi.gp ? (row.gp / p.kpi.gp) * 100 : null), sortValue: (row) => row.gp },
    { id: "pq", header: `${p.labels.pq ?? "Prior"} sales`, render: (row) => compact(row.pqSales), sortValue: (row) => row.pqSales },
    { id: "cq", header: `${p.labels.cq ?? "Latest"} sales`, render: (row) => compact(row.cqSales), sortValue: (row) => row.cqSales },
    { id: "sg", header: "Sales growth", render: (row) => <Growth value={row.cqGrowth} />, sortValue: (row) => row.cqGrowth },
    { id: "gg", header: "GP growth", render: (row) => <Growth value={row.cqGpGrowth} />, sortValue: (row) => row.cqGpGrowth },
    { id: "pqm", header: `${p.labels.pq ?? "Prior"} GP %`, render: (row) => pct(row.pqGpm, 2), sortValue: (row) => row.pqGpm },
    { id: "cqm", header: `${p.labels.cq ?? "Latest"} GP %`, render: (row) => pct(row.cqGpm, 2), sortValue: (row) => row.cqGpm },
    { id: "skus", header: "SKUs", render: (row) => count(row.skus), sortValue: (row) => row.skus },
    { id: "cust", header: "Accts", render: (row) => count(row.cust), sortValue: (row) => row.cust },
  ];
  // Without a comparison window (a month in progress, or no earlier data) the comparison columns would only show zeros.
  const columns = allColumns.filter((column) => hasQuarters || !comparisonIds.includes(column.id));
  const note = gpNote(p);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="growth" title="5. Growth, gross profit and margin" lede={growthLede(p)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Monthly GP and GP margin">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis yAxisId="gp" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
              <YAxis yAxisId="margin" orientation="right" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [name === "GP margin %" ? pct(Number(value), 2) : kes(Number(value)), String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="gp" dataKey="gp" name="Gross profit" fill="#24754f" radius={[4, 4, 0, 0]}>
                {monthlyData.map((row) => (
                  <Cell key={row.month} fill={row.partial ? "#b2863f" : "#24754f"} fillOpacity={row.inScope ? 1 : 0.35} />
                ))}
              </Bar>
              <Line yAxisId="margin" type="monotone" dataKey="margin" name="GP margin %" stroke="#b2863f" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Sales vs margin by principal" hint="across: net sales (log scale); up: GP margin; bubble size = GP">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
              <XAxis type="number" dataKey="sales" name="Net sales" scale="log" domain={["auto", "auto"]} stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
              <YAxis type="number" dataKey="margin" name="GP margin" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <ZAxis type="number" dataKey="gp" range={[60, 900]} domain={[0, maxGp]} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} cursor={{ strokeDasharray: "3 3" }} formatter={(value, name) => [name === "GP margin" ? pct(Number(value), 2) : kes(Number(value)), String(name)]} labelFormatter={() => ""} />
              {bubbles.map((row, index) => (
                <Scatter key={row.p} name={row.p} data={[{ sales: row.sales, margin: row.gpm, gp: Math.max(row.gp, 0) }]} fill={PALETTE[index % PALETTE.length]} fillOpacity={0.75} />
              ))}
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ScatterChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="What moved sales and GP, latest quarter vs prior" hint="change in KES">
          {hasQuarters && bridge.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bridge.map((row) => ({ principal: row.p, Sales: row.ds, GP: row.dg }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="principal" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [kes(Number(value)), name === "Sales" ? "Δ Net sales" : "Δ Gross profit"]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Sales" name="Sales" fill="#24754f" radius={[3, 3, 0, 0]}>
                  {bridge.map((row) => (
                    <Cell key={row.p} fill={row.ds < 0 ? "#c16d4f" : "#24754f"} />
                  ))}
                </Bar>
                <Bar dataKey="GP" name="GP" fill="#b2863f" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-center text-sm text-muted">Needs two complete quarters to compare.</p>
          )}
        </Panel>
        <Panel title="GP margin, prior vs latest quarter" hint="principals with at least 1% of sales">
          {hasQuarters && marginPairs.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={marginPairs.map((row) => ({ principal: row.p, prior: row.pqGpm, latest: row.cqGpm }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="principal" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [pct(Number(value), 2), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="prior" name={`${p.labels.pq} GP %`} fill="#dfe9dd" stroke="#24754f" radius={[3, 3, 0, 0]} />
                <Bar dataKey="latest" name={`${p.labels.cq} GP %`} fill="#0b3d35" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-center text-sm text-muted">Needs two complete quarters to compare.</p>
          )}
        </Panel>
      </div>
      <Panel title="Growth and margin scorecard by principal">
        <SortableTable columns={columns} rows={p.principals.filter((row) => row.sales > 1e5)} rowKey={(row) => row.p} />
        {note ? <Note>{note}</Note> : null}
        <Note>{GP_DEFINITION_NOTE}</Note>
      </Panel>
    </section>
  );
}
