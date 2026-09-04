"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft20Regular, BuildingShop20Regular, Clock20Regular, Dismiss12Regular, Money20Regular, PeopleTeam20Regular, VehicleCar20Regular } from "@fluentui/react-icons";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionCard } from "@/components/ui/KpiGrid";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { SfaReportNavigator } from "@/components/timestamps/SfaReportNavigator";
import { recentMonthOptions } from "@/lib/timeManagement";
import { upfieldClosingStatus, upfieldFirstTransactionStatus, upfieldMinutesAfterMidnight } from "@/lib/upfieldTimeManagement";

interface RepDay {
  date: string; rep: string; firstVisit: string; lastActivity: string;
  visits: number; outlets: number; sale: number; visitsWithSale: number;
}

interface Summary {
  scope: string; month: string;
  metrics: { visits: number; outlets: number; reps: number; sale: number; visitsWithSale: number; open: number; lastDataAt: string | null };
  daily: Array<{ date: string; visits: number; outlets: number; reps: number; sale: number }>;
  hourly: Array<{ hour: number; visits: number; outlets: number }>;
  repDays: RepDay[];
  coverage: Array<{ rep: string; activeDays: number; outlets: number; outletDays: number; averageOutletsPerDay: number; visits: number; sale: number }>;
  outlets: Array<{ pop: string; activeDays: number; reps: number; visits: number; sale: number; lastVisit: string }>;
  filters: { reps: string[]; dates: string[] };
  freshness: { syncedAt: string | null; through: string | null; latestRunCompletedAt: string | null; latestRunRows: number | null };
  definitions: { coverage: string; time: string };
}

type AttentionFilter = "all" | "late" | "on-time";

interface RepVisit {
  date: string; pop: string; distributor: string | null; startTime: string; endTime: string | null;
  timeInOutlet: string | null; transitTime: string | null; lppc: number | null; sale: number;
}

interface RepDetail { rep: string; month: string; date: string | null; visits: RepVisit[]; definition: string }

const fmt = (value: number, digits = 0) => value.toLocaleString("en-KE", { maximumFractionDigits: digits });
const money = (value: number) => value.toLocaleString("en-KE", { style: "currency", currency: "KES", notation: "compact", maximumFractionDigits: 1 });
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const timeLabel = (value: string | null) => value ? new Intl.DateTimeFormat("en-KE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(value)) : "—";
const syncLabel = (value: string | null) => value ? new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "Awaiting sync";

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface p-3 shadow-[0_2px_8px_rgba(11,61,53,0.05)]"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{icon}{label}</div><p className="mt-2 text-xl font-bold tabular-nums text-brand-navy">{value}</p></div>;
}

function startBadge(value: string) {
  const late = upfieldFirstTransactionStatus(value) === "late";
  return <span className={`inline-flex items-center gap-1 font-semibold ${late ? "text-accent-red" : "text-accent-green"}`}><span aria-hidden>{late ? "⚠" : "✓"}</span>{timeLabel(value)}</span>;
}

function closingRemark(row: RepDay) {
  const status = upfieldClosingStatus(row.date, row.lastActivity);
  if (status === "day-in-progress") return <span className="text-muted">Day still in progress</span>;
  if (status === "closed-early") return <span className="font-semibold text-accent-red">Last activity before 4:00 PM</span>;
  if (status === "closed-on-time") return <span className="font-semibold text-accent-green">Last activity at/after 4:00 PM</span>;
  return <span className="text-muted">Not assessed</span>;
}

function RepVisitDrawer({ rep, month, dates, initialDate, close }: { rep: string; month: string; dates: string[]; initialDate: string; close: () => void }) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [detail, setDetail] = useState<RepDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedOutlets, setExpandedOutlets] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ rep, month });
    if (selectedDate) params.set("date", selectedDate);
    setLoading(true);
    fetch(`/api/upfield-visits/rep-detail?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<RepDetail>; })
      .then((body) => { if (!controller.signal.aborted) setDetail(body); })
      .catch((error) => { if (!controller.signal.aborted && (error as Error).name !== "AbortError") setDetail(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [rep, month, selectedDate]);

  const outlets = useMemo(() => {
    const grouped = new Map<string, { pop: string; visits: RepVisit[] }>();
    for (const visit of detail?.visits ?? []) {
      const outlet = grouped.get(visit.pop) ?? { pop: visit.pop, visits: [] };
      outlet.visits.push(visit); grouped.set(visit.pop, outlet);
    }
    return [...grouped.entries()].sort((a, b) => a[1].pop.localeCompare(b[1].pop));
  }, [detail]);
  const allExpanded = outlets.length > 0 && outlets.every(([key]) => expandedOutlets.has(key));
  const totals = (detail?.visits ?? []).reduce((acc, row) => ({ visits: acc.visits + 1, withSale: acc.withSale + (row.sale > 0 ? 1 : 0), sale: acc.sale + row.sale, open: acc.open + (row.endTime ? 0 : 1) }), { visits: 0, withSale: 0, sale: 0, open: 0 });

  return <div className={`fixed inset-0 z-50 flex bg-brand-navy/35 ${expanded ? "justify-center" : "justify-end sm:p-4"}`} role="dialog" aria-modal="true" aria-label={`${rep} visit detail`}>
    <button className="absolute inset-0 cursor-default" aria-label="Close rep visit detail" onClick={close} />
    <aside className={`relative flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl ${expanded ? "max-w-none" : "max-w-5xl sm:rounded-2xl"}`}>
      <header className="flex items-start justify-between border-b border-border bg-surface px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-primary-blue">Upfield outlet visit journey</p><h2 className="mt-1 text-xl font-bold text-brand-navy">{rep}</h2><p className="mt-1 text-xs text-muted">Browse check-in/check-out evidence by outlet · Timestamp Report, not sales documents</p></div><div className="flex gap-2"><button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-surface-active">{expanded ? "Compact view" : "Expand view"}</button><button type="button" onClick={close} className="rounded-full border border-border p-2 text-muted hover:bg-surface-active" aria-label="Close"><Dismiss12Regular /></button></div></header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-background-elevated/40 p-3"><label className="text-xs font-semibold text-muted">Visit date<select value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setExpandedOutlets(new Set()); }} className="mt-1 block min-w-[220px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All dates in {month}</option>{dates.map((value) => <option key={value} value={value}>{dateLabel(value)}</option>)}</select></label><button type="button" onClick={() => setExpandedOutlets(allExpanded ? new Set() : new Set(outlets.map(([key]) => key)))} className="rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-surface-hover">{allExpanded ? "Collapse all outlets" : "Expand all outlets"}</button></div>
        {!loading && detail ? <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Outlets" value={fmt(outlets.length)} icon={<BuildingShop20Regular />} /><Metric label="Visits" value={fmt(totals.visits)} icon={<Clock20Regular />} /><Metric label="Open (no check-out)" value={fmt(totals.open)} icon={<Clock20Regular />} /><Metric label="Sale" value={money(totals.sale)} icon={<Money20Regular />} /></div> : null}
        {loading ? <p className="py-16 text-center text-sm text-muted">Loading outlet visits…</p> : null}
        {!loading && !detail ? <p className="py-16 text-center text-sm text-accent-red">Couldn&apos;t load this rep&apos;s visit detail.</p> : null}
        {!loading && detail && outlets.length === 0 ? <p className="py-16 text-center text-sm text-muted">No visits match this date.</p> : null}
        {!loading && detail ? <div className="flex flex-col gap-2">{outlets.map(([key, outlet]) => { const isOpen = expandedOutlets.has(key); const sale = outlet.visits.reduce((sum, row) => sum + row.sale, 0); return <section key={key} className="overflow-hidden rounded-xl border border-border bg-surface"><button type="button" onClick={() => setExpandedOutlets((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover"><span><span className="font-semibold text-brand-navy">{isOpen ? "▾" : "▸"} {outlet.pop}</span><span className="block pl-4 text-[11px] text-muted">{outlet.visits.length} visit(s)</span></span><span className="font-semibold tabular-nums text-brand-navy">{money(sale)}</span></button>{isOpen ? <TableWrap><Thead><Th>Date</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Time in outlet</Th><Th>Transit</Th><Th align="right">LPPC</Th><Th align="right">Sale</Th></Thead><tbody>{outlet.visits.map((visit, index) => <tr key={`${visit.date}-${visit.startTime}-${index}`}><Td>{dateLabel(visit.date)}</Td><Td>{timeLabel(visit.startTime)}</Td><Td>{visit.endTime ? timeLabel(visit.endTime) : <span className="text-accent-red">Not checked out</span>}</Td><Td>{visit.timeInOutlet ?? "—"}</Td><Td>{visit.transitTime ?? "—"}</Td><Td align="right">{visit.lppc == null ? "—" : fmt(visit.lppc, 1)}</Td><Td align="right">{money(visit.sale)}</Td></tr>)}</tbody></TableWrap> : null}</section>; })}</div> : null}
      </div>
    </aside>
  </div>;
}

export default function UpfieldVisitsPage() {
  const [month, setMonth] = useState(() => recentMonthOptions(new Date(), 6)[0]);
  const [selectedDate, setSelectedDate] = useState("");
  const [rep, setRep] = useState("");
  const [attention, setAttention] = useState<AttentionFilter>("all");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
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
    if (rep) params.set("rep", rep);
    setLoading(true); setError(false);
    fetch(`/api/upfield-visits/summary?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Failed to load Upfield Outlet Visits"); return response.json() as Promise<Summary>; })
      .then((body) => { if (!controller.signal.aborted) setSummary(body); })
      .catch((caught) => { if (!controller.signal.aborted && (caught as Error).name !== "AbortError") setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, selectedDate, rep, refreshTick]);

  const statusCounts = useMemo(() => ({
    late: summary?.repDays.filter((row) => upfieldFirstTransactionStatus(row.firstVisit) === "late").length ?? 0,
    onTime: summary?.repDays.filter((row) => upfieldFirstTransactionStatus(row.firstVisit) !== "late").length ?? 0,
  }), [summary]);

  const visibleRepDays = useMemo(() => {
    const rows = (summary?.repDays ?? []).filter((row) => attention === "all" || upfieldFirstTransactionStatus(row.firstVisit) === attention);
    return [...rows].sort((a, b) => {
      const aLate = upfieldFirstTransactionStatus(a.firstVisit) === "late";
      const bLate = upfieldFirstTransactionStatus(b.firstVisit) === "late";
      if (aLate !== bLate) return aLate ? -1 : 1;
      const aMinutes = upfieldMinutesAfterMidnight(a.firstVisit) ?? 0;
      const bMinutes = upfieldMinutesAfterMidnight(b.firstVisit) ?? 0;
      if (aMinutes !== bMinutes) return aLate ? bMinutes - aMinutes : aMinutes - bMinutes;
      return b.date.localeCompare(a.date) || a.rep.localeCompare(b.rep);
    });
  }, [summary, attention]);

  if (loading && !summary) return <FullPageSpinner label="Loading Upfield outlet visit timestamps..." />;
  if (error || !summary) return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Upfield Outlet Visits is unavailable" description="The Timestamp Report rows could not be loaded from Postgres. Refresh once the latest 4x-daily sync completes." />;
  const metrics = summary.metrics;

  return <main className="flex w-full max-w-none flex-col gap-4 px-3 py-4 sm:px-4 lg:px-5">
    <SfaReportNavigator current="upfield-visits" />
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/timestamps" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-blue hover:underline"><ArrowLeft20Regular className="h-4 w-4" /> All timestamp systems</Link><h1 className="mt-2 text-2xl font-bold text-brand-navy">Upfield · Outlet Visits</h1><p className="mt-1 text-sm text-muted">FSR check-in/check-out, transit time, and per-visit sale from the Timestamp Report (Outlet Visit Detail).</p></div>
      <div className="flex flex-wrap gap-2"><span className="rounded-full bg-accent-blue-soft px-3 py-1 text-xs font-semibold text-primary-blue">4x daily · 10:00/12:00/17:00/20:00</span><span className="rounded-full bg-accent-blue-soft px-3 py-1 text-xs font-semibold text-primary-blue">Synced {syncLabel(summary.freshness.syncedAt)}</span></div>
    </div>

    <section className="grid gap-3 rounded-xl border border-border bg-background-elevated/40 p-3 sm:grid-cols-3">
      <label className="text-xs font-semibold text-muted">Month<select value={month} onChange={(event) => { setMonth(event.target.value); setSelectedDate(""); setRep(""); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy">{recentMonthOptions(new Date(), 6).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted">Date<select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All dates in month</option>{summary.filters.dates.map((value) => <option key={value} value={value}>{dateLabel(value)}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted">Sales representative<select value={rep} onChange={(event) => setRep(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All representatives</option>{summary.filters.reps.map((value) => <option key={value}>{value}</option>)}</select></label>
    </section>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Metric label="Visits" value={fmt(metrics.visits)} icon={<Clock20Regular />} /><Metric label="Outlets visited" value={fmt(metrics.outlets)} icon={<BuildingShop20Regular />} /><Metric label="Active reps" value={fmt(metrics.reps)} icon={<PeopleTeam20Regular />} /><Metric label="Sale" value={money(metrics.sale)} icon={<Money20Regular />} /><Metric label="Visits with sale" value={fmt(metrics.visitsWithSale)} icon={<Money20Regular />} /><Metric label="Open (no check-out)" value={fmt(metrics.open)} icon={<VehicleCar20Regular />} />
    </div>

    <section className="rounded-xl border border-border bg-surface p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-brand-navy">Time management</h2><p className="text-[11px] text-muted">Upfield benchmark: first recorded check-in at 8:00 AM or earlier · last activity at/after 4:00 PM · closing feedback applies only after the day elapses</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setAttention("all")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "all" ? "bg-brand-navy text-white" : "bg-background-elevated text-brand-navy"}`}>All rep-days ({summary.repDays.length})</button><button onClick={() => setAttention("late")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "late" ? "bg-accent-red text-white" : "bg-accent-red-soft text-accent-red"}`}>⚠ Needs attention ({statusCounts.late})</button><button onClick={() => setAttention("on-time")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "on-time" ? "bg-accent-green text-white" : "bg-accent-green-soft text-accent-green"}`}>👍 Thumbs Up ({statusCounts.onTime})</button></div></div></section>

    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Visits by time" action={<span className="text-xs text-muted">Check-ins and outlets visited by Nairobi hour</span>}><ResponsiveContainer width="100%" height={270}><BarChart data={summary.hourly.map((row) => ({ ...row, label: `${String(row.hour).padStart(2, "0")}:00` }))}><CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={10} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Legend /><Bar dataKey="visits" name="Visits" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} /><Bar dataKey="outlets" name="Outlets visited" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></SectionCard>
      <SectionCard title="Daily visit coverage" action={<span className="text-xs text-muted">Unique outlets visited and total visits</span>}><ResponsiveContainer width="100%" height={270}><LineChart data={summary.daily.map((row) => ({ ...row, label: dateLabel(row.date) }))}><CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={10} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Legend /><Line type="monotone" dataKey="outlets" name="Outlets visited" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} /><Line type="monotone" dataKey="visits" name="Visits" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></SectionCard>
    </div>

    <SectionCard title="Rep Daily Summary" action={<span className="text-xs text-muted">Attention rows are ranked first · open a rep for outlet-visit evidence</span>}><TableWrap><Thead><Th>Date</Th><Th>Sales rep</Th><Th>First check-in</Th><Th>Start status</Th><Th>Last activity</Th><Th>Closing remark</Th><Th align="right">Visits</Th><Th align="right">Outlets</Th><Th align="right">Sale</Th></Thead><tbody>{visibleRepDays.map((row) => { const late = upfieldFirstTransactionStatus(row.firstVisit) === "late"; return <tr key={`${row.date}-${row.rep}`}><Td>{dateLabel(row.date)}</Td><Td><button type="button" onClick={() => setActiveRep(row.rep)} className="font-semibold text-primary-blue hover:underline">{row.rep}</button></Td><Td>{startBadge(row.firstVisit)}</Td><Td><span className={`font-semibold ${late ? "text-accent-red" : "text-accent-green"}`}>{late ? "Needs attention" : "On time"}</span></Td><Td>{timeLabel(row.lastActivity)}</Td><Td>{closingRemark(row)}</Td><Td align="right">{fmt(row.visits)}</Td><Td align="right">{fmt(row.outlets)}</Td><Td align="right">{money(row.sale)}</Td></tr>; })}</tbody></TableWrap></SectionCard>

    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Visit coverage by rep" action={<span className="text-xs text-muted">Coverage counts every visited outlet · click a rep to drill down</span>}><TableWrap><Thead><Th>Sales rep</Th><Th align="right">Active days</Th><Th align="right">Unique outlets</Th><Th align="right">Outlet-days</Th><Th align="right">Avg/day</Th><Th align="right">Visits</Th><Th align="right">Sale</Th></Thead><tbody>{summary.coverage.map((row) => <tr key={row.rep}><Td><button type="button" onClick={() => setActiveRep(row.rep)} className="font-semibold text-primary-blue hover:underline">{row.rep}</button></Td><Td align="right">{fmt(row.activeDays)}</Td><Td align="right">{fmt(row.outlets)}</Td><Td align="right">{fmt(row.outletDays)}</Td><Td align="right">{fmt(row.averageOutletsPerDay, 1)}</Td><Td align="right">{fmt(row.visits)}</Td><Td align="right">{money(row.sale)}</Td></tr>)}</tbody></TableWrap></SectionCard>
      <SectionCard title="Most visited outlets" action={<span className="text-xs text-muted">Top 25 by active days, then sale</span>}><TableWrap><Thead><Th>Outlet (POP)</Th><Th align="right">Days visited</Th><Th align="right">Reps</Th><Th align="right">Visits</Th><Th align="right">Sale</Th><Th>Last visit</Th></Thead><tbody>{summary.outlets.map((row) => <tr key={row.pop}><Td><span className="font-semibold text-brand-navy">{row.pop}</span></Td><Td align="right">{fmt(row.activeDays)}</Td><Td align="right">{fmt(row.reps)}</Td><Td align="right">{fmt(row.visits)}</Td><Td align="right">{money(row.sale)}</Td><Td>{timeLabel(row.lastVisit)}</Td></tr>)}</tbody></TableWrap></SectionCard>
    </div>

    <section className="rounded-xl border border-border bg-background-elevated/45 px-4 py-3 text-xs text-muted"><strong className="text-brand-navy">Metric boundary:</strong> {summary.definitions.coverage} {summary.definitions.time} This is the Outlet Visit Detail feed — for sales/return document totals, see Upfield DataEdge · Timestamp &amp; Coverage instead.</section>
    {activeRep ? <RepVisitDrawer rep={activeRep} month={month} dates={summary.filters.dates} initialDate={selectedDate} close={() => setActiveRep(null)} /> : null}
  </main>;
}
