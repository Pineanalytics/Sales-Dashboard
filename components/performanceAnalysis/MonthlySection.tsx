"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { monthlyLede, monthlyNote } from "@/lib/performanceAnalysis/narrative";
import type { MonthlyRow, PerformancePayload } from "@/lib/performanceAnalysis/types";
import { monthLabels } from "./PrincipalsSection";
import { Growth, Note, Panel, SectionHeading, SortableTable, compact, count, kes, pct, type Column } from "./shared";

export function MonthlySection({ p }: { p: PerformancePayload }) {
  const labels = useMemo(() => monthLabels(p), [p]);
  const last = p.months.length - 1;
  const salesData = p.monthly.map((row, i) => ({ month: labels[i], sales: row.sales, mom: row.mom, partial: p.mtd && i === last }));
  const full = p.mtd ? p.monthly.slice(0, -1) : p.monthly;
  const fullLabels = labels.slice(0, full.length);
  const custData = full.map((row, i) => ({ month: fullLabels[i], accounts: row.cust, average: row.dropSize }));
  const minAccounts = custData.length > 0 ? Math.floor((Math.min(...custData.map((d) => d.accounts)) * 0.9) / 50) * 50 : 0;

  const columns: Column<MonthlyRow & { label: string }>[] = [
    { id: "month", header: "Month", align: "left", render: (row) => row.label, sortValue: (row) => row.m },
    { id: "sales", header: "Net sales", render: (row) => kes(row.sales), sortValue: (row) => row.sales },
    { id: "mom", header: "MoM", render: (row) => <Growth value={row.mom} />, sortValue: (row) => row.mom },
    { id: "gp", header: "Gross profit", render: (row) => kes(row.gp), sortValue: (row) => row.gp },
    { id: "gpmom", header: "GP MoM", render: (row) => <Growth value={row.gpMom} />, sortValue: (row) => row.gpMom },
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2), sortValue: (row) => row.gpm },
    { id: "cases", header: "Cases", render: (row) => count(row.cases), sortValue: (row) => row.cases },
    { id: "cust", header: "Active accts", render: (row) => count(row.cust), sortValue: (row) => row.cust },
    { id: "sku", header: "SKUs sold", render: (row) => count(row.sku), sortValue: (row) => row.sku },
    { id: "drop", header: "Sale / acct", render: (row) => compact(row.dropSize), sortValue: (row) => row.dropSize },
    { id: "cn", header: "Credit notes", render: (row) => compact(-row.cn), sortValue: (row) => -row.cn },
    { id: "cnpct", header: "CN % gross", render: (row) => pct(row.cnPct), sortValue: (row) => row.cnPct },
    { id: "trade", header: "Trade share", render: (row) => pct(row.sales ? (row.trade / row.sales) * 100 : null), sortValue: (row) => (row.sales ? row.trade / row.sales : null) },
  ];
  const note = monthlyNote(p);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="monthly" title="2. Month-on-month performance" lede={monthlyLede(p)} />
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Net sales and MoM growth" className="lg:col-span-7">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={salesData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis yAxisId="sales" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
              <YAxis yAxisId="mom" orientation="right" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [name === "MoM %" ? pct(Number(value)) : kes(Number(value)), String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="sales" dataKey="sales" name="Net sales" fill="#24754f" radius={[4, 4, 0, 0]}>
                {salesData.map((row) => (
                  <Cell key={row.month} fill={row.partial ? "#b8c9b4" : "#24754f"} />
                ))}
              </Bar>
              <Line yAxisId="mom" type="monotone" dataKey="mom" name="MoM %" stroke="#b2863f" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Active customers and average sale per customer" className="lg:col-span-5">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={custData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis yAxisId="accounts" stroke={CHART_AXIS_COLOR} fontSize={11} domain={[minAccounts, "auto"]} />
              <YAxis yAxisId="average" orientation="right" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => compact(Number(v))} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, name) => [name === "Avg sale per account" ? kes(Number(value)) : count(Number(value)), String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="accounts" dataKey="accounts" name="Active accounts" fill="#dfe9dd" stroke="#24754f" radius={[4, 4, 0, 0]} />
              <Line yAxisId="average" type="monotone" dataKey="average" name="Avg sale per account" stroke="#0b3d35" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel title="Monthly scorecard" hint="click a header to sort">
        <SortableTable columns={columns} rows={p.monthly.map((row, i) => ({ ...row, label: labels[i] }))} rowKey={(row) => row.m} />
        {note ? <Note>{note}</Note> : null}
      </Panel>
    </section>
  );
}
