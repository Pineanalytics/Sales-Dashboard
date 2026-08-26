"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft20Regular, BuildingShop20Regular, Dismiss12Regular, PeopleTeam20Regular, Timer20Regular } from "@fluentui/react-icons";
import { SfaReportNavigator } from "@/components/timestamps/SfaReportNavigator";
import { EablReportTabs } from "@/components/timestamps/EablReportTabs";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { recentMonthOptions } from "@/lib/timeManagement";

interface Summary {
  scope: string;
  month: string;
  syncUpdatedAt: string | null;
  metrics: { calls: number; productiveCalls: number; customers: number; reps: number; netSales: number; averageDuration: number | null; latestCallDate: string | null };
  daily: Array<{ date: string; calls: number; productiveCalls: number; netSales: number }>;
  hourly: Array<{ hour: number; calls: number; netSales: number }>;
  segments: Array<{ segment: string; calls: number; productiveCalls: number; netSales: number }>;
  reps: Array<{ salesman: string; agent: string | null; calls: number; productiveCalls: number; customers: number; netSales: number; averageDuration: number | null }>;
  filters: { reps: string[]; segments: string[]; dates: string[] };
}

interface RepVisit {
  callDate: string;
  customerName: string;
  customerType: string | null;
  segment: string | null;
  timeIn: string | null;
  timeOut: string | null;
  durationMinutes: number | null;
  netSales: number;
  isProductive: boolean;
  callsInDay: number;
  productiveCallsInDay: number;
  dayStrikeRatePct: number | null;
}

interface RepDetail { salesman: string; visits: RepVisit[] }

const number = (value: number) => value.toLocaleString("en-KE", { maximumFractionDigits: 0 });
const currency = (value: number) => value.toLocaleString("en-KE", { style: "currency", currency: "KES", notation: "compact", maximumFractionDigits: 1 });
const pct = (yes: number, all: number) => all ? `${((yes / all) * 100).toFixed(1)}%` : "—";
const date = (value: string) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));
const time = (value: string | null) => value ? new Intl.DateTimeFormat("en-KE", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)) : "—";

function Metric({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface p-3"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">{icon}{label}</div><p className="mt-2 text-xl font-bold tabular-nums text-brand-navy">{value}</p></div>;
}

function CustomerVisits({ customer, visits, expanded, toggle }: { customer: string; visits: RepVisit[]; expanded: boolean; toggle: () => void }) {
  const productive = visits.filter((visit) => visit.isProductive).length;
  const sales = visits.reduce((sum, visit) => sum + visit.netSales, 0);
  return <div className="rounded-xl border border-border bg-surface">
    <button type="button" onClick={toggle} aria-expanded={expanded} className="flex w-full flex-wrap items-center justify-between gap-3 px-3 py-3 text-left hover:bg-surface-hover">
      <div><p className="font-semibold text-brand-navy">{customer}</p><p className="mt-0.5 text-[11px] text-muted">{visits[0]?.customerType ?? "Customer"} · {visits.length} call{visits.length === 1 ? "" : "s"} · {productive} productive</p></div>
      <div className="flex items-center gap-3"><span className="text-xs font-semibold text-secondary-blue">{currency(sales)}</span><span className="rounded-full bg-background-elevated px-2 py-1 text-[11px] font-semibold text-primary-blue">{expanded ? "Collapse" : "Expand"}</span></div>
    </button>
    {expanded ? <div className="border-t border-border px-3 py-2"><TableWrap><Thead><Th>Date</Th><Th>Check-in</Th><Th>Segment</Th><Th align="right">Duration</Th><Th>Outcome</Th><Th align="right">Net sales</Th><Th align="right">Day calls</Th></Thead><tbody>{visits.map((visit, index) => <tr key={`${visit.callDate}-${visit.timeIn}-${index}`}><Td>{date(visit.callDate)}</Td><Td>{time(visit.timeIn)}</Td><Td>{visit.segment ?? "Unassigned"}</Td><Td align="right">{visit.durationMinutes === null ? "—" : `${visit.durationMinutes}m`}</Td><Td><span className={visit.isProductive ? "font-semibold text-accent-green" : "text-muted"}>{visit.isProductive ? "Productive" : "No sale"}</span></Td><Td align="right">{currency(visit.netSales)}</Td><Td align="right">{visit.productiveCallsInDay}/{visit.callsInDay}</Td></tr>)}</tbody></TableWrap></div> : null}
  </div>;
}

function RepDrawer({ salesman, month, dates, initialDate, close }: { salesman: string; month: string; dates: string[]; initialDate: string; close: () => void }) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [detail, setDetail] = useState<RepDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ rep: salesman, month });
    if (selectedDate) params.set("date", selectedDate);
    fetch(`/api/eabl-call-performance/rep-detail?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<RepDetail> : Promise.reject(new Error("Failed to load rep detail")))
      .then((body) => { if (!controller.signal.aborted) setDetail(body); })
      .catch(() => { if (!controller.signal.aborted) setDetail(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [salesman, month, selectedDate]);

  const customers = useMemo(() => {
    const groups = new Map<string, RepVisit[]>();
    for (const visit of detail?.visits ?? []) groups.set(visit.customerName, [...(groups.get(visit.customerName) ?? []), visit]);
    return Array.from(groups.entries()).sort(([, a], [, b]) => b.reduce((sum, visit) => sum + visit.netSales, 0) - a.reduce((sum, visit) => sum + visit.netSales, 0));
  }, [detail]);
  const allExpanded = customers.length > 0 && customers.every(([customer]) => expandedCustomers.has(customer));
  const selectedLabel = selectedDate ? date(selectedDate) : "All dates in month";

  return <div className="fixed inset-0 z-50 flex bg-brand-navy/35 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="EABL sales rep customers">
    <button className="absolute inset-0 cursor-default" aria-label="Close EABL rep detail" onClick={close} />
    <aside className={`relative flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl ${expanded ? "max-w-none" : "max-w-5xl sm:rounded-2xl"}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-secondary-blue">EABL DMS · Customer call detail</p><h2 className="mt-1 text-xl font-bold text-brand-navy">{salesman}</h2><p className="mt-1 text-xs text-muted">{selectedLabel} · expand only the customers you need to inspect</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-surface-active">{expanded ? "Compact view" : "Expand view"}</button><button type="button" onClick={close} className="rounded-full border border-border p-2 text-muted hover:bg-surface-active" aria-label="Close"><Dismiss12Regular /></button></div></header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-background-elevated/40 p-3"><label className="text-xs font-semibold text-muted">Customer-call date<select value={selectedDate} onChange={(event) => { setLoading(true); setExpandedCustomers(new Set()); setSelectedDate(event.target.value); }} className="mt-1 block min-w-[220px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All dates in {month}</option>{dates.map((value) => <option key={value} value={value}>{date(value)}</option>)}</select></label><button type="button" onClick={() => setExpandedCustomers(allExpanded ? new Set() : new Set(customers.map(([customer]) => customer)))} className="rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-surface-hover">{allExpanded ? "Collapse all customers" : "Expand all customers"}</button></div>
        {loading ? <p className="py-16 text-center text-sm text-muted">Loading customer calls…</p> : null}
        {!loading && !detail ? <p className="py-16 text-center text-sm text-accent-red">Couldn&apos;t load this rep&apos;s customer calls.</p> : null}
        {!loading && detail && customers.length === 0 ? <p className="py-16 text-center text-sm text-muted">No calls match this date.</p> : null}
        {!loading && detail ? <div className="flex flex-col gap-2">{customers.map(([customer, visits]) => <CustomerVisits key={customer} customer={customer} visits={visits} expanded={expandedCustomers.has(customer)} toggle={() => setExpandedCustomers((current) => { const next = new Set(current); if (next.has(customer)) next.delete(customer); else next.add(customer); return next; })} />)}</div> : null}
      </div>
    </aside>
  </div>;
}

export default function EablCallPerformancePage() {
  const [month, setMonth] = useState(() => recentMonthOptions(new Date(), 6)[0]);
  const [selectedDate, setSelectedDate] = useState("");
  const [rep, setRep] = useState("");
  const [segment, setSegment] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeRep, setActiveRep] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ month });
    if (selectedDate) params.set("date", selectedDate);
    if (rep) params.set("rep", rep);
    if (segment) params.set("segment", segment);
    fetch(`/api/eabl-call-performance/summary?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<Summary>; })
      .then((body) => { if (!controller.signal.aborted) setSummary(body); })
      .catch((err) => { if (err.name !== "AbortError") setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, selectedDate, rep, segment]);

  if (loading && !summary) return <FullPageSpinner label="Loading EABL Call Performance..." />;
  if (error || !summary) return <EmptyState icon={<Timer20Regular className="h-10 w-10" />} title="EABL Call Performance is not available yet" description="The module is ready, but its isolated SQL Server feed must be configured and synced before data can be shown." />;
  const metrics = summary.metrics;

  return <main className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
    <SfaReportNavigator current="EABL" />
    <div className="flex flex-wrap items-end justify-between gap-3"><div><Link href="/timestamps" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-blue hover:underline"><ArrowLeft20Regular className="h-4 w-4" /> All timestamp systems</Link><h1 className="mt-2 text-2xl font-bold text-brand-navy">EABL DMS · Call Performance</h1><p className="mt-1 text-sm text-muted">Dedicated call-level activity for {summary.scope}; separate from the SalesEdge timestamp feed.</p></div><EablReportTabs current="calls" /></div>
    <div className="flex flex-wrap justify-end gap-2"><span className="rounded-full bg-accent-amber-soft px-3 py-1 text-xs font-semibold text-accent-amber">Data through {metrics.latestCallDate ? date(metrics.latestCallDate) : "—"}</span><span className="rounded-full bg-accent-blue-soft px-3 py-1 text-xs font-semibold text-primary-blue">{summary.syncUpdatedAt ? `Synced ${new Date(summary.syncUpdatedAt).toLocaleString("en-KE")}` : "Awaiting first sync"}</span></div>
    <section className="grid gap-3 rounded-xl border border-border bg-background-elevated/35 p-3 sm:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-semibold text-muted">Month<select value={month} onChange={(event) => { setLoading(true); setError(false); setMonth(event.target.value); setSelectedDate(""); setActiveRep(null); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy">{recentMonthOptions(new Date(), 6).map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold text-muted">Date<select value={selectedDate} onChange={(event) => { setLoading(true); setError(false); setSelectedDate(event.target.value); setActiveRep(null); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All dates in month</option>{summary.filters.dates.map((value) => <option key={value} value={value}>{date(value)}</option>)}</select></label><label className="text-xs font-semibold text-muted">Salesman<select value={rep} onChange={(event) => { setLoading(true); setError(false); setRep(event.target.value); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All salesmen</option>{summary.filters.reps.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold text-muted">Customer segment<select value={segment} onChange={(event) => { setLoading(true); setError(false); setSegment(event.target.value); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All segments</option>{summary.filters.segments.map((value) => <option key={value}>{value}</option>)}</select></label></section>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7"><Metric label="Calls" value={number(metrics.calls)} icon={<Timer20Regular />} /><Metric label="Productive" value={number(metrics.productiveCalls)} /><Metric label="Strike rate" value={pct(metrics.productiveCalls, metrics.calls)} /><Metric label="Net sales" value={currency(metrics.netSales)} /><Metric label="Customers" value={number(metrics.customers)} icon={<BuildingShop20Regular />} /><Metric label="Salesmen" value={number(metrics.reps)} icon={<PeopleTeam20Regular />} /><Metric label="Avg call" value={metrics.averageDuration === null ? "—" : `${metrics.averageDuration.toFixed(0)}m`} /></div>
    <div className="grid gap-5 xl:grid-cols-2"><SectionCard title="Daily call performance" action={<span className="text-xs text-muted">Calls and productive calls</span>}><ResponsiveContainer width="100%" height={260}><LineChart data={summary.daily.map((row) => ({ ...row, label: date(row.date) }))}><CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={10} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Legend /><Line type="monotone" dataKey="calls" name="Calls" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} /><Line type="monotone" dataKey="productiveCalls" name="Productive" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></SectionCard><SectionCard title="Call start-time pattern" action={<span className="text-xs text-muted">Calls by hour of check-in</span>}><ResponsiveContainer width="100%" height={260}><BarChart data={summary.hourly.map((row) => ({ ...row, label: `${row.hour}:00` }))}><CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={10} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Bar dataKey="calls" name="Calls" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></SectionCard></div>
    <div className="grid gap-5 xl:grid-cols-2"><SectionCard title="Segment strike rate"><TableWrap><Thead><Th>Segment</Th><Th align="right">Calls</Th><Th align="right">Productive</Th><Th align="right">Strike rate</Th><Th align="right">Net sales</Th></Thead><tbody>{summary.segments.map((row) => <tr key={row.segment}><Td>{row.segment}</Td><Td align="right">{number(row.calls)}</Td><Td align="right">{number(row.productiveCalls)}</Td><Td align="right">{pct(row.productiveCalls, row.calls)}</Td><Td align="right">{currency(row.netSales)}</Td></tr>)}</tbody></TableWrap></SectionCard><SectionCard title="Salesman leaderboard" action={<span className="text-xs text-muted">Open a rep to browse collapsed customer calls</span>}><TableWrap><Thead><Th>Salesman</Th><Th align="right">Calls</Th><Th align="right">Customers</Th><Th align="right">Strike rate</Th><Th align="right">Net sales</Th></Thead><tbody>{summary.reps.map((row) => <tr key={row.salesman}><Td><button type="button" onClick={() => setActiveRep(row.salesman)} className="font-semibold text-primary-blue hover:underline">{row.salesman}</button>{row.agent ? <span className="block text-[11px] text-muted">{row.agent}</span> : null}</Td><Td align="right">{number(row.calls)}</Td><Td align="right">{number(row.customers)}</Td><Td align="right">{pct(row.productiveCalls, row.calls)}</Td><Td align="right">{currency(row.netSales)}</Td></tr>)}</tbody></TableWrap></SectionCard></div>
    {activeRep ? <RepDrawer salesman={activeRep} month={month} dates={summary.filters.dates} initialDate={selectedDate} close={() => setActiveRep(null)} /> : null}
  </main>;
}
