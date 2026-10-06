"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { itemCaption, type ItemView } from "@/lib/performanceAnalysis/narrative";
import type { ItemRow, PerformancePayload } from "@/lib/performanceAnalysis/types";
import { Growth, NameCell, Panel, SectionHeading, SortableTable, Segmented, Spark, compact, count, kes, pct, type Column } from "./shared";

export function ItemsSection({ p }: { p: PerformancePayload }) {
  const [view, setView] = useState<ItemView>("top10");
  const rows = p[view];
  const full = p.mtd ? p.months.length - 1 : p.months.length;
  const comparison = p.labels.cq && p.labels.pq ? `${p.labels.cq} vs ${p.labels.pq}` : "Quarter";
  const valueOf = (row: ItemRow) => (view === "top10gp" || view === "belowCost" ? row.gp : view === "gainers" || view === "decliners" ? row.delta : row.sales);
  const chartTitle = { top10: "YTD net sales", top10gp: "YTD gross profit", gainers: `Change in sales, ${comparison}`, decliners: `Change in sales, ${comparison}`, belowCost: "YTD gross profit" }[view];
  const chartData = useMemo(() => rows.map((row) => ({ name: row.name.length > 30 ? `${row.name.slice(0, 29)}…` : row.name, full: row.name, value: valueOf(row) })), [rows, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<ItemRow & { rank: number }>[] = [
    { id: "rank", header: "#", align: "left", render: (row) => row.rank, sortValue: (row) => row.rank },
    { id: "item", header: "Item", align: "left", render: (row) => <NameCell name={row.name} />, sortValue: (row) => row.name },
    { id: "principal", header: "Principal", align: "left", render: (row) => row.p, sortValue: (row) => row.p },
    { id: "trend", header: "Trend", render: (row) => <Spark values={row.m.slice(0, full)} /> },
    { id: "sales", header: "Net sales", render: (row) => compact(row.sales), sortValue: (row) => row.sales },
    { id: "share", header: "Share", render: (row) => pct(row.share, 2), sortValue: (row) => row.share },
    { id: "cases", header: "Cases", render: (row) => count(row.cases), sortValue: (row) => row.cases },
    { id: "gp", header: "GP", render: (row) => compact(row.gp), sortValue: (row) => row.gp },
    { id: "gpm", header: "GP %", render: (row) => <span className={row.gpm !== null && row.gpm < 0 ? "text-red-600" : ""}>{pct(row.gpm, 2)}</span>, sortValue: (row) => row.gpm },
    { id: "qq", header: comparison, render: (row) => <Growth value={row.cqGrowth} />, sortValue: (row) => row.cqGrowth },
    { id: "accts", header: "Accts", render: (row) => count(row.cust), sortValue: (row) => row.cust },
  ];

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="items" title="3. Top 10 item performance" lede={itemCaption(p, view)} />
      <Segmented
        label="Item view"
        value={view}
        onChange={setView}
        options={[
          { value: "top10", label: "Top 10 by sales" },
          { value: "top10gp", label: "Top 10 by GP" },
          { value: "gainers", label: "Biggest gainers (qtr)" },
          { value: "decliners", label: "Biggest decliners (qtr)" },
          { value: "belowCost", label: "Margin leakers" },
        ]}
      />
      {rows.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-muted">{itemCaption(p, view)}</p>
        </Panel>
      ) : (
        <>
          <Panel title={chartTitle} hint="KES">
            <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 34 + 40)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
                <XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
                <YAxis type="category" dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} width={210} interval={0} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => [kes(Number(value)), chartTitle]} labelFormatter={(_, payload) => String(payload?.[0]?.payload?.full ?? "")} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {chartData.map((row) => (
                    <Cell key={row.full} fill={row.value < 0 ? "#c16d4f" : "#24754f"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Item detail" hint="trend line is the monthly sales of the full months">
            <SortableTable columns={columns} rows={rows.map((row, i) => ({ ...row, rank: i + 1 }))} rowKey={(row) => row.code} />
          </Panel>
        </>
      )}
    </section>
  );
}
