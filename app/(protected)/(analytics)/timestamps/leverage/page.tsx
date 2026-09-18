"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft20Regular, BuildingShop20Regular, Clock20Regular, Dismiss12Regular, Money20Regular, PeopleTeam20Regular, PhoneTablet20Regular, Receipt20Regular, VehicleTruck20Regular, Warning20Regular } from "@fluentui/react-icons";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionCard } from "@/components/ui/KpiGrid";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { SfaReportNavigator } from "@/components/timestamps/SfaReportNavigator";
import { closingStatus, firstCallStatus, nairobiMinutesAfterMidnight, recentMonthOptions } from "@/lib/timeManagement";

interface RepDay {
  date: string; distributor: string; distributorLabel: string; dsr: string; dsrName: string; routes: string;
  firstEntryTime: string | null; lastEntryTime: string | null; transactions: number; outletVisits: number;
  handheldTransactions: number; activeSpanMinutes: number | null;
}

interface Summary {
  scope: string; month: string;
  metrics: {
    pjps: number; dsrs: number; transactions: number; outletVisits: number; handheldTransactions: number;
    handheldShare: number | null; averageSpanMinutes: number | null; averageGapMinutes: number | null; lastDataAt: string | null;
  };
  daily: Array<{ date: string; transactions: number; outletVisits: number; dsrs: number; pjps: number }>;
  repDays: RepDay[];
  coverage: Array<{ distributor: string; distributorLabel: string; dsr: string; dsrName: string; activeDays: number; transactions: number; outletVisits: number; averageOutletsPerDay: number; handheldTransactions: number }>;
  routes: Array<{ distributor: string; distributorLabel: string; pjp: string; route: string; activeDays: number; dsrs: number; transactions: number; outletVisits: number }>;
  filters: { reps: string[]; dates: string[]; distributors: Array<{ code: string; label: string }> };
  freshness: { branches: Array<{ distributor: string; distributorLabel: string; syncedAt: string | null }> };
  definitions: { coverage: string; time: string };
}

type AttentionFilter = "all" | "late" | "on-time";

interface CustomersSummary {
  metrics: { customers: number; reps: number; transactions: number; netSales: number };
  reps: Array<{ salesRepName: string; distributor: string; distributorLabel: string; customers: number; transactions: number; netSales: number }>;
  definitions: { customers: string; strikeRate: string };
}

interface CustomerVisit {
  date: string; customerCode: string; route: string | null; routeName: string;
  invoiceNo: string; documentType: string; documentTypeDesc: string;
  saleQtyPieces: number; freeQtyPieces: number; netSale: number;
}

interface RepTrendRow { label: string; customers: number; transactions: number; netSales: number; saleQtyPieces: number }

interface RepDetail {
  salesRepName: string;
  overall: { customers: number; transactions: number; activeDays: number; netSales: number; saleQtyPieces: number; freeQtyPieces: number; avgNetSalePerTransaction: number | null };
  dailyTrend: RepTrendRow[];
  weeklyTrend: RepTrendRow[];
  visits: CustomerVisit[];
}

const fmt = (value: number, digits = 0) => value.toLocaleString("en-KE", { maximumFractionDigits: digits });
const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(0)}%`;
const currency = (value: number) => value.toLocaleString("en-KE", { style: "currency", currency: "KES", notation: "compact", maximumFractionDigits: 1 });
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const timeLabel = (value: string | null) => value ? new Intl.DateTimeFormat("en-KE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(value)) : "—";
const syncLabel = (value: string | null) => value ? new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "Awaiting sync";

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface p-3 shadow-[0_2px_8px_rgba(11,61,53,0.05)]"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{icon}{label}</div><p className="mt-2 text-xl font-bold tabular-nums text-brand-navy">{value}</p></div>;
}

function startBadge(value: string | null) {
  if (!value) return <span className="text-muted">—</span>;
  const late = firstCallStatus(value) === "late";
  return <span className={`inline-flex items-center gap-1 font-semibold ${late ? "text-accent-red" : "text-accent-green"}`}><span aria-hidden>{late ? "⚠" : "✓"}</span>{timeLabel(value)}</span>;
}

function closingRemark(row: RepDay) {
  if (!row.lastEntryTime) return <span className="text-muted">Not assessed</span>;
  const status = closingStatus(row.date, row.lastEntryTime);
  if (status === "day-in-progress") return <span className="text-muted">Day still in progress</span>;
  if (status === "closed-early") return <span className="font-semibold text-accent-red">Before 4:00 PM</span>;
  if (status === "closed-on-time") return <span className="font-semibold text-accent-green">At/after 4:00 PM</span>;
  return <span className="text-muted">Not assessed</span>;
}

/** handheldTransactions is a data-quality signal, not a hard filter — a PJP
 * that's 0% handheld across every row still gets shown, just flagged, since
 * excluding it silently would hide the exact rows a supervisor most needs to
 * follow up on (see the source query's own comment on this). */
function handheldTag(row: { transactions: number; handheldTransactions: number }) {
  if (row.transactions === 0) return null;
  const share = row.handheldTransactions / row.transactions;
  if (share === 0) return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-amber"><Warning20Regular className="h-3 w-3" /> Manual entry — times unverified</span>;
  if (share < 0.5) return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-amber"><Warning20Regular className="h-3 w-3" /> {pct(share)} handheld</span>;
  return <span className="text-[10px] text-muted">{pct(share)} handheld</span>;
}

function documentTag(documentType: string, documentTypeDesc: string) {
  const isReturn = documentType === "18" || documentType === "19";
  return <span className={`font-semibold ${isReturn ? "text-accent-red" : "text-accent-green"}`}>{documentTypeDesc}</span>;
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-border/70 bg-surface px-2.5 py-2"><div className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</div><div className="mt-0.5 truncate text-base font-semibold tabular-nums text-brand-navy">{value}</div></div>;
}

function CustomerVisits({ customer, visits, expanded, toggle }: { customer: string; visits: CustomerVisit[]; expanded: boolean; toggle: () => void }) {
  const netSales = visits.reduce((sum, v) => sum + v.netSale, 0);
  const routeName = visits[0]?.routeName ?? "Unassigned route";
  return <div className="rounded-xl border border-border bg-surface">
    <button type="button" onClick={toggle} aria-expanded={expanded} className="flex w-full flex-wrap items-center justify-between gap-3 px-3 py-3 text-left hover:bg-surface-hover">
      <div><p className="font-semibold text-brand-navy">{customer}</p><p className="mt-0.5 text-[11px] text-muted">{routeName} · {visits.length} transaction{visits.length === 1 ? "" : "s"}</p></div>
      <div className="flex items-center gap-3"><span className="text-xs font-semibold text-secondary-blue">{currency(netSales)}</span><span className="rounded-full bg-background-elevated px-2 py-1 text-[11px] font-semibold text-primary-blue">{expanded ? "Collapse" : "Expand"}</span></div>
    </button>
    {expanded ? <div className="border-t border-border px-3 py-2"><TableWrap><Thead><Th>Date</Th><Th>Invoice</Th><Th>Type</Th><Th align="right">Pieces</Th><Th align="right">Free</Th><Th align="right">Net sale</Th></Thead><tbody>{visits.map((v, i) => <tr key={`${v.invoiceNo}-${i}`}><Td>{dateLabel(v.date)}</Td><Td>{v.invoiceNo}</Td><Td>{documentTag(v.documentType, v.documentTypeDesc)}</Td><Td align="right">{fmt(v.saleQtyPieces)}</Td><Td align="right">{fmt(v.freeQtyPieces)}</Td><Td align="right">{currency(v.netSale)}</Td></tr>)}</tbody></TableWrap></div> : null}
  </div>;
}

function CustomerDrawer({ salesRepName, month, selectedDate, close }: { salesRepName: string; month: string; selectedDate: string; close: () => void }) {
  const [detail, setDetail] = useState<RepDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ rep: salesRepName, month });
    if (selectedDate) params.set("date", selectedDate);
    fetch(`/api/pjp-dsr-daily-activity/customer-detail?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<RepDetail> : Promise.reject(new Error("Failed to load customer detail")))
      .then((body) => { if (!controller.signal.aborted) setDetail(body); })
      .catch(() => { if (!controller.signal.aborted) setDetail(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [salesRepName, month, selectedDate]);

  const customers = useMemo(() => {
    const groups = new Map<string, CustomerVisit[]>();
    for (const visit of detail?.visits ?? []) groups.set(visit.customerCode, [...(groups.get(visit.customerCode) ?? []), visit]);
    return Array.from(groups.entries()).sort(([, a], [, b]) => b.reduce((sum, v) => sum + v.netSale, 0) - a.reduce((sum, v) => sum + v.netSale, 0));
  }, [detail]);
  const allExpanded = customers.length > 0 && customers.every(([customer]) => expandedCustomers.has(customer));
  const selectedLabel = selectedDate ? dateLabel(selectedDate) : `All dates in ${month}`;

  return <div className="fixed inset-0 z-50 flex bg-brand-navy/35 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Unilever Leverage rep customers">
    <button className="absolute inset-0 cursor-default" aria-label="Close Leverage rep detail" onClick={close} />
    <aside className={`relative flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl ${expanded ? "max-w-none" : "max-w-5xl sm:rounded-2xl"}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-secondary-blue">Sales &amp; Returns · Customer detail</p><h2 className="mt-1 text-xl font-bold text-brand-navy">{salesRepName}</h2><p className="mt-1 text-xs text-muted">{selectedLabel}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-surface-active">{expanded ? "Compact view" : "Expand view"}</button><button type="button" onClick={close} className="rounded-full border border-border p-2 text-muted hover:bg-surface-active" aria-label="Close"><Dismiss12Regular /></button></div></header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {loading ? <p className="py-16 text-center text-sm text-muted">Loading customer transactions and trends…</p> : null}
        {!loading && !detail ? <p className="py-16 text-center text-sm text-accent-red">Couldn&apos;t load this rep&apos;s customer detail.</p> : null}
        {!loading && detail ? <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <CompactMetric label="Customers" value={fmt(detail.overall.customers)} />
            <CompactMetric label="Transactions" value={fmt(detail.overall.transactions)} />
            <CompactMetric label="Active days" value={fmt(detail.overall.activeDays)} />
            <CompactMetric label="Net sales" value={currency(detail.overall.netSales)} />
            <CompactMetric label="Avg / transaction" value={detail.overall.avgNetSalePerTransaction === null ? "—" : currency(detail.overall.avgNetSalePerTransaction)} />
            <CompactMetric label="Pieces (sale + free)" value={fmt(detail.overall.saleQtyPieces + detail.overall.freeQtyPieces)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Daily trend" action={<span className="text-xs text-muted">Transactions &amp; net sales</span>}>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={detail.dailyTrend.map((row) => ({ ...row, name: dateLabel(row.label) }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                  <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="transactions" name="Transactions" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="customers" name="Customers" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>
            <SectionCard title="Weekly performance" action={<span className="text-xs text-muted">Customers, transactions &amp; net sales</span>}>
              <TableWrap><Thead><Th>Week</Th><Th align="right">Customers</Th><Th align="right">Transactions</Th><Th align="right">Net sales</Th><Th align="right">Pieces</Th></Thead><tbody>{detail.weeklyTrend.map((row) => <tr key={row.label}><Td>{row.label}</Td><Td align="right">{fmt(row.customers)}</Td><Td align="right">{fmt(row.transactions)}</Td><Td align="right">{currency(row.netSales)}</Td><Td align="right">{fmt(row.saleQtyPieces)}</Td></tr>)}</tbody></TableWrap>
            </SectionCard>
          </div>

          <SectionCard title="Customers" action={customers.length > 0 ? <button type="button" onClick={() => setExpandedCustomers(allExpanded ? new Set() : new Set(customers.map(([customer]) => customer)))} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-surface-hover">{allExpanded ? "Collapse all" : "Expand all"}</button> : undefined}>
            {customers.length === 0 ? <p className="py-8 text-center text-sm text-muted">No invoices or returns match this date.</p> : <div className="flex flex-col gap-2">{customers.map(([customer, visits]) => <CustomerVisits key={customer} customer={customer} visits={visits} expanded={expandedCustomers.has(customer)} toggle={() => setExpandedCustomers((current) => { const next = new Set(current); if (next.has(customer)) next.delete(customer); else next.add(customer); return next; })} />)}</div>}
          </SectionCard>
        </div> : null}
      </div>
    </aside>
  </div>;
}

export default function LeveragePage() {
  const [month, setMonth] = useState(() => recentMonthOptions(new Date(), 6)[0]);
  const [selectedDate, setSelectedDate] = useState("");
  const [distributor, setDistributor] = useState("");
  const [rep, setRep] = useState("");
  const [attention, setAttention] = useState<AttentionFilter>("all");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [customersSummary, setCustomersSummary] = useState<CustomersSummary | null>(null);
  const [activeRep, setActiveRep] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshTick((value) => value + 1), 5 * 60_000);
    const refreshVisible = () => { if (document.visibilityState === "visible") setRefreshTick((value) => value + 1); };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshVisible); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ month });
    if (selectedDate) params.set("date", selectedDate);
    if (distributor) params.set("distributor", distributor);
    if (rep) params.set("rep", rep);
    setLoading(true); setError(false);
    fetch(`/api/pjp-dsr-daily-activity/summary?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Failed to load Leverage activity"); return response.json() as Promise<Summary>; })
      .then((body) => { if (!controller.signal.aborted) setSummary(body); })
      .catch((caught) => { if (!controller.signal.aborted && (caught as Error).name !== "AbortError") setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, selectedDate, distributor, rep, refreshTick]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ month });
    if (selectedDate) params.set("date", selectedDate);
    if (distributor) params.set("distributor", distributor);
    if (rep) params.set("rep", rep);
    fetch(`/api/pjp-dsr-daily-activity/customers?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Failed to load Leverage customers"); return response.json() as Promise<CustomersSummary>; })
      .then((body) => { if (!controller.signal.aborted) setCustomersSummary(body); })
      .catch((caught) => { if (!controller.signal.aborted && (caught as Error).name !== "AbortError") setCustomersSummary(null); });
    return () => controller.abort();
  }, [month, selectedDate, distributor, rep, refreshTick]);

  const statusCounts = useMemo(() => {
    const rows = summary?.repDays.filter((row) => row.firstEntryTime) ?? [];
    return {
      late: rows.filter((row) => firstCallStatus(row.firstEntryTime as string) === "late").length,
      onTime: rows.filter((row) => firstCallStatus(row.firstEntryTime as string) !== "late").length,
    };
  }, [summary]);

  const visibleRepDays = useMemo(() => {
    const rows = (summary?.repDays ?? []).filter((row) => {
      if (attention === "all") return true;
      if (!row.firstEntryTime) return false;
      return firstCallStatus(row.firstEntryTime) === attention;
    });
    return [...rows].sort((a, b) => {
      const aLate = a.firstEntryTime ? firstCallStatus(a.firstEntryTime) === "late" : false;
      const bLate = b.firstEntryTime ? firstCallStatus(b.firstEntryTime) === "late" : false;
      if (aLate !== bLate) return aLate ? -1 : 1;
      const aMinutes = a.firstEntryTime ? nairobiMinutesAfterMidnight(a.firstEntryTime) ?? 0 : 0;
      const bMinutes = b.firstEntryTime ? nairobiMinutesAfterMidnight(b.firstEntryTime) ?? 0 : 0;
      if (aMinutes !== bMinutes) return aLate ? bMinutes - aMinutes : aMinutes - bMinutes;
      return b.date.localeCompare(a.date) || a.dsrName.localeCompare(b.dsrName);
    });
  }, [summary, attention]);

  if (loading && !summary) return <FullPageSpinner label="Loading Unilever Leverage activity..." />;
  if (error || !summary) return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Unilever Leverage is unavailable" description="PJP/DSR daily activity could not be loaded from Postgres. Refresh once the latest Sales & Returns sync completes." />;
  const metrics = summary.metrics;

  return <div className="flex flex-col gap-4">
    <SfaReportNavigator current="unilever" />
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/timestamps" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-blue hover:underline"><ArrowLeft20Regular className="h-4 w-4" /> All timestamp systems</Link><h1 className="mt-2 text-2xl font-bold text-brand-navy">Unilever · Leverage</h1><p className="mt-1 text-sm text-muted">PJP/route daily activity and first/last entry time from the field DMS (Centegy), Nairobi &amp; Nyeri branches.</p></div>
      <div className="flex flex-wrap gap-2">{summary.freshness.branches.map((branch) => <span key={branch.distributor} className="rounded-full bg-accent-blue-soft px-3 py-1 text-xs font-semibold text-primary-blue">{branch.distributorLabel} synced {syncLabel(branch.syncedAt)}</span>)}</div>
    </div>

    <section className="grid gap-3 rounded-xl border border-border bg-background-elevated/40 p-3 sm:grid-cols-4">
      <label className="text-xs font-semibold text-muted">Month<select value={month} onChange={(event) => { setMonth(event.target.value); setSelectedDate(""); setRep(""); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy">{recentMonthOptions(new Date(), 6).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted">Date<select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All dates in month</option>{summary.filters.dates.map((value) => <option key={value} value={value}>{dateLabel(value)}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted">Branch<select value={distributor} onChange={(event) => { setDistributor(event.target.value); setRep(""); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All branches</option>{summary.filters.distributors.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted">Sales rep (DSR)<select value={rep} onChange={(event) => setRep(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All representatives</option>{summary.filters.reps.map((value) => <option key={value}>{value}</option>)}</select></label>
    </section>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Metric label="Active routes" value={fmt(metrics.pjps)} icon={<VehicleTruck20Regular />} /><Metric label="Active reps" value={fmt(metrics.dsrs)} icon={<PeopleTeam20Regular />} /><Metric label="Field transactions" value={fmt(metrics.transactions)} icon={<Receipt20Regular />} /><Metric label="Outlet visits" value={fmt(metrics.outletVisits)} icon={<Receipt20Regular />} /><Metric label="Handheld share" value={pct(metrics.handheldShare)} icon={<PhoneTablet20Regular />} /><Metric label="Avg active span" value={metrics.averageSpanMinutes == null ? "—" : `${fmt(metrics.averageSpanMinutes)}m`} icon={<Clock20Regular />} />
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <Metric label="Customers" value={customersSummary ? fmt(customersSummary.metrics.customers) : "—"} icon={<BuildingShop20Regular />} /><Metric label="Invoiced transactions" value={customersSummary ? fmt(customersSummary.metrics.transactions) : "—"} icon={<Receipt20Regular />} /><Metric label="Net sales" value={customersSummary ? currency(customersSummary.metrics.netSales) : "—"} icon={<Money20Regular />} />
    </div>

    <section className="rounded-xl border border-border bg-surface p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-brand-navy">Time management</h2><p className="text-[11px] text-muted">Standard benchmark: first entry at 9:30 AM or earlier · last entry at/after 4:00 PM · closing feedback applies only after the day elapses. Times come from the handheld&apos;s own capture (DATE_ENTRY) — check the handheld-share tag before trusting a low-handheld row&apos;s timing.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setAttention("all")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "all" ? "bg-brand-navy text-white" : "bg-background-elevated text-brand-navy"}`}>All rep-days ({summary.repDays.length})</button><button onClick={() => setAttention("late")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "late" ? "bg-accent-red text-white" : "bg-accent-red-soft text-accent-red"}`}>⚠ Needs attention ({statusCounts.late})</button><button onClick={() => setAttention("on-time")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "on-time" ? "bg-accent-green text-white" : "bg-accent-green-soft text-accent-green"}`}>👍 Thumbs Up ({statusCounts.onTime})</button></div></div></section>

    <SectionCard title="Daily activity" action={<span className="text-xs text-muted">Transactions and outlet visits across both branches</span>}><ResponsiveContainer width="100%" height={270}><LineChart data={summary.daily.map((row) => ({ ...row, label: dateLabel(row.date) }))}><CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={10} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Legend /><Line type="monotone" dataKey="transactions" name="Transactions" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} /><Line type="monotone" dataKey="outletVisits" name="Outlet visits" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></SectionCard>

    <SectionCard title="Rep Daily Summary" action={<span className="text-xs text-muted">Attention rows are ranked first · times are the handheld&apos;s own capture</span>}><TableWrap><Thead><Th>Date</Th><Th>Branch</Th><Th>Sales rep (DSR)</Th><Th>Route(s)</Th><Th>First entry</Th><Th>Start status</Th><Th>Last entry</Th><Th>Closing remark</Th><Th align="right">Transactions</Th><Th align="right">Outlets</Th></Thead><tbody>{visibleRepDays.map((row) => { const late = row.firstEntryTime ? firstCallStatus(row.firstEntryTime) === "late" : false; return <tr key={`${row.date}-${row.distributor}-${row.dsr}`}><Td>{dateLabel(row.date)}</Td><Td>{row.distributorLabel}</Td><Td><span className="font-semibold text-brand-navy">{row.dsrName}</span>{handheldTag(row)}</Td><Td>{row.routes}</Td><Td>{startBadge(row.firstEntryTime)}</Td><Td>{row.firstEntryTime ? <span className={`font-semibold ${late ? "text-accent-red" : "text-accent-green"}`}>{late ? "Needs attention" : "On time"}</span> : <span className="text-muted">—</span>}</Td><Td>{timeLabel(row.lastEntryTime)}</Td><Td>{closingRemark(row)}</Td><Td align="right">{fmt(row.transactions)}</Td><Td align="right">{fmt(row.outletVisits)}</Td></tr>; })}</tbody></TableWrap></SectionCard>

    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Visit activity by rep" action={<span className="text-xs text-muted">Outlet visits and transactions per DSR — repeat visits count each time</span>}><TableWrap><Thead><Th>Sales rep (DSR)</Th><Th>Branch</Th><Th align="right">Active days</Th><Th align="right">Outlet visits</Th><Th align="right">Avg/day</Th><Th align="right">Transactions</Th></Thead><tbody>{summary.coverage.map((row) => <tr key={`${row.distributor}-${row.dsr}`}><Td><span className="font-semibold text-brand-navy">{row.dsrName}</span></Td><Td>{row.distributorLabel}</Td><Td align="right">{fmt(row.activeDays)}</Td><Td align="right">{fmt(row.outletVisits)}</Td><Td align="right">{fmt(row.averageOutletsPerDay, 1)}</Td><Td align="right">{fmt(row.transactions)}</Td></tr>)}</tbody></TableWrap></SectionCard>
      <SectionCard title="Route activity" action={<span className="text-xs text-muted">Top 25 PJPs by active days, then transactions</span>}><TableWrap><Thead><Th>Route (PJP)</Th><Th>Branch</Th><Th align="right">Active days</Th><Th align="right">Reps</Th><Th align="right">Transactions</Th><Th align="right">Outlet visits</Th></Thead><tbody>{summary.routes.map((row) => <tr key={`${row.distributor}-${row.pjp}`}><Td><span className="font-semibold text-brand-navy">{row.route}</span></Td><Td>{row.distributorLabel}</Td><Td align="right">{fmt(row.activeDays)}</Td><Td align="right">{fmt(row.dsrs)}</Td><Td align="right">{fmt(row.transactions)}</Td><Td align="right">{fmt(row.outletVisits)}</Td></tr>)}</tbody></TableWrap></SectionCard>
    </div>

    <SectionCard title="Customers by rep" action={<span className="text-xs text-muted">Open a rep to browse their invoiced customers · distinct customers from Sales &amp; Returns</span>}>
      {customersSummary ? <TableWrap><Thead><Th>Sales rep</Th><Th>Branch</Th><Th align="right">Customers</Th><Th align="right">Transactions</Th><Th align="right">Net sales</Th></Thead><tbody>{customersSummary.reps.map((row) => <tr key={`${row.distributor}-${row.salesRepName}`}><Td><button type="button" onClick={() => setActiveRep(row.salesRepName)} className="font-semibold text-primary-blue hover:underline">{row.salesRepName}</button></Td><Td>{row.distributorLabel}</Td><Td align="right">{fmt(row.customers)}</Td><Td align="right">{fmt(row.transactions)}</Td><Td align="right">{currency(row.netSales)}</Td></tr>)}</tbody></TableWrap> : <p className="py-8 text-center text-sm text-muted">Loading customer detail…</p>}
    </SectionCard>

    <section className="rounded-xl border border-border bg-background-elevated/45 px-4 py-3 text-xs text-muted"><strong className="text-brand-navy">Metric boundary:</strong> {summary.definitions.coverage} {summary.definitions.time} This is route/rep daily activity from the Sales &amp; Returns bridge, not a per-invoice or GPS-visit feed — there is no drilldown below the daily PJP/DSR grain.</section>
    {customersSummary ? <section className="rounded-xl border border-border bg-background-elevated/45 px-4 py-3 text-xs text-muted"><strong className="text-brand-navy">Strike rate:</strong> {customersSummary.definitions.strikeRate}</section> : null}
    {activeRep ? <CustomerDrawer salesRepName={activeRep} month={month} selectedDate={selectedDate} close={() => setActiveRep(null)} /> : null}
  </div>;
}
