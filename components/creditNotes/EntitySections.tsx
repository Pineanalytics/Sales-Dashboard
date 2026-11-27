"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { Growth, Note, Panel, SectionHeading, SortableTable, Spark, compact, count, pct, type Column } from "@/components/performanceAnalysis/shared";
import { formatCompact } from "@/lib/format";
import type { CreditCustomerRow, CreditItemRow, CreditLineRow, CreditNotesPayload, CreditPrincipalRow, CreditRepRow, CreditWarehouseRow } from "@/lib/creditNotes/types";
import { totalFooter } from "./footers";
import type { CreditNotesTab } from "./CreditNotesView";

const HIGH_RATE_PCT = 5;

/** A name that narrows the whole module to it when clicked. */
function FilterLink({ text, filter, onFilter, sub }: { text: string; filter: string; onFilter: (value: string) => void; sub?: string }) {
  return (
    <button type="button" onClick={() => onFilter(filter)} title={`Filter everything to ${text}`} className="block max-w-[260px] text-left hover:text-primary-blue">
      <span className="block truncate font-medium">{text}</span>
      {sub ? <span className="block truncate text-[11px] text-muted">{sub}</span> : null}
    </button>
  );
}

const rate = (value: number | null): ReactNode => <span className={value !== null && value > HIGH_RATE_PCT ? "font-semibold text-red-600" : undefined}>{pct(value)}</span>;

/** A bar showing a row's share of the total credit notes, with the figure beside it. */
function ShareBar({ share }: { share: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-background-elevated" aria-hidden>
        <span className="block h-full rounded-full bg-[#c16d4f]" style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{pct(share)}</span>
    </span>
  );
}

export function EntitySections({ tab, report, onFilter }: { tab: Exclude<CreditNotesTab, "overview" | "reasons" | "distributors">; report: CreditNotesPayload; onFilter: (value: string) => void }) {
  const comparison = report.priorScope.length > 0 ? "Change" : "Change (n/a)";

  if (tab === "principals") {
    const columns: Column<CreditPrincipalRow>[] = [
      { id: "principal", header: "Principal", align: "left", render: (row) => <FilterLink text={row.p} filter={row.p} onFilter={onFilter} />, sortValue: (row) => row.p },
      { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
      { id: "share", header: "Share of credit", render: (row) => <ShareBar share={row.share} />, sortValue: (row) => row.share },
      { id: "invoiced", header: "Invoiced", render: (row) => compact(row.invoiced), sortValue: (row) => row.invoiced },
      { id: "rate", header: "% of invoiced", render: (row) => rate(row.cnPct), sortValue: (row) => row.cnPct },
      { id: "cases", header: "Cases", render: (row) => count(row.cases), sortValue: (row) => row.cases },
      { id: "customers", header: "Customers", render: (row) => count(row.customers), sortValue: (row) => row.customers },
      { id: "items", header: "Items", render: (row) => count(row.items), sortValue: (row) => row.items },
      { id: "change", header: comparison, render: (row) => <Growth value={row.changePct} />, sortValue: (row) => row.changePct },
      { id: "trend", header: "Trend", render: (row) => <Spark values={row.m} /> },
    ];
    const chart = report.principals.filter((row) => row.credit > 0).slice(0, 12).map((row) => ({ principal: row.p, credit: Math.round(row.credit), rate: row.cnPct }));
    return (
      <section className="flex flex-col gap-4">
        <SectionHeading id="principals" title="Credit notes by principal" lede="Which principals' sales come back as credit notes, and how heavily against what was invoiced. Click a name to filter the whole module to it." />
        {chart.length > 0 ? (
          <Panel title="Largest credit-note values" hint="colour marks a rate above 5% of invoicing">
            <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 28 + 40)}>
              <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
                <XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={formatCompact} />
                <YAxis type="category" dataKey="principal" stroke={CHART_AXIS_COLOR} fontSize={11} width={110} interval={0} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => [`KES ${formatCompact(Number(value))}`, "Credit notes"]} />
                <Bar dataKey="credit" radius={[0, 4, 4, 0]}>
                  {chart.map((row) => (
                    <Cell key={row.principal} fill={row.rate !== null && row.rate > HIGH_RATE_PCT ? CHART_COLORS[8] : CHART_COLORS[1]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        ) : null}
        <Panel title={`All principals (${report.principals.length})`}>
          <SortableTable columns={columns} rows={report.principals} rowKey={(row) => row.p} footer={totalFooter({ rows: report.principals, kpi: report.kpi, itemLabel: "principals" })} />
        </Panel>
      </section>
    );
  }

  if (tab === "items") {
    const columns: Column<CreditItemRow & { rank: number }>[] = [
      { id: "rank", header: "#", align: "left", render: (row) => row.rank, sortValue: (row) => row.rank },
      { id: "item", header: "Item", align: "left", render: (row) => <FilterLink text={row.name} sub={row.code} filter={row.code} onFilter={onFilter} />, sortValue: (row) => row.name },
      { id: "principal", header: "Principal", align: "left", render: (row) => row.p, sortValue: (row) => row.p },
      { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
      { id: "share", header: "Share of credit", render: (row) => <ShareBar share={row.share} />, sortValue: (row) => row.share },
      { id: "cases", header: "Cases", render: (row) => count(row.cases), sortValue: (row) => row.cases },
      { id: "invoiced", header: "Invoiced", render: (row) => compact(row.invoiced), sortValue: (row) => row.invoiced },
      { id: "rate", header: "% of invoiced", render: (row) => rate(row.cnPct), sortValue: (row) => row.cnPct },
      { id: "customers", header: "Customers", render: (row) => count(row.customers), sortValue: (row) => row.customers },
      { id: "change", header: comparison, render: (row) => <Growth value={row.changePct} />, sortValue: (row) => row.changePct },
    ];
    return (
      <section className="flex flex-col gap-4">
        <SectionHeading id="items" title="Credit notes by item" lede="The items customers send back or are credited for most. Click an item to see who it was credited to." />
        <Panel title={`Top ${report.items.length} of ${count(report.itemCount)} credited items`}>
          <SortableTable columns={columns} rows={report.items.map((row, i) => ({ ...row, rank: i + 1 }))} rowKey={(row) => row.code} maxHeight={640} footer={totalFooter({ rows: report.items, kpi: report.kpi, itemLabel: "items", listedOf: report.itemCount, labelColumn: "item" })} />
          {report.kpi.itemsCreditedAboveInvoiced > 0 ? (
            <Note>{count(report.kpi.itemsCreditedAboveInvoiced)} items were credited for more than was invoiced in this period; their rate shows above 100%. That usually means returns of sales from an earlier period.</Note>
          ) : null}
        </Panel>
      </section>
    );
  }

  if (tab === "customers") {
    const columns: Column<CreditCustomerRow>[] = [
      { id: "rank", header: "#", align: "left", render: (row) => row.rank, sortValue: (row) => row.rank },
      { id: "customer", header: "Customer", align: "left", render: (row) => <FilterLink text={row.name} sub={row.code} filter={row.code} onFilter={onFilter} />, sortValue: (row) => row.name },
      { id: "rep", header: "Main rep", align: "left", render: (row) => row.rep || "–", sortValue: (row) => row.rep },
      { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
      { id: "share", header: "Share of credit", render: (row) => <ShareBar share={row.share} />, sortValue: (row) => row.share },
      { id: "cum", header: "Cumulative", render: (row) => pct(row.cum, 0), sortValue: (row) => row.cum },
      { id: "invoiced", header: "Invoiced", render: (row) => compact(row.invoiced), sortValue: (row) => row.invoiced },
      { id: "rate", header: "% of invoiced", render: (row) => rate(row.cnPct), sortValue: (row) => row.cnPct },
      { id: "items", header: "Items", render: (row) => count(row.items), sortValue: (row) => row.items },
      { id: "change", header: comparison, render: (row) => <Growth value={row.changePct} />, sortValue: (row) => row.changePct },
    ];
    return (
      <section className="flex flex-col gap-4">
        <SectionHeading id="customers" title="Credit notes by customer" lede="Customers ranked by the credit notes they received, with the rate against what they were invoiced. Click a customer to filter the whole module to it." />
        <Panel title={`Top ${report.customers.length} of ${count(report.customerCount)} credited customers`} hint={report.kpi.top10CustomerShare !== null ? `the ten largest carry ${pct(report.kpi.top10CustomerShare, 0)}` : undefined}>
          <SortableTable columns={columns} rows={report.customers} rowKey={(row) => row.code} maxHeight={640} footer={totalFooter({ rows: report.customers, kpi: report.kpi, itemLabel: "customers", listedOf: report.customerCount, labelColumn: "customer" })} />
        </Panel>
      </section>
    );
  }

  if (tab === "reps") {
    const columns: Column<CreditRepRow & { rank: number }>[] = [
      { id: "rank", header: "#", align: "left", render: (row) => row.rank, sortValue: (row) => row.rank },
      { id: "rep", header: "Sales rep", align: "left", render: (row) => <FilterLink text={row.n} filter={row.n} onFilter={onFilter} />, sortValue: (row) => row.n },
      { id: "principal", header: "Main principal", align: "left", render: (row) => row.principal || "–", sortValue: (row) => row.principal },
      { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
      { id: "share", header: "Share of credit", render: (row) => <ShareBar share={row.share} />, sortValue: (row) => row.share },
      { id: "invoiced", header: "Invoiced", render: (row) => compact(row.invoiced), sortValue: (row) => row.invoiced },
      { id: "rate", header: "% of invoiced", render: (row) => rate(row.cnPct), sortValue: (row) => row.cnPct },
      { id: "customers", header: "Customers", render: (row) => count(row.customers), sortValue: (row) => row.customers },
      { id: "items", header: "Items", render: (row) => count(row.items), sortValue: (row) => row.items },
      { id: "change", header: comparison, render: (row) => <Growth value={row.changePct} />, sortValue: (row) => row.changePct },
    ];
    return (
      <section className="flex flex-col gap-4">
        <SectionHeading id="reps" title="Credit notes by sales rep" lede="The SAP sales employee on each credit note. A high rate on a rep with real volume is the one to look into; very small accounts can swing widely." />
        <Panel title={`All sales reps (${report.reps.length})`}>
          <SortableTable columns={columns} rows={report.reps.map((row, i) => ({ ...row, rank: i + 1 }))} rowKey={(row) => row.n} maxHeight={640} footer={totalFooter({ rows: report.reps, kpi: report.kpi, itemLabel: "reps", labelColumn: "rep" })} />
        </Panel>
      </section>
    );
  }

  if (tab === "branches") {
    const columns: Column<CreditWarehouseRow>[] = [
      { id: "branch", header: "Warehouse / branch", align: "left", render: (row) => <FilterLink text={row.n} filter={row.n} onFilter={onFilter} />, sortValue: (row) => row.n },
      { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
      { id: "share", header: "Share of credit", render: (row) => <ShareBar share={row.share} />, sortValue: (row) => row.share },
      { id: "invoiced", header: "Invoiced", render: (row) => compact(row.invoiced), sortValue: (row) => row.invoiced },
      { id: "rate", header: "% of invoiced", render: (row) => rate(row.cnPct), sortValue: (row) => row.cnPct },
      { id: "cases", header: "Cases", render: (row) => count(row.cases), sortValue: (row) => row.cases },
      { id: "customers", header: "Customers", render: (row) => count(row.customers), sortValue: (row) => row.customers },
    ];
    return (
      <section className="flex flex-col gap-4">
        <SectionHeading id="branches" title="Credit notes by warehouse and van" lede="Where the credited stock was booked from." />
        <Panel title={`All warehouses (${report.warehouses.length})`}>
          <SortableTable columns={columns} rows={report.warehouses} rowKey={(row) => row.n} footer={totalFooter({ rows: report.warehouses, kpi: report.kpi, itemLabel: "warehouses" })} />
        </Panel>
      </section>
    );
  }

  const columns: Column<CreditLineRow & { key: string }>[] = [
    { id: "month", header: "Month", align: "left", render: (row) => row.month, sortValue: (row) => row.month },
    { id: "customer", header: "Customer", align: "left", render: (row) => <FilterLink text={row.customerName} sub={row.customerCode} filter={row.customerCode} onFilter={onFilter} />, sortValue: (row) => row.customerName },
    { id: "item", header: "Item", align: "left", render: (row) => <FilterLink text={row.itemName} sub={row.itemCode} filter={row.itemCode} onFilter={onFilter} />, sortValue: (row) => row.itemName },
    { id: "principal", header: "Principal", align: "left", render: (row) => row.principal, sortValue: (row) => row.principal },
    { id: "rep", header: "Rep", align: "left", render: (row) => row.rep, sortValue: (row) => row.rep },
    { id: "branch", header: "Branch", align: "left", render: (row) => row.warehouse, sortValue: (row) => row.warehouse },
    { id: "cases", header: "Cases", render: (row) => count(row.cases), sortValue: (row) => row.cases },
    { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
    { id: "gp", header: "Profit given up", render: (row) => compact(row.gpLost), sortValue: (row) => row.gpLost },
  ];
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="lines" title="Largest credit-note lines" lede="The biggest single credit lines of the period (a line is one customer, item, branch and rep in a month). The Excel export carries more." />
      <Panel title={`Top ${report.topLines.length} lines`}>
        <SortableTable columns={columns} rows={report.topLines.map((row, i) => ({ ...row, key: `${row.month}|${row.customerCode}|${row.itemCode}|${row.warehouse}|${row.rep}|${i}` }))} rowKey={(row) => row.key} maxHeight={640} footer={totalFooter({ rows: report.topLines.map((row) => ({ ...row, invoiced: 0 })), kpi: report.kpi, itemLabel: "lines", listedOf: report.kpi.creditLines })} />
      </Panel>
    </section>
  );
}
