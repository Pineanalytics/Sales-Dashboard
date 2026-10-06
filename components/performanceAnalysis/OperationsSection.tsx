"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { operationsLede, repsNote, returnsNote } from "@/lib/performanceAnalysis/narrative";
import type { PerformancePayload, RepRow, WarehouseRow } from "@/lib/performanceAnalysis/types";
import { Growth, NameCell, Note, Panel, SectionHeading, SortableTable, compact, count, pct, type Column } from "./shared";

export function OperationsSection({ p }: { p: PerformancePayload }) {
  const comparison = p.labels.cq && p.labels.pq ? `${p.labels.cq} vs ${p.labels.pq}` : "Quarter";
  const returns = p.principals.filter((row) => row.sales > 2e7 && row.cnPct !== null).sort((a, b) => (b.cnPct as number) - (a.cnPct as number));

  const warehouseColumns: Column<WarehouseRow>[] = [
    { id: "warehouse", header: "Warehouse / van", align: "left", render: (row) => <NameCell name={row.n} />, sortValue: (row) => row.n },
    { id: "sales", header: "Net sales", render: (row) => compact(row.sales), sortValue: (row) => row.sales },
    { id: "share", header: "Share", render: (row) => pct(row.share), sortValue: (row) => row.share },
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2), sortValue: (row) => row.gpm },
    { id: "cust", header: "Accts", render: (row) => count(row.cust), sortValue: (row) => row.cust },
    { id: "qq", header: comparison, render: (row) => <Growth value={row.cqGrowth} />, sortValue: (row) => row.cqGrowth },
  ];
  const repColumns: Column<RepRow & { rank: number }>[] = [
    { id: "rank", header: "#", align: "left", render: (row) => row.rank, sortValue: (row) => row.rank },
    { id: "rep", header: "Sales employee", align: "left", render: (row) => <NameCell name={row.n} />, sortValue: (row) => row.n },
    { id: "princ", header: "Main principals", align: "left", render: (row) => row.princ, sortValue: (row) => row.princ },
    { id: "sales", header: "Net sales", render: (row) => compact(row.sales), sortValue: (row) => row.sales },
    { id: "share", header: "Share", render: (row) => pct(row.share), sortValue: (row) => row.share },
    { id: "gp", header: "GP", render: (row) => compact(row.gp), sortValue: (row) => row.gp },
    { id: "gpm", header: "GP %", render: (row) => pct(row.gpm, 2), sortValue: (row) => row.gpm },
    { id: "cust", header: "Accts", render: (row) => count(row.cust), sortValue: (row) => row.cust },
    { id: "qq", header: comparison, render: (row) => <Growth value={row.cqGrowth} />, sortValue: (row) => row.cqGrowth },
  ];
  const note = returnsNote(p);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="operations" title="6. Branches, sales reps and returns" lede={operationsLede(p)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top 15 warehouses and vans">
          <SortableTable columns={warehouseColumns} rows={p.warehouses} rowKey={(row) => row.n} />
        </Panel>
        <Panel title="Credit notes as % of gross invoicing" hint="principals over KES 20M">
          {returns.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(260, returns.length * 30 + 40)}>
              <BarChart data={returns.map((row) => ({ principal: row.p, rate: row.cnPct }))} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
                <XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="principal" stroke={CHART_AXIS_COLOR} fontSize={11} width={90} interval={0} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => [`${pct(Number(value))} of gross invoicing`, "Credit notes"]} />
                <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                  {returns.map((row) => (
                    <Cell key={row.p} fill={(row.cnPct as number) > 15 ? "#c16d4f" : "#24754f"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-center text-sm text-muted">No principal is large enough to show a return rate yet.</p>
          )}
          {note ? <Note>{note}</Note> : null}
        </Panel>
      </div>
      <Panel title="Top 20 sales employees / route accounts">
        <SortableTable columns={repColumns} rows={p.reps.map((row, i) => ({ ...row, rank: i + 1 }))} rowKey={(row) => row.n} />
        <Note>{repsNote}</Note>
      </Panel>
    </section>
  );
}
