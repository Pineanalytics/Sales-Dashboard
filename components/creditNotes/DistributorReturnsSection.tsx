"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { Panel } from "@/components/performanceAnalysis/shared";
import { formatCompact, formatNumber, type Tier } from "@/lib/format";

// The distributors' own DMS (Centegy, Nairobi and Nyeri) records invoices and credit notes in its own
// document types, separate from SAP. This tab keeps that feed: it follows the dashboard's period but has no
// principal split (the DMS lines carry a SKU, not a principal), so the principal filter does not apply here.

interface Summary {
  salesNet: number;
  returnsGross: number;
  returnsNet: number;
  returnsQtyPieces: number;
  netAfterReturns: number;
  totalDiscount: number;
  invoiceLineCount: number;
  returnLineCount: number;
  salesQtyPieces: number;
  freeQtyPieces: number;
  salesGross: number;
}

interface RepRow {
  salesRepCode: string;
  salesRepName: string;
  sales: number;
  returns: number;
  net: number;
  lineCount: number;
}

interface LineRow {
  id: string;
  invoiceNo: string;
  deliveryDate: string;
  documentType: string;
  documentTypeDesc: string;
  customerCode: string;
  salesRepCode: string;
  salesRepName: string;
  sku: string;
  skuDesc: string;
  saleQtyPieces: number;
  netSale: number;
}

interface Response {
  summary: Summary;
  trend: { date: string; sales: number; returns: number }[];
  byRep: RepRow[];
  availableDocumentTypes: { documentType: string; documentTypeDesc: string }[];
  rows: LineRow[];
  pagination: { page: number; pageSize: number; total: number };
}

const DOC_TYPE_TIER: Record<string, Tier> = { "01": "good", "06": "good", "18": "bad", "19": "bad" };

const label = (date: string) => new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The calendar range the period's months cover, capped at today. */
function rangeOf(months: string[]): { from: string; to: string } | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const lastDay = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const from = `${first}-01`;
  if (from > today) return null;
  return { from, to: lastDay < today ? lastDay : today };
}

export function DistributorReturnsSection({ months }: { months: string[] }) {
  const [loaded, setLoaded] = useState<{ key: string; body?: Response; failed?: boolean }>({ key: "" });
  const [search, setSearch] = useState("");
  const [documentType, setDocumentType] = useState("");
  // The page number belongs to one period; a different period starts again at page 1.
  const [pageState, setPageState] = useState({ rangeKey: "", page: 1 });
  const range = useMemo(() => rangeOf(months), [months]);
  const rangeKey = range ? `${range.from}|${range.to}` : "";
  const page = pageState.rangeKey === rangeKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ rangeKey, page: next });
  const requestKey = `${rangeKey}|${search.trim()}|${documentType}|${page}`;

  useEffect(() => {
    if (!rangeKey) return;
    const [from, to] = rangeKey.split("|");
    let cancelled = false;
    const params = new URLSearchParams({ from, to, page: String(page) });
    if (search.trim()) params.set("search", search.trim());
    if (documentType) params.set("documentType", documentType);
    (async () => {
      try {
        const res = await fetch(`/api/sales-returns?${params.toString()}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load the distributor returns.");
        if (!cancelled) setLoaded({ key: requestKey, body });
      } catch {
        if (!cancelled) setLoaded((previous) => ({ key: requestKey, body: previous.body, failed: true }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeKey, search, documentType, page, requestKey]);

  const data = loaded.body ?? null;
  const loading = rangeKey !== "" && loaded.key !== requestKey;
  const error = Boolean(loaded.failed) && !loading;

  if (!range) return <EmptyState title="No distributor returns yet" description="The selected period starts in the future." />;
  if (error && !data) return <EmptyState title="Couldn't load the distributor returns" description="Try refreshing the page. If it keeps happening, the sales-returns:sync job may be behind schedule." />;
  if (!data) return <Panel><p className="py-10 text-center text-sm text-muted">Loading the distributor returns…</p></Panel>;

  const { summary } = data;
  const returnRate = summary.salesNet > 0 ? (summary.returnsNet / summary.salesNet) * 100 : null;
  const totalPages = Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize));
  const trend = data.trend.map((t) => ({ name: label(t.date), Sales: Math.round(t.sales), Returns: Math.round(t.returns) }));
  const field = "rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs font-semibold text-muted-strong outline-none";

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
      <p className="text-xs text-muted">
        The distributors&apos; own DMS records (Nairobi and Nyeri), {label(range.from)} – {label(range.to)}. It follows the period above but has no principal split, so the principal filter does not apply here.
      </p>
      <SectionCard title="Distributor credit notes">
        <KpiGrid>
          <KpiCard accent="mission" label="Returns" value={formatCompact(summary.returnsNet)} sublabel={`${formatNumber(summary.returnLineCount)} lines`} />
          <KpiCard accent="revenue" label="% of net sales" value={returnRate === null ? "–" : `${returnRate.toFixed(2)}%`} sublabel={`of ${formatCompact(summary.salesNet)} net sales`} />
          <KpiCard accent="coverage" label="Pieces returned" value={formatNumber(summary.returnsQtyPieces)} />
          <KpiCard accent="growth" label="Net after returns" value={formatCompact(summary.netAfterReturns)} />
          <KpiCard accent="revenue" label="Gross sales" value={formatCompact(summary.salesGross)} sublabel={`${formatNumber(summary.invoiceLineCount)} lines`} />
          <KpiCard accent="quarter" label="Total discount" value={formatCompact(summary.totalDiscount)} />
        </KpiGrid>
      </SectionCard>

      {data.trend.length === 0 ? (
        <EmptyState title="No distributor records for this period" description="Choose a different period, or check that the sales-returns sync is running." />
      ) : (
        <>
          <SectionCard title="Sales vs returns by day">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={10} tickFormatter={formatCompact} axisLine={false} tickLine={false} width={48} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
                <Legend verticalAlign="top" align="right" height={20} wrapperStyle={{ fontSize: 11, top: -6 }} />
                <Line type="monotone" dataKey="Sales" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Returns" stroke={CHART_COLORS[8]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="By sales rep" action={<span className="text-xs text-muted">Top {Math.min(20, data.byRep.length)} of {data.byRep.length}</span>}>
            <TableWrap>
              <Thead>
                <Th>Rep code</Th>
                <Th>Rep name</Th>
                <Th align="right">Sales</Th>
                <Th align="right">Returns</Th>
                <Th align="right">Returns %</Th>
                <Th align="right">Net</Th>
                <Th align="right">Lines</Th>
              </Thead>
              <tbody>
                {data.byRep.slice(0, 20).map((r) => (
                  <tr key={r.salesRepCode}>
                    <Td>{r.salesRepCode}</Td>
                    <Td>{r.salesRepName}</Td>
                    <Td align="right">{formatCompact(r.sales)}</Td>
                    <Td align="right">{formatCompact(r.returns)}</Td>
                    <Td align="right">{r.sales > 0 ? `${((r.returns / r.sales) * 100).toFixed(1)}%` : "–"}</Td>
                    <Td align="right">{formatCompact(r.net)}</Td>
                    <Td align="right">{formatNumber(r.lineCount)}</Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td>—</Td>
                  <Td align="right">{formatCompact(data.byRep.reduce((s, r) => s + r.sales, 0))}</Td>
                  <Td align="right">{formatCompact(data.byRep.reduce((s, r) => s + r.returns, 0))}</Td>
                  <Td align="right">—</Td>
                  <Td align="right">{formatCompact(data.byRep.reduce((s, r) => s + r.net, 0))}</Td>
                  <Td align="right">{formatNumber(data.byRep.reduce((s, r) => s + r.lineCount, 0))}</Td>
                </TotalRow>
              </tbody>
            </TableWrap>
          </SectionCard>

          <SectionCard
            title="Invoice and credit-note lines"
            action={<span className="text-xs text-muted">Page {data.pagination.page} of {totalPages} · {formatNumber(data.pagination.total)} rows</span>}
          >
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <select
                aria-label="Document type"
                value={documentType}
                onChange={(event) => {
                  setDocumentType(event.target.value);
                  setPage(1);
                }}
                className={field}
              >
                <option value="">All document types</option>
                {data.availableDocumentTypes.map((d) => (
                  <option key={d.documentType} value={d.documentType}>
                    {d.documentTypeDesc} ({d.documentType})
                  </option>
                ))}
              </select>
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Customer, rep, SKU or invoice no…"
                aria-label="Search the distributor lines"
                className="min-w-[220px] flex-1 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
              />
            </div>
            <TableWrap>
              <Thead>
                <Th>Delivery date</Th>
                <Th>Invoice no</Th>
                <Th align="center">Doc type</Th>
                <Th>Customer code</Th>
                <Th>Rep</Th>
                <Th>SKU</Th>
                <Th align="right">Qty (pcs)</Th>
                <Th align="right">Net sale</Th>
              </Thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <Td>{label(r.deliveryDate)}</Td>
                    <Td title={r.invoiceNo}>{r.invoiceNo}</Td>
                    <Td align="center">
                      <Badge tier={DOC_TYPE_TIER[r.documentType] ?? "neutral"}>{r.documentTypeDesc}</Badge>
                    </Td>
                    <Td>{r.customerCode}</Td>
                    <Td title={r.salesRepName}>{r.salesRepCode}</Td>
                    <Td title={r.skuDesc}>{r.sku}</Td>
                    <Td align="right">{formatNumber(r.saleQtyPieces)}</Td>
                    <Td align="right">{formatCompact(r.netSale)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={data.pagination.page <= 1} className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-strong transition-colors hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-40">
                Previous
              </button>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={data.pagination.page >= totalPages} className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-strong transition-colors hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-40">
                Next
              </button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
