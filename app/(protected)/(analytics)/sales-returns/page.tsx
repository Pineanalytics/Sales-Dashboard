"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { Badge } from "@/components/ui/Badge";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCompact, formatNumber, type Tier } from "@/lib/format";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle, CHART_COLORS } from "@/components/charts/theme";
import { ArrowSwap20Regular } from "@fluentui/react-icons";

interface SalesReturnsSummary {
  salesGross: number;
  salesNet: number;
  salesQtyPieces: number;
  returnsGross: number;
  returnsNet: number;
  returnsQtyPieces: number;
  netAfterReturns: number;
  freeQtyPieces: number;
  totalDiscount: number;
  invoiceLineCount: number;
  returnLineCount: number;
}

interface SalesReturnsTrendPoint {
  date: string;
  sales: number;
  returns: number;
}

interface SalesReturnsRepRow {
  salesRepCode: string;
  salesRepName: string;
  sales: number;
  returns: number;
  net: number;
  lineCount: number;
}

interface SalesReturnsDocTypeRow {
  documentType: string;
  documentTypeDesc: string;
  lineCount: number;
  netSale: number;
}

interface SalesReturnLineRowDto {
  id: string;
  invoiceNo: string;
  invoiceDate: string | null;
  deliveryDate: string;
  documentType: string;
  documentTypeDesc: string;
  customerCode: string;
  salesRepCode: string;
  salesRepName: string;
  route: string | null;
  routeName: string;
  sku: string;
  skuDesc: string;
  storageLocation: string;
  saleQtyPieces: number;
  freeQtyPieces: number;
  grossSale: number;
  netSale: number;
  totalDiscount: number;
}

interface SalesReturnsResponse {
  summary: SalesReturnsSummary;
  trend: SalesReturnsTrendPoint[];
  byRep: SalesReturnsRepRow[];
  byDocType: SalesReturnsDocTypeRow[];
  availableDocumentTypes: { documentType: string; documentTypeDesc: string }[];
  rows: SalesReturnLineRowDto[];
  pagination: { page: number; pageSize: number; total: number };
  range: { from: string; to: string };
}

const DOC_TYPE_TIER: Record<string, Tier> = { "01": "good", "06": "good", "18": "bad", "19": "bad" };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function SalesReturnsPage() {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [data, setData] = useState<SalesReturnsResponse | null>(null);
  const [from, setFrom] = useState(daysAgoIso(29));
  const [to, setTo] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const params = new URLSearchParams({ from, to, page: String(page) });
    if (search.trim()) params.set("search", search.trim());
    if (documentType) params.set("documentType", documentType);

    (async () => {
      try {
        const res = await fetch(`/api/sales-returns?${params.toString()}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load Sales & Returns data.");
        if (!cancelled) {
          setData(body);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, search, documentType, page]);

  if (status === "loading" && !data) return <FullPageSpinner label="Loading Sales & Returns…" />;
  if (status === "error" || !data) {
    return (
      <EmptyState
        icon={<ArrowSwap20Regular className="h-10 w-10" />}
        title="Couldn't load Sales & Returns"
        description="Try refreshing the page. If this keeps happening, the sales-returns:sync job may be behind schedule."
      />
    );
  }

  const { summary } = data;
  const trendData = data.trend.map((t) => ({
    name: formatDateLabel(t.date),
    Sales: Math.round(t.sales),
    Returns: Math.round(t.returns),
  }));
  const totalPages = Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Sales & Returns" action={<span className="text-xs text-muted">{formatDateLabel(data.range.from)} – {formatDateLabel(data.range.to)}</span>}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs font-semibold text-muted-strong outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">To</span>
            <input
              type="date"
              value={to}
              min={from}
              max={todayIso()}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs font-semibold text-muted-strong outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Document Type</span>
            <select
              aria-label="Document Type"
              value={documentType}
              onChange={(e) => {
                setDocumentType(e.target.value);
                setPage(1);
              }}
              className="rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs font-semibold text-muted-strong outline-none"
            >
              <option value="">All Document Types</option>
              {data.availableDocumentTypes.map((d) => (
                <option key={d.documentType} value={d.documentType}>
                  {d.documentTypeDesc} ({d.documentType})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 min-w-[200px] flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Search</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Customer, rep, SKU, or invoice no…"
              className="w-full rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Summary">
        <KpiGrid>
          <KpiCard accent="revenue" label="Gross Sales" value={<AnimatedValue value={summary.salesGross} format={formatCompact} />} sublabel={`${formatNumber(summary.invoiceLineCount)} lines`} />
          <KpiCard accent="revenue" label="Net Sales" value={<AnimatedValue value={summary.salesNet} format={formatCompact} />} />
          <KpiCard accent="mission" label="Returns" value={<AnimatedValue value={summary.returnsNet} format={formatCompact} />} sublabel={`${formatNumber(summary.returnLineCount)} lines`} />
          <KpiCard accent="growth" label="Net After Returns" value={<AnimatedValue value={summary.netAfterReturns} format={formatCompact} />} />
          <KpiCard accent="coverage" label="Sale Qty (Pcs)" value={<AnimatedValue value={summary.salesQtyPieces} format={formatNumber} />} sublabel={`+${formatNumber(summary.freeQtyPieces)} free`} />
          <KpiCard accent="quarter" label="Total Discount" value={<AnimatedValue value={summary.totalDiscount} format={formatCompact} />} />
        </KpiGrid>
      </SectionCard>

      {data.trend.length === 0 ? (
        <EmptyState
          icon={<ArrowSwap20Regular className="h-10 w-10" />}
          title="No Sales & Returns data for this period"
          description="Choose a different date range, or check that the daily sales-returns:sync job is running."
        />
      ) : (
        <>
          <SectionCard title="Sales vs Returns Trend">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={10} tickFormatter={formatCompact} axisLine={false} tickLine={false} width={48} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
                <Legend verticalAlign="top" align="right" height={20} wrapperStyle={{ fontSize: 11, top: -6 }} />
                <Line type="monotone" dataKey="Sales" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Returns" stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard title="By Sales Rep" action={<span className="text-xs text-muted">Top {Math.min(20, data.byRep.length)} of {data.byRep.length}</span>}>
            <TableWrap>
              <Thead>
                <Th>Rep Code</Th>
                <Th>Rep Name</Th>
                <Th align="right">Sales</Th>
                <Th align="right">Returns</Th>
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
                    <Td align="right">{formatCompact(r.net)}</Td>
                    <Td align="right">{formatNumber(r.lineCount)}</Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td>—</Td>
                  <Td align="right">{formatCompact(data.byRep.reduce((s, r) => s + r.sales, 0))}</Td>
                  <Td align="right">{formatCompact(data.byRep.reduce((s, r) => s + r.returns, 0))}</Td>
                  <Td align="right">{formatCompact(data.byRep.reduce((s, r) => s + r.net, 0))}</Td>
                  <Td align="right">{formatNumber(data.byRep.reduce((s, r) => s + r.lineCount, 0))}</Td>
                </TotalRow>
              </tbody>
            </TableWrap>
          </SectionCard>

          <SectionCard
            title="Invoice Line Detail"
            action={
              <span className="text-xs text-muted">
                Page {data.pagination.page} of {totalPages} · {formatNumber(data.pagination.total)} rows
              </span>
            }
          >
            <TableWrap>
              <Thead>
                <Th>Delivery Date</Th>
                <Th>Invoice No</Th>
                <Th align="center">Doc Type</Th>
                <Th>Customer Code</Th>
                <Th>Rep</Th>
                <Th>SKU</Th>
                <Th align="right">Qty (Pcs)</Th>
                <Th align="right">Free Qty</Th>
                <Th align="right">Gross Sale</Th>
                <Th align="right">Net Sale</Th>
                <Th align="right">Discount</Th>
              </Thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <Td>{formatDateLabel(r.deliveryDate)}</Td>
                    <Td title={r.invoiceNo}>{r.invoiceNo}</Td>
                    <Td align="center">
                      <Badge tier={DOC_TYPE_TIER[r.documentType] ?? "neutral"}>{r.documentTypeDesc}</Badge>
                    </Td>
                    <Td>{r.customerCode}</Td>
                    <Td title={r.salesRepName}>{r.salesRepCode}</Td>
                    <Td title={r.skuDesc}>{r.sku}</Td>
                    <Td align="right">{formatNumber(r.saleQtyPieces)}</Td>
                    <Td align="right">{formatNumber(r.freeQtyPieces)}</Td>
                    <Td align="right">{formatCompact(r.grossSale)}</Td>
                    <Td align="right">{formatCompact(r.netSale)}</Td>
                    <Td align="right">{formatCompact(r.totalDiscount)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.pagination.page <= 1}
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-strong transition-colors hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={data.pagination.page >= totalPages}
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-strong transition-colors hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
