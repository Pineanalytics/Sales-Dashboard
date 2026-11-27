"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid } from "@/components/ui/KpiGrid";
import { Note, Panel, SectionHeading, SortableTable, compact, count, kes, monthShort, pct, type Column } from "@/components/performanceAnalysis/shared";
import { formatCompact, formatNumber } from "@/lib/format";
import { hasTypedReason, reasonLabel, type ReasonDocument, type ReasonGroupRow, type ReasonId, type ReasonReport, type ReasonSummaryRow } from "@/lib/creditNotes/reasons";
import type { ReasonResult } from "@/lib/creditNotes/reasonsStore";

/** Reason columns shown in the principal and month tables; the rest are added into one. */
const MATRIX_REASONS = 6;
/** A share of credit without a reason above this is drawn in the warning colour. */
const LOW_TYPED_PCT = 50;

interface LoadState {
  key: string;
  result?: ReasonResult;
  error?: string;
}

/** The "Reasons" tab: reads the same period, principal and search filter as the rest of the module. */
export function ReasonsSection({ query }: { query: string }) {
  const [state, setState] = useState<LoadState>({ key: "" });

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    fetch(`/api/credit-notes/reasons?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
        return (await res.json()) as ReasonResult;
      })
      .then((result) => setState({ key: query, result }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ key: query, error: error instanceof Error ? error.message : "The reasons could not be loaded." });
      });
    return () => controller.abort();
  }, [query]);

  const loading = query !== "" && state.key !== query;
  if (state.error && !loading) {
    return (
      <Panel>
        <p className="py-6 text-center text-sm text-red-600">{state.error}</p>
      </Panel>
    );
  }
  if (!state.result) {
    return (
      <Panel>
        <p className="py-10 text-center text-sm text-muted">Loading the reasons…</p>
      </Panel>
    );
  }
  const { report, missingMonths, dataAsOf } = state.result;
  return (
    <div className={`flex flex-col gap-4 transition-opacity ${loading ? "pointer-events-none opacity-50" : ""}`} aria-busy={loading}>
      {missingMonths.length > 0 ? <Note>Reasons are not stored for {missingMonths.join(", ")}; those months are left out of this tab.</Note> : null}
      {report ? (
        <ReasonsReportView report={report} />
      ) : (
        <Panel>
          <p className="py-10 text-center text-sm text-muted">No credit notes with stored remarks match this period, principal selection and search.</p>
        </Panel>
      )}
      <footer className="border-t border-border pt-4 text-[13px] text-muted">
        Source: the Remarks typed on each SAP credit note, sorted into groups by the words used (spelling mistakes included). Text SAP or a linked system adds by itself is ignored. SAP&apos;s own return-reason
        field is blank on the documents, so it is not used. Values are excl. VAT. Sales return documents that have no credit note are not counted.
        {dataAsOf ? ` SAP read as of ${dataAsOf.slice(0, 10)}.` : ""}
      </footer>
    </div>
  );
}

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const typedCell = (value: number) => <span className={value < LOW_TYPED_PCT ? "font-semibold text-red-600" : undefined}>{pct(value)}</span>;
const name = (text: string, sub?: string) => (
  <span className="block max-w-[260px] truncate" title={text}>
    {text}
    {sub ? <span className="block truncate text-[11px] text-muted">{sub}</span> : null}
  </span>
);

export function ReasonsReportView({ report }: { report: ReasonReport }) {
  const [selected, setSelected] = useState<ReasonId | null>(null);
  const { total, typed, untyped, system } = report;
  const typedReasons = report.reasons.filter((row) => hasTypedReason(row.id));
  const matrix = typedReasons.slice(0, MATRIX_REASONS).map((row) => row.id);
  const shown = selected && report.reasons.some((row) => row.id === selected) ? selected : null;
  const documents = (shown ? report.documents.filter((row) => row.reasonId === shown) : report.documents).slice(0, 40);
  const chart = typedReasons.slice(0, 12).map((row) => ({ reason: row.label, id: row.id, credit: Math.round(row.credit) }));

  const reasonColumns: Column<ReasonSummaryRow>[] = [
    {
      id: "reason",
      header: "Reason",
      align: "left",
      render: (row) => (
        <button type="button" onClick={() => setSelected(row.id)} aria-pressed={shown === row.id} className={`text-left font-medium hover:text-primary-blue ${shown === row.id ? "text-primary-blue underline" : ""}`}>
          {row.label}
        </button>
      ),
      sortValue: (row) => row.label,
    },
    { id: "credit", header: "Credit notes (KES)", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
    { id: "share", header: "Share of value", render: (row) => pct(row.share), sortValue: (row) => row.share },
    { id: "documents", header: "Number", render: (row) => count(row.documents), sortValue: (row) => row.documents },
    { id: "customers", header: "Customers", render: (row) => count(row.customers), sortValue: (row) => row.customers },
    { id: "principal", header: "Largest principal", align: "left", render: (row) => row.topPrincipal, sortValue: (row) => row.topPrincipal },
  ];

  const matrixColumns: Column<ReasonGroupRow>[] = [
    { id: "principal", header: "Principal", align: "left", render: (row) => row.name, sortValue: (row) => row.name },
    { id: "credit", header: "Credit notes", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
    { id: "typed", header: "With a reason", render: (row) => typedCell(row.typedShare), sortValue: (row) => row.typedShare },
    ...matrix.map((id): Column<ReasonGroupRow> => ({ id, header: reasonLabel(id), render: (row) => (row.byReason[id] ? compact(row.byReason[id]) : "–"), sortValue: (row) => row.byReason[id] ?? 0 })),
    {
      id: "rest",
      header: "Other reasons",
      render: (row) => compact(row.credit - row.untypedCredit - matrix.reduce((sum, id) => sum + (row.byReason[id] ?? 0), 0)),
      sortValue: (row) => row.credit - row.untypedCredit - matrix.reduce((sum, id) => sum + (row.byReason[id] ?? 0), 0),
    },
    { id: "untyped", header: "No reason", render: (row) => compact(row.untypedCredit), sortValue: (row) => row.untypedCredit },
  ];

  const monthRows = report.months.map((month, index) => {
    const value = (rows: ReasonSummaryRow[]) => rows.reduce((sum, row) => sum + row.m[index], 0);
    const all = value(report.reasons);
    return { month, all, typedShare: share(value(typedReasons), all), byReason: new Map(report.reasons.map((row) => [row.id, row.m[index]])) };
  });
  const monthColumns: Column<(typeof monthRows)[number]>[] = [
    { id: "month", header: "Month", align: "left", render: (row) => `${monthShort(row.month)} ${row.month.slice(0, 4)}`, sortValue: (row) => row.month },
    { id: "credit", header: "Credit notes", render: (row) => compact(row.all), sortValue: (row) => row.all },
    { id: "typed", header: "With a reason", render: (row) => typedCell(row.typedShare), sortValue: (row) => row.typedShare },
    ...matrix.map((id): Column<(typeof monthRows)[number]> => ({ id, header: reasonLabel(id), render: (row) => compact(row.byReason.get(id) ?? 0), sortValue: (row) => row.byReason.get(id) ?? 0 })),
  ];

  const personColumns = (label: string): Column<ReasonGroupRow>[] => [
    { id: "name", header: label, align: "left", render: (row) => name(row.name), sortValue: (row) => row.name },
    { id: "documents", header: "Credit notes", render: (row) => count(row.documents), sortValue: (row) => row.documents },
    { id: "credit", header: "Value", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
    { id: "untypedDocuments", header: "Without a reason", render: (row) => count(row.untypedDocuments), sortValue: (row) => row.untypedDocuments },
    { id: "untypedCredit", header: "Value without", render: (row) => compact(row.untypedCredit), sortValue: (row) => row.untypedCredit },
    { id: "typed", header: "Value with a reason", render: (row) => typedCell(row.typedShare), sortValue: (row) => row.typedShare },
    { id: "top", header: "Main reason", align: "left", render: (row) => row.topReason || "–", sortValue: (row) => row.topReason },
  ];

  const customerColumns: Column<ReasonGroupRow>[] = [
    { id: "customer", header: "Customer", align: "left", render: (row) => name(row.name, row.code), sortValue: (row) => row.name },
    ...personColumns("Customer").slice(1),
  ];

  const documentColumns: Column<ReasonDocument>[] = [
    { id: "doc", header: "Credit note", align: "left", render: (row) => row.docNum, sortValue: (row) => row.docNum },
    { id: "date", header: "Date", align: "left", render: (row) => row.date, sortValue: (row) => row.date },
    { id: "customer", header: "Customer", align: "left", render: (row) => name(row.customerName, row.customerCode), sortValue: (row) => row.customerName },
    { id: "principal", header: "Principal", align: "left", render: (row) => row.principal, sortValue: (row) => row.principal },
    { id: "credit", header: "Value", render: (row) => compact(row.credit), sortValue: (row) => row.credit },
    { id: "reason", header: "Reason", align: "left", render: (row) => row.reason, sortValue: (row) => row.reason },
    { id: "remark", header: "As typed in SAP", align: "left", render: (row) => (row.remark ? name(row.remark) : "–"), sortValue: (row) => row.remark },
    { id: "rep", header: "Sales rep", align: "left", render: (row) => row.rep, sortValue: (row) => row.rep },
    { id: "by", header: "Entered by", align: "left", render: (row) => row.enteredBy, sortValue: (row) => row.enteredBy },
  ];

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading id="reasons" title="Why credit notes were issued" lede="The reason typed on each credit note, grouped. Click a reason to list its largest credit notes." />
      <KpiGrid>
        <KpiCard accent="mission" label="Credit notes" value={kes(total.credit)} size="fit" sublabel={`${formatNumber(total.documents)} credit notes`} />
        <KpiCard accent="revenue" label="With a reason" value={pct(share(typed.credit, total.credit))} size="fit" sublabel={`${kes(typed.credit)} · ${formatNumber(typed.documents)} credit notes`} />
        <KpiCard accent="quarter" label="No reason typed" value={kes(untyped.credit - system.credit)} size="fit" sublabel={`${formatNumber(untyped.documents - system.documents)} entered in SAP`} />
        <KpiCard accent="coverage" label="Posted by DMS or SFA" value={kes(system.credit)} size="fit" sublabel={`${formatNumber(system.documents)} with only a system reference`} />
      </KpiGrid>

      {chart.length > 0 ? (
        <Panel title="Largest typed reasons" hint="by value; credit notes without a reason are not drawn">
          <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 28 + 40)}>
            <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
              <XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={formatCompact} />
              <YAxis type="category" dataKey="reason" stroke={CHART_AXIS_COLOR} fontSize={11} width={230} interval={0} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => [`KES ${formatCompact(Number(value))}`, "Credit notes"]} />
              <Bar dataKey="credit" radius={[0, 4, 4, 0]} onClick={(_, index) => setSelected(chart[index]?.id ?? null)}>
                {chart.map((row) => (
                  <Cell key={row.id} fill={shown === row.id ? CHART_COLORS[8] : CHART_COLORS[1]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      ) : null}

      <Panel title="All reasons">
        <SortableTable columns={reasonColumns} rows={report.reasons} rowKey={(row) => row.id} footer={[{ label: "Total", cells: { credit: compact(total.credit), share: pct(100), documents: count(total.documents) } }]} />
      </Panel>

      <Panel
        title={shown ? `Largest credit notes: ${reasonLabel(shown)}` : "Largest credit notes"}
        hint={`${formatNumber(documents.length)} shown; the Excel export has every one`}
        action={
          shown ? (
            <button type="button" onClick={() => setSelected(null)} className="text-xs font-semibold text-primary-blue hover:underline">
              Show all reasons
            </button>
          ) : undefined
        }
      >
        <SortableTable columns={documentColumns} rows={documents} rowKey={(row) => `${row.docNum}-${row.date}-${row.customerCode}`} maxHeight={460} />
      </Panel>

      <Panel title="Reasons by principal" hint="value, KES">
        <SortableTable columns={matrixColumns} rows={report.principals} rowKey={(row) => row.name} />
      </Panel>

      <Panel title="Reasons by month" hint="value, KES">
        <SortableTable columns={monthColumns} rows={monthRows} rowKey={(row) => row.month} />
      </Panel>

      <Panel title="Who entered them" hint="the SAP user on each credit note">
        <SortableTable columns={personColumns("Entered by")} rows={report.enteredBy} rowKey={(row) => row.name} maxHeight={420} />
      </Panel>

      <Panel title="By sales rep">
        <SortableTable columns={personColumns("Sales rep")} rows={report.reps} rowKey={(row) => row.name} maxHeight={420} />
      </Panel>

      <Panel title="Largest customers" hint={`${formatNumber(report.customers.length)} of ${formatNumber(report.customerCount)} shown`}>
        <SortableTable columns={customerColumns} rows={report.customers} rowKey={(row) => row.code ?? row.name} maxHeight={460} />
      </Panel>
    </section>
  );
}
