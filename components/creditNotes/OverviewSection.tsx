"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid } from "@/components/ui/KpiGrid";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { Growth, Note, Panel, Rich, SortableTable, compact, count, kes, monthShort, pct, type Column } from "@/components/performanceAnalysis/shared";
import { formatCompact, formatNumber } from "@/lib/format";
import type { CreditNotesPayload, CreditPrincipalRow } from "@/lib/creditNotes/types";
import type { CreditNotesTab } from "./CreditNotesView";

/** A rate above this share of invoicing is drawn in the warning colour. */
const HIGH_RATE_PCT = 5;

export function OverviewSection({ report, onOpen }: { report: CreditNotesPayload; onOpen: (tab: CreditNotesTab) => void }) {
  const { kpi } = report;
  const comparison = report.priorScope.length > 0 ? "vs the period before" : undefined;

  const trend = report.monthly.map((row) => ({
    name: `${monthShort(row.m)}${row.m.slice(2, 4) !== report.months[report.months.length - 1].slice(2, 4) ? ` ${row.m.slice(2, 4)}` : ""}`,
    Credit: Math.round(row.credit),
    Rate: row.cnPct === null ? null : Math.round(row.cnPct * 100) / 100,
    inScope: row.inScope,
  }));

  const principalColumns: Column<CreditPrincipalRow>[] = [
    { id: "principal", header: "Principal", align: "left", render: (row) => row.p, sortValue: (row) => row.p },
    { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
    { id: "share", header: "Share", render: (row) => pct(row.share), sortValue: (row) => row.share },
    { id: "rate", header: "% of invoiced", render: (row) => <span className={row.cnPct !== null && row.cnPct > HIGH_RATE_PCT ? "font-semibold text-red-600" : undefined}>{pct(row.cnPct)}</span>, sortValue: (row) => row.cnPct },
    { id: "change", header: "Change", render: (row) => <Growth value={row.changePct} />, sortValue: (row) => row.changePct },
  ];

  return (
    <section className="flex flex-col gap-4">
      <KpiGrid>
        <KpiCard
          accent="mission"
          label="Credit notes"
          value={kes(kpi.credit)}
          size="fit"
          sublabel={`${formatNumber(kpi.creditLines)} lines`}
          delta={kpi.creditChangePct !== null ? { value: kpi.creditChangePct, tier: kpi.creditChangePct > 0 ? "bad" : "good", caption: comparison } : undefined}
        />
        <KpiCard
          accent="revenue"
          label="% of invoiced"
          value={kpi.cnPct === null ? "–" : `${kpi.cnPct.toFixed(2)}%`}
          size="fit"
          sublabel={`of KES ${formatCompact(kpi.invoiced)} invoiced`}
          delta={kpi.cnPctChange !== null ? { value: kpi.cnPctChange, tier: kpi.cnPctChange > 0 ? "bad" : "good", caption: "pts " + (comparison ?? ""), format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}` } : undefined}
        />
        <KpiCard accent="coverage" label="Cases credited" value={formatNumber(Math.round(kpi.cases))} size="fit" sublabel="returned or credited back" />
        <KpiCard accent="quarter" label="Profit given up" value={kes(kpi.gpLost)} size="fit" sublabel="gross profit on credited lines" />
        <KpiCard accent="growth" label="Customers credited" value={formatNumber(kpi.customers)} size="fit" sublabel={kpi.avgPerCustomer !== null ? `avg KES ${formatCompact(kpi.avgPerCustomer)} each` : undefined} />
        <KpiCard accent="coverage" label="Items credited" value={formatNumber(kpi.items)} size="fit" sublabel={`${formatNumber(kpi.reps)} reps · ${formatNumber(kpi.principals)} principals`} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Credit notes by month" hint="bars: value · line: % of invoiced">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={formatCompact} axisLine={false} tickLine={false} width={52} />
              <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                formatter={(value, name) => (name === "Rate" ? [`${Number(value).toFixed(2)}% of invoiced`, "Rate"] : [`KES ${formatCompact(Number(value))}`, "Credit notes"])}
              />
              <Legend verticalAlign="top" align="right" height={24} wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="Credit" fill={CHART_COLORS[8]} radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="Rate" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          {report.monthly.some((row) => !row.inScope) ? <Note>Months before the selected period are shown for context; the totals above cover only the selected period.</Note> : null}
        </Panel>

        <Panel title="What stands out">
          <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-foreground">
            {report.insights.map((text, index) => (
              <li key={index} className="rounded-lg bg-background-elevated px-3 py-2">
                <Rich text={text} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="By principal"
          action={
            <button type="button" onClick={() => onOpen("principals")} className="text-xs font-semibold text-primary-blue hover:underline">
              Full list
            </button>
          }
        >
          <SortableTable columns={principalColumns} rows={report.principals.slice(0, 8)} rowKey={(row) => row.p} />
        </Panel>

        <Panel
          title="Largest customers"
          action={
            <button type="button" onClick={() => onOpen("customers")} className="text-xs font-semibold text-primary-blue hover:underline">
              Full list
            </button>
          }
        >
          <SortableTable
            columns={
              [
                { id: "customer", header: "Customer", align: "left", render: (row) => <span className="block max-w-[220px] truncate" title={row.name}>{row.name}</span>, sortValue: (row) => row.name },
                { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
                { id: "share", header: "Share", render: (row) => pct(row.share), sortValue: (row) => row.share },
                { id: "rate", header: "% of invoiced", render: (row) => pct(row.cnPct), sortValue: (row) => row.cnPct },
                { id: "items", header: "Items", render: (row) => count(row.items), sortValue: (row) => row.items },
              ] satisfies Column<CreditNotesPayload["customers"][number]>[]
            }
            rows={report.customers.slice(0, 8)}
            rowKey={(row) => row.code}
          />
        </Panel>
      </div>
    </section>
  );
}
