"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft20Regular, BuildingShop20Regular, Clock20Regular, Money20Regular, PeopleTeam20Regular, Receipt20Regular } from "@fluentui/react-icons";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { SfaReportNavigator } from "@/components/timestamps/SfaReportNavigator";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionCard } from "@/components/ui/KpiGrid";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { closingStatus, firstCallStatus, nairobiMinutesAfterMidnight, recentMonthOptions } from "@/lib/timeManagement";

interface RepDay {
  date: string; rep: string; firstTransaction: string; lastTransaction: string; hoursInTrade: number;
  invoices: number; outlets: number; lines: number; netSales: number; units: number; averageInterval: number | null;
}

interface Summary {
  scope: string; month: string;
  metrics: { lines: number; invoices: number; outlets: number; reps: number; netSales: number; units: number; returnsValue: number; averageInterval: number | null; lastDataAt: string | null };
  daily: Array<{ date: string; invoices: number; outlets: number; reps: number; netSales: number; units: number }>;
  hourly: Array<{ hour: number; invoices: number; outlets: number; netSales: number }>;
  repDays: RepDay[];
  coverage: Array<{ rep: string; activeDays: number; outlets: number; outletDays: number; averageOutletsPerDay: number; invoices: number; netSales: number; units: number }>;
  customers: Array<{ customerCode: string; customerName: string; activeDays: number; reps: number; invoices: number; netSales: number; units: number; lastTransaction: string }>;
  filters: { reps: string[]; dates: string[] };
  freshness: { syncedAt: string | null; through: string | null; latestRunCompletedAt: string | null; latestRunRows: number | null };
  definitions: { coverage: string; time: string };
}

type AttentionFilter = "all" | "late" | "on-time";

const fmt = (value: number, digits = 0) => value.toLocaleString("en-KE", { maximumFractionDigits: digits });
const money = (value: number) => value.toLocaleString("en-KE", { style: "currency", currency: "KES", notation: "compact", maximumFractionDigits: 1 });
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const timeLabel = (value: string | null) => value ? new Intl.DateTimeFormat("en-KE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(value)) : "—";
const syncLabel = (value: string | null) => value ? new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "Awaiting sync";

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface p-3 shadow-[0_2px_8px_rgba(11,61,53,0.05)]"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{icon}{label}</div><p className="mt-2 text-xl font-bold tabular-nums text-brand-navy">{value}</p></div>;
}

function startBadge(value: string) {
  const late = firstCallStatus(value) === "late";
  return <span className={`inline-flex items-center gap-1 font-semibold ${late ? "text-accent-red" : "text-accent-green"}`}><span aria-hidden>{late ? "⚠" : "✓"}</span>{timeLabel(value)}</span>;
}

function closingRemark(row: RepDay) {
  const status = closingStatus(row.date, row.lastTransaction);
  if (status === "day-in-progress") return <span className="text-muted">Day still in progress</span>;
  if (status === "closed-early") return <span className="font-semibold text-accent-red">Closed before 4:00 PM</span>;
  if (status === "closed-on-time") return <span className="font-semibold text-accent-green">Closed at/after 4:00 PM</span>;
  return <span className="text-muted">Not assessed</span>;
}

export default function UpfieldTimestampPage() {
  const [month, setMonth] = useState(() => recentMonthOptions(new Date(), 6)[0]);
  const [selectedDate, setSelectedDate] = useState("");
  const [rep, setRep] = useState("");
  const [attention, setAttention] = useState<AttentionFilter>("all");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
    fetch(`/api/upfield-timestamps/summary?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Failed to load Upfield report"); return response.json() as Promise<Summary>; })
      .then((body) => { if (!controller.signal.aborted) setSummary(body); })
      .catch((caught) => { if (!controller.signal.aborted && (caught as Error).name !== "AbortError") setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, selectedDate, rep, refreshTick]);

  const statusCounts = useMemo(() => ({
    late: summary?.repDays.filter((row) => firstCallStatus(row.firstTransaction) === "late").length ?? 0,
    onTime: summary?.repDays.filter((row) => firstCallStatus(row.firstTransaction) !== "late").length ?? 0,
  }), [summary]);

  const visibleRepDays = useMemo(() => {
    const rows = (summary?.repDays ?? []).filter((row) => attention === "all" || firstCallStatus(row.firstTransaction) === attention);
    return [...rows].sort((a, b) => {
      const aLate = firstCallStatus(a.firstTransaction) === "late";
      const bLate = firstCallStatus(b.firstTransaction) === "late";
      if (aLate !== bLate) return aLate ? -1 : 1;
      const aMinutes = nairobiMinutesAfterMidnight(a.firstTransaction) ?? 0;
      const bMinutes = nairobiMinutesAfterMidnight(b.firstTransaction) ?? 0;
      if (aMinutes !== bMinutes) return aLate ? bMinutes - aMinutes : aMinutes - bMinutes;
      return b.date.localeCompare(a.date) || a.rep.localeCompare(b.rep);
    });
  }, [summary, attention]);

  if (loading && !summary) return <FullPageSpinner label="Loading Upfield DataEdge timestamps..." />;
  if (error || !summary) return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Upfield Timestamp and Coverage is unavailable" description="The DataEdge rows could not be loaded from Postgres. Refresh once the latest sync completes." />;
  const metrics = summary.metrics;

  return <main className="mx-auto flex max-w-[1700px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
    <SfaReportNavigator current="Upfield" />
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/timestamps" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-blue hover:underline"><ArrowLeft20Regular className="h-4 w-4" /> All timestamp systems</Link><h1 className="mt-2 text-2xl font-bold text-brand-navy">Upfield DataEdge · Timestamp &amp; Coverage</h1><p className="mt-1 text-sm text-muted">First/last sales transaction monitoring and productive outlet coverage from the five-minute DataEdge sync.</p></div>
      <div className="flex flex-wrap gap-2"><span className="rounded-full bg-accent-green-soft px-3 py-1 text-xs font-semibold text-accent-green">Live every 5 minutes</span><span className="rounded-full bg-accent-blue-soft px-3 py-1 text-xs font-semibold text-primary-blue">Synced {syncLabel(summary.freshness.syncedAt)}</span></div>
    </div>

    <section className="grid gap-3 rounded-xl border border-border bg-background-elevated/40 p-3 sm:grid-cols-3">
      <label className="text-xs font-semibold text-muted">Month<select value={month} onChange={(event) => { setMonth(event.target.value); setSelectedDate(""); setRep(""); }} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy">{recentMonthOptions(new Date(), 6).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted">Date<select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All dates in month</option>{summary.filters.dates.map((value) => <option key={value} value={value}>{dateLabel(value)}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted">Sales representative<select value={rep} onChange={(event) => setRep(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-navy"><option value="">All representatives</option>{summary.filters.reps.map((value) => <option key={value}>{value}</option>)}</select></label>
    </section>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <Metric label="Invoices" value={fmt(metrics.invoices)} icon={<Receipt20Regular />} /><Metric label="Productive outlets" value={fmt(metrics.outlets)} icon={<BuildingShop20Regular />} /><Metric label="Active reps" value={fmt(metrics.reps)} icon={<PeopleTeam20Regular />} /><Metric label="Net sales" value={money(metrics.netSales)} icon={<Money20Regular />} /><Metric label="Net units" value={fmt(metrics.units)} icon={<Receipt20Regular />} /><Metric label="Return value" value={money(metrics.returnsValue)} icon={<Money20Regular />} /><Metric label="Avg interval" value={metrics.averageInterval == null ? "—" : `${fmt(metrics.averageInterval)}m`} icon={<Clock20Regular />} /><Metric label="Data lines" value={fmt(metrics.lines)} icon={<Receipt20Regular />} />
    </div>

    <section className="rounded-xl border border-border bg-surface p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-brand-navy">Time management</h2><p className="text-[11px] text-muted">On time: first transaction at 9:30 AM or earlier · closing feedback applies only after the day elapses</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setAttention("all")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "all" ? "bg-brand-navy text-white" : "bg-background-elevated text-brand-navy"}`}>All rep-days ({summary.repDays.length})</button><button onClick={() => setAttention("late")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "late" ? "bg-accent-red text-white" : "bg-accent-red-soft text-accent-red"}`}>⚠ Needs attention ({statusCounts.late})</button><button onClick={() => setAttention("on-time")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${attention === "on-time" ? "bg-accent-green text-white" : "bg-accent-green-soft text-accent-green"}`}>👍 Thumbs Up ({statusCounts.onTime})</button></div></div></section>

    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Transactions by time" action={<span className="text-xs text-muted">Sales invoices and productive outlets by Nairobi hour</span>}><ResponsiveContainer width="100%" height={270}><BarChart data={summary.hourly.map((row) => ({ ...row, label: `${String(row.hour).padStart(2, "0")}:00` }))}><CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={10} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Legend /><Bar dataKey="invoices" name="Invoices" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} /><Bar dataKey="outlets" name="Productive outlets" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></SectionCard>
      <SectionCard title="Daily productive coverage" action={<span className="text-xs text-muted">Unique buying outlets and invoices</span>}><ResponsiveContainer width="100%" height={270}><LineChart data={summary.daily.map((row) => ({ ...row, label: dateLabel(row.date) }))}><CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={10} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Legend /><Line type="monotone" dataKey="outlets" name="Productive outlets" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} /><Line type="monotone" dataKey="invoices" name="Invoices" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></SectionCard>
    </div>

    <SectionCard title="Rep Daily Summary" action={<span className="text-xs text-muted">Attention rows are ranked first</span>}><TableWrap><Thead><Th>Date</Th><Th>Sales rep</Th><Th>First transaction</Th><Th>Start status</Th><Th>Last transaction</Th><Th>Closing remark</Th><Th align="right">Hours</Th><Th align="right">Invoices</Th><Th align="right">Outlets</Th><Th align="right">Avg interval</Th><Th align="right">Net sales</Th><Th align="right">Units</Th></Thead><tbody>{visibleRepDays.map((row) => { const late = firstCallStatus(row.firstTransaction) === "late"; return <tr key={`${row.date}-${row.rep}`}><Td>{dateLabel(row.date)}</Td><Td><button type="button" onClick={() => setRep(row.rep)} className="font-semibold text-primary-blue hover:underline">{row.rep}</button></Td><Td>{startBadge(row.firstTransaction)}</Td><Td><span className={`font-semibold ${late ? "text-accent-red" : "text-accent-green"}`}>{late ? "Needs attention" : "On time"}</span></Td><Td>{timeLabel(row.lastTransaction)}</Td><Td>{closingRemark(row)}</Td><Td align="right">{row.hoursInTrade.toFixed(1)}</Td><Td align="right">{fmt(row.invoices)}</Td><Td align="right">{fmt(row.outlets)}</Td><Td align="right">{row.averageInterval == null ? "—" : `${fmt(row.averageInterval)}m`}</Td><Td align="right">{money(row.netSales)}</Td><Td align="right">{fmt(row.units)}</Td></tr>; })}</tbody></TableWrap></SectionCard>

    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Productive coverage by rep" action={<span className="text-xs text-muted">Coverage counts positive-sale outlets only</span>}><TableWrap><Thead><Th>Sales rep</Th><Th align="right">Active days</Th><Th align="right">Unique outlets</Th><Th align="right">Outlet-days</Th><Th align="right">Avg/day</Th><Th align="right">Invoices</Th><Th align="right">Net sales</Th></Thead><tbody>{summary.coverage.map((row) => <tr key={row.rep}><Td><button type="button" onClick={() => setRep(row.rep)} className="font-semibold text-primary-blue hover:underline">{row.rep}</button></Td><Td align="right">{fmt(row.activeDays)}</Td><Td align="right">{fmt(row.outlets)}</Td><Td align="right">{fmt(row.outletDays)}</Td><Td align="right">{fmt(row.averageOutletsPerDay, 1)}</Td><Td align="right">{fmt(row.invoices)}</Td><Td align="right">{money(row.netSales)}</Td></tr>)}</tbody></TableWrap></SectionCard>
      <SectionCard title="Most consistently served outlets" action={<span className="text-xs text-muted">Top 25 by active days, then sales</span>}><TableWrap><Thead><Th>Outlet</Th><Th align="right">Days served</Th><Th align="right">Reps</Th><Th align="right">Invoices</Th><Th align="right">Net sales</Th><Th>Last transaction</Th></Thead><tbody>{summary.customers.map((row) => <tr key={`${row.customerCode}-${row.customerName}`}><Td><span className="font-semibold text-brand-navy">{row.customerName}</span><span className="block text-[11px] text-muted">{row.customerCode}</span></Td><Td align="right">{fmt(row.activeDays)}</Td><Td align="right">{fmt(row.reps)}</Td><Td align="right">{fmt(row.invoices)}</Td><Td align="right">{money(row.netSales)}</Td><Td>{timeLabel(row.lastTransaction)}</Td></tr>)}</tbody></TableWrap></SectionCard>
    </div>

    <section className="rounded-xl border border-border bg-background-elevated/45 px-4 py-3 text-xs text-muted"><strong className="text-brand-navy">Metric boundary:</strong> {summary.definitions.coverage} {summary.definitions.time} DataEdge does not contain unproductive calls or journey plans, so strike rate and JP adherence are intentionally not shown.</section>
  </main>;
}
