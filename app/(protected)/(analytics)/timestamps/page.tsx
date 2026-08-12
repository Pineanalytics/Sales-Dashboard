"use client";

import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock20Regular, Dismiss12Regular, PeopleTeam20Regular, ThumbLike20Regular, Warning20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { PrincipalSelector } from "@/components/dashboard/PrincipalSelector";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { RoleToggle, type RoleFilter } from "@/components/ui/RoleToggle";
import { formatCompact, formatNumber, formatPercent, strikeRateTier, tierBarColor } from "@/lib/format";
import {
  averageMinutes,
  closingStatus,
  closingStatusForMinutes,
  compareTimeManagementRows,
  firstCallStatus,
  isoFromNairobiMinutes,
  nairobiMinutesAfterMidnight,
  recentMonthOptions,
  type ClosingStatus,
  type TimeManagementStatus,
} from "@/lib/timeManagement";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

interface RoleStats {
  totalCalls: number;
  productiveCalls: number;
  strikeRate: number;
  outletsCovered: number;
  avgIntervalMins: number | null;
  sales: number;
  qty: number;
  cases: number | null;
}

interface RepDaySummary {
  date: string;
  employeeCode: string;
  salesRep: string;
  region: string;
  salesRole: string;
  firstCall: string;
  lastCall: string;
  hoursInDay: number;
  callsMade: number;
  productiveCalls: number;
  strikeRatePct: number;
  outletsCovered: number;
  avgIntervalMins: number | null;
  sales: number;
  qty: number;
  cases: number | null;
}

interface ChartRow {
  bucket: number | string;
  salesRole: string;
  calls: number;
}

interface RepMonthlyAverageRow extends RepDaySummary {
  daysWorked: number;
}

interface RepProductivityRow {
  employeeCode: string;
  salesRep: string;
  region: string;
  salesRole: string;
  callsMade: number;
  productiveCalls: number;
  strikeRatePct: number;
  outletsCovered: number;
  productiveDays: number;
  sales: number;
  qty: number;
  cases: number | null;
}

interface UnmappedEmployee {
  employeeCode: string;
  salesRep: string;
  callsThisMonth: number;
}

interface TimestampSummaryResponse {
  availableDates: string[];
  availableReps: { employeeCode: string; salesRep: string }[];
  availableRegions: string[];
  availableTeamLeaders: string[];
  primaryStats: RoleStats;
  secondaryStats: RoleStats;
  overall: RoleStats;
  summaries: RepDaySummary[];
  chartRows: ChartRow[];
  unmappedEmployees: UnmappedEmployee[];
  syncUpdatedAt: string | null;
}

interface RepDetailTrend {
  label: string;
  calls: number;
  productiveCalls: number;
  outletsCovered: number;
  sales: number;
  qty: number;
  cases: number | null;
}

interface RepOutletVisit {
  date: string;
  callTime: string;
  callSequence: number;
  outletName: string;
  channel: string;
  territory: string;
  callOutcome: "Sale" | "No Sale";
  documents: number;
  sales: number;
  qty: number;
  cases: number | null;
  intervalMins: number | null;
  noSaleReason: string | null;
}

interface RepDetailResponse {
  rep: { employeeCode: string; salesRep: string; region: string; salesRole: string } | null;
  overall: RoleStats;
  dailyTrend: RepDetailTrend[];
  weeklyTrend: RepDetailTrend[];
  visits: RepOutletVisit[];
}

type TimeManagementFilter = "all" | "attention" | "thumbs-up";
type TimestampSlide = "overview" | "reps" | "time";

const SUMMARY_PAGE_SIZE = 50;

function formatTime12h(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "Africa/Nairobi", hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00.000Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short" });
}

function formatMonthLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00.000Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Nairobi", month: "long", year: "numeric" });
}

function formatCases(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} cs`;
}

function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${period}`;
}

function timeStatusLabel(status: TimeManagementStatus): string {
  if (status === "late") return "Needs attention";
  if (status === "on-time") return "On time";
  return "Grace window";
}

function timeStatusClass(status: TimeManagementStatus): string {
  if (status === "late") return "text-red-600";
  if (status === "on-time") return "text-emerald-600";
  return "text-muted";
}

function closingStatusLabel(status: ClosingStatus): string {
  if (status === "closed-early") return "Closed before 4:00 PM";
  if (status === "closed-on-time") return "Closed 4:00 PM+";
  if (status === "day-in-progress") return "Day still in progress";
  if (status === "not-due") return "Not due yet";
  return "Time unavailable";
}

function closingStatusClass(status: ClosingStatus): string {
  if (status === "closed-early") return "text-red-600";
  if (status === "closed-on-time") return "text-emerald-600";
  return "text-muted";
}

function strikeRateTextClass(strikeRate: number): string {
  const tier = strikeRateTier(strikeRate);
  if (tier === "good") return "text-emerald-600";
  if (tier === "warn") return "text-amber-600";
  return "text-red-600";
}

function StrikeRateBadge({ strikeRate }: { strikeRate: number }) {
  const tier = strikeRateTier(strikeRate);
  const className = tier === "good"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tier === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
  return <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${className}`}>{strikeRate.toFixed(1)}%</span>;
}

/** A rep with real calls this month but no Employee Roaster row at all —
 *  a genuinely new employee not yet onboarded into either roster source
 *  (F:\Raw Reports\Employee Roaster.xlsx or Employee roaster.csv). Surfaced
 *  here so whoever maintains the roster has a direct worklist instead of a
 *  gap only discoverable by SQL — see lib/timestampSummary.ts's
 *  UnmappedTimestampEmployee. This month's window only, independent of the
 *  page's own date/region/rep/role filters above — a standing note, not
 *  something that disappears the moment you filter to a single day. */
function UnmappedEmployeesNote({ unmappedEmployees }: { unmappedEmployees: UnmappedEmployee[] }) {
  if (unmappedEmployees.length === 0) return null;
  return (
    <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <Warning20Regular className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" />
      {unmappedEmployees.length} employee(s) with real Timestamps activity this month aren&apos;t in the roster yet (shown as &quot;General&quot;) — largest:{" "}
      {unmappedEmployees
        .slice(0, 5)
        .map((u) => `${u.salesRep} (${u.employeeCode}, ${u.callsThisMonth} calls)`)
        .join(", ")}
      .
    </p>
  );
}

function chartBuckets(rows: ChartRow[], granularity: "Hourly" | "Daily" | "Weekly") {
  if (granularity === "Hourly") {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ name: hourLabel(hour), Primary: 0, Secondary: 0 }));
    rows.forEach((row) => {
      const hour = Number(row.bucket);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
      if (row.salesRole === "Primary Sales") buckets[hour].Primary += row.calls;
      else buckets[hour].Secondary += row.calls;
    });
    return buckets;
  }

  const byBucket = new Map<string, { name: string; Primary: number; Secondary: number }>();
  rows.forEach((row) => {
    const key = String(row.bucket);
    const name = granularity === "Daily" ? formatDateLabel(key) : `Week ${key}`;
    const bucket = byBucket.get(key) ?? { name, Primary: 0, Secondary: 0 };
    if (row.salesRole === "Primary Sales") bucket.Primary += row.calls;
    else bucket.Secondary += row.calls;
    byBucket.set(key, bucket);
  });
  return Array.from(byBucket.entries())
    .sort(([a], [b]) => (granularity === "Daily" ? a.localeCompare(b) : Number(a) - Number(b)))
    .map(([, bucket]) => bucket);
}

/** Rolls the already-filtered rep-day summaries (already scoped by every active
 *  filter — month/date/rep/region/team leader/role — server-side) up to one row
 *  per rep, so Productive Days sits directly alongside the same Calls Made/
 *  Strike Rate/Outlets/Sales figures the day-grain table below already shows,
 *  rather than only appearing as a single aggregate number. */
function buildRepProductivitySummary(summaries: RepDaySummary[]): RepProductivityRow[] {
  const byRep = new Map<string, Omit<RepProductivityRow, "cases"> & { cases: number; casesKnown: boolean; productiveDates: Set<string> }>();
  for (const row of summaries) {
    const existing = byRep.get(row.employeeCode) ?? {
      employeeCode: row.employeeCode,
      salesRep: row.salesRep,
      region: row.region,
      salesRole: row.salesRole,
      callsMade: 0,
      productiveCalls: 0,
      strikeRatePct: 0,
      outletsCovered: 0,
      productiveDays: 0,
      sales: 0,
      qty: 0,
      cases: 0,
      casesKnown: true,
      productiveDates: new Set<string>(),
    };
    existing.callsMade += row.callsMade;
    existing.productiveCalls += row.productiveCalls;
    existing.outletsCovered += row.outletsCovered;
    existing.sales += row.sales;
    existing.qty += row.qty;
    if (row.cases === null) existing.casesKnown = false;
    else existing.cases += row.cases;
    if (row.productiveCalls > 0) existing.productiveDates.add(row.date);
    byRep.set(row.employeeCode, existing);
  }
  return Array.from(byRep.values())
    .map(({ productiveDates, casesKnown, ...rest }) => ({
      ...rest,
      cases: casesKnown ? rest.cases : null,
      strikeRatePct: rest.callsMade > 0 ? Math.round((rest.productiveCalls / rest.callsMade) * 1000) / 10 : 0,
      productiveDays: productiveDates.size,
    }))
    .sort((a, b) => b.productiveDays - a.productiveDays || b.strikeRatePct - a.strikeRatePct);
}

/** Rolls day-grain rep summaries up to one row per rep with First Call/Last
 *  Call averaged (mean of each day's Nairobi clock time, not whichever day
 *  happens to sort first) — used whenever no single date is selected, so a
 *  full-month view shows each rep's typical start/finish instead of a long
 *  day-by-day list. Calls/Productive/Outlets/Sales are summed; Strike Rate is
 *  recomputed from the summed totals (not an average of daily percentages).
 *  The result is shaped exactly like a day-grain RepDaySummary (with a
 *  synthetic firstCall/lastCall ISO carrying only the averaged clock time) so
 *  every existing status/sort/badge function keeps working unmodified. */
function buildRepMonthlyAverages(summaries: RepDaySummary[]): RepMonthlyAverageRow[] {
  interface Accumulator {
    employeeCode: string;
    salesRep: string;
    region: string;
    salesRole: string;
    firstCallMinutes: number[];
    lastCallMinutes: number[];
    hoursInDaySum: number;
    callsMade: number;
    productiveCalls: number;
    outletsCovered: number;
    intervalSum: number;
    intervalCount: number;
    sales: number;
    qty: number;
    cases: number;
    casesKnown: boolean;
    days: number;
  }
  const byRep = new Map<string, Accumulator>();
  for (const row of summaries) {
    const acc = byRep.get(row.employeeCode) ?? {
      employeeCode: row.employeeCode,
      salesRep: row.salesRep,
      region: row.region,
      salesRole: row.salesRole,
      firstCallMinutes: [],
      lastCallMinutes: [],
      hoursInDaySum: 0,
      callsMade: 0,
      productiveCalls: 0,
      outletsCovered: 0,
      intervalSum: 0,
      intervalCount: 0,
      sales: 0,
      qty: 0,
      cases: 0,
      casesKnown: true,
      days: 0,
    };
    const firstMinutes = nairobiMinutesAfterMidnight(row.firstCall);
    const lastMinutes = nairobiMinutesAfterMidnight(row.lastCall);
    if (firstMinutes !== null) acc.firstCallMinutes.push(firstMinutes);
    if (lastMinutes !== null) acc.lastCallMinutes.push(lastMinutes);
    acc.hoursInDaySum += row.hoursInDay;
    acc.callsMade += row.callsMade;
    acc.productiveCalls += row.productiveCalls;
    acc.outletsCovered += row.outletsCovered;
    if (row.avgIntervalMins !== null) {
      acc.intervalSum += row.avgIntervalMins;
      acc.intervalCount += 1;
    }
    acc.sales += row.sales;
    acc.qty += row.qty;
    if (row.cases === null) acc.casesKnown = false;
    else acc.cases += row.cases;
    acc.days += 1;
    byRep.set(row.employeeCode, acc);
  }

  return Array.from(byRep.values()).map((acc) => {
    const avgFirst = averageMinutes(acc.firstCallMinutes) ?? 0;
    const avgLast = averageMinutes(acc.lastCallMinutes) ?? 0;
    return {
      date: "",
      employeeCode: acc.employeeCode,
      salesRep: acc.salesRep,
      region: acc.region,
      salesRole: acc.salesRole,
      firstCall: isoFromNairobiMinutes(avgFirst),
      lastCall: isoFromNairobiMinutes(avgLast),
      hoursInDay: acc.days > 0 ? acc.hoursInDaySum / acc.days : 0,
      callsMade: acc.callsMade,
      productiveCalls: acc.productiveCalls,
      strikeRatePct: acc.callsMade > 0 ? Math.round((acc.productiveCalls / acc.callsMade) * 1000) / 10 : 0,
      outletsCovered: acc.outletsCovered,
      avgIntervalMins: acc.intervalCount > 0 ? Math.round((acc.intervalSum / acc.intervalCount) * 10) / 10 : null,
      sales: acc.sales,
      qty: acc.qty,
      cases: acc.casesKnown ? acc.cases : null,
      daysWorked: acc.days,
    };
  });
}

function CompactMetric({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-surface px-2.5 py-2">
      <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-base font-semibold tabular-nums text-brand-navy ${valueClass}`}>{value}</div>
    </div>
  );
}

function SalesRoleSnapshot({ title, stats, tone, productiveDays }: { title: string; stats: RoleStats; tone: "primary" | "secondary"; productiveDays: number }) {
  const iconClass = tone === "primary" ? "bg-primary-blue/10 text-primary-blue" : "bg-secondary-blue/10 text-secondary-blue";
  return (
    <div className="rounded-xl border border-border bg-background-elevated/35 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${iconClass}`}><PeopleTeam20Regular className="h-4 w-4" /></span>
        <span className="text-sm font-semibold text-brand-navy">{title}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <CompactMetric label="Calls" value={formatNumber(stats.totalCalls)} />
        <CompactMetric label="Productive" value={formatNumber(stats.productiveCalls)} />
        <CompactMetric label="Strike rate" value={formatPercent(stats.strikeRate)} valueClass={strikeRateTextClass(stats.strikeRate)} />
        <CompactMetric label="Outlets" value={formatNumber(stats.outletsCovered)} />
        <CompactMetric label="Avg interval" value={stats.avgIntervalMins !== null ? `${stats.avgIntervalMins.toFixed(0)}m` : "--"} />
        <CompactMetric label="Sales" value={formatCompact(stats.sales)} />
        <CompactMetric label="Qty (pieces)" value={formatNumber(stats.qty)} />
        <CompactMetric label="Qty (cases)" value={formatCases(stats.cases)} />
        <CompactMetric label="Productive days" value={formatNumber(productiveDays)} />
      </div>
    </div>
  );
}

function RepJourneyPanel({ detail, status, onClose }: { detail: RepDetailResponse | null; status: "loading" | "idle" | "error"; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const rep = detail?.rep;
  const visits = detail?.visits ?? [];
  const firstVisit = visits[0];
  const lastVisit = visits[visits.length - 1];
  return (
    <div className={`fixed inset-0 z-50 flex bg-brand-navy/35 ${expanded ? "justify-center p-0" : "justify-end p-0 sm:p-4"}`} role="dialog" aria-modal="true" aria-label="Sales rep visit details">
      <button className="absolute inset-0 cursor-default" aria-label="Close sales rep details" onClick={onClose} />
      <aside className={`relative flex h-full w-full flex-col overflow-hidden bg-background shadow-2xl ${expanded ? "max-w-none" : "max-w-5xl sm:rounded-2xl"}`}>
        <div className="flex items-start justify-between border-b border-border bg-surface px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-blue">Sales rep journey</p>
            <h2 className="mt-1 text-xl font-bold text-brand-navy">{rep?.salesRep ?? "Loading rep detail…"}</h2>
            {rep ? <p className="mt-1 text-xs text-muted">{rep.region} · {rep.salesRole} · {visits.length} outlet visit(s) from {firstVisit ? formatDateLabel(firstVisit.date) : "—"} to {lastVisit ? formatDateLabel(lastVisit.date) : "—"}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-surface-active" aria-pressed={expanded}>
              {expanded ? "Compress view" : "Expand full view"}
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-border bg-background-elevated p-2 text-muted-strong hover:bg-surface-active hover:text-foreground" aria-label="Close sales rep details"><Dismiss12Regular /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {status === "loading" ? <p className="py-16 text-center text-sm text-muted">Loading outlet visits and call performance…</p> : null}
          {status === "error" || !detail || !rep ? <p className="py-16 text-center text-sm text-red-600">Couldn&apos;t load this rep&apos;s visit detail.</p> : null}
          {status === "idle" && detail && rep ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                <CompactMetric label="Calls" value={formatNumber(detail.overall.totalCalls)} />
                <CompactMetric label="Productive" value={formatNumber(detail.overall.productiveCalls)} />
                <CompactMetric label="Strike rate" value={formatPercent(detail.overall.strikeRate)} valueClass={strikeRateTextClass(detail.overall.strikeRate)} />
                <CompactMetric label="Outlets" value={formatNumber(detail.overall.outletsCovered)} />
                <CompactMetric label="Avg interval" value={detail.overall.avgIntervalMins !== null ? `${detail.overall.avgIntervalMins.toFixed(0)}m` : "—"} />
                <CompactMetric label="Sales" value={formatCompact(detail.overall.sales)} />
                <CompactMetric label="Pieces" value={formatNumber(detail.overall.qty)} />
                <CompactMetric label="Cases" value={formatCases(detail.overall.cases)} />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <SectionCard title="Daily call trend" action={<span className="text-xs text-muted">Calls & productive visits</span>}>
                  <ResponsiveContainer width="100%" height={210}>
                    <LineChart data={detail.dailyTrend.map((row) => ({ ...row, name: formatDateLabel(row.label) }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} />
                      <YAxis stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} width={28} />
                      <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="calls" name="Calls" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="productiveCalls" name="Productive" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </SectionCard>
                <SectionCard title="Weekly performance" action={<span className="text-xs text-muted">Sales, pieces & cases</span>}>
                  <TableWrap>
                    <Thead><Th>Week</Th><Th align="right">Calls</Th><Th align="right">Outlets</Th><Th align="right">Sales</Th><Th align="right">Pieces</Th><Th align="right">Cases</Th></Thead>
                    <tbody>
                      {detail.weeklyTrend.map((row) => <tr key={row.label}><Td>{row.label}</Td><Td align="right">{formatNumber(row.calls)}</Td><Td align="right">{formatNumber(row.outletsCovered)}</Td><Td align="right">{formatCompact(row.sales)}</Td><Td align="right">{formatNumber(row.qty)}</Td><Td align="right">{formatCases(row.cases)}</Td></tr>)}
                    </tbody>
                  </TableWrap>
                </SectionCard>
              </div>

              <SectionCard title="Outlet visit timeline" action={<span className="text-xs text-muted">Earliest → latest · click a rep name from the dashboard to refresh</span>}>
                <TableWrap>
                  <Thead><Th>Date</Th><Th>Time</Th><Th align="right">#</Th><Th>Customer / outlet</Th><Th>Channel · territory</Th><Th>Outcome</Th><Th align="right">Transactions</Th><Th align="right">Sales</Th><Th align="right">Pieces</Th><Th align="right">Cases</Th><Th align="right">Since prior</Th></Thead>
                  <tbody>
                    {visits.map((visit) => (
                      <tr key={`${visit.date}|${visit.callSequence}|${visit.outletName}`}>
                        <Td>{formatDateLabel(visit.date)}</Td><Td>{formatTime12h(visit.callTime)}</Td><Td align="right">{visit.callSequence}</Td><Td><span className="font-semibold text-brand-navy">{visit.outletName}</span>{visit.noSaleReason ? <span className="block text-[11px] text-muted">{visit.noSaleReason}</span> : null}</Td><Td>{visit.channel} · {visit.territory}</Td><Td><span className={visit.callOutcome === "Sale" ? "font-semibold text-emerald-700" : "text-muted-strong"}>{visit.callOutcome}</span></Td><Td align="right">{formatNumber(visit.documents)}</Td><Td align="right">{formatCompact(visit.sales)}</Td><Td align="right">{formatNumber(visit.qty)}</Td><Td align="right">{formatCases(visit.cases)}</Td><Td align="right">{visit.intervalMins !== null ? `${visit.intervalMins.toFixed(0)}m` : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </SectionCard>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export default function TimestampsPage() {
  const selectedPrincipalKey = useDashboardStore((state) => state.selectedPrincipalKey);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [summary, setSummary] = useState<TimestampSummaryResponse | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [repQuery, setRepQuery] = useState("");
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedTeamLeader, setSelectedTeamLeader] = useState<string | null>(null);
  const [repDropdownOpen, setRepDropdownOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [chartGranularity, setChartGranularity] = useState<"Hourly" | "Daily" | "Weekly">("Hourly");
  const [timeManagementFilter, setTimeManagementFilter] = useState<TimeManagementFilter>("all");
  const [activeSlide, setActiveSlide] = useState<TimestampSlide>("overview");
  const [drilldownRep, setDrilldownRep] = useState<string | null>(null);
  const [repDetailStatus, setRepDetailStatus] = useState<"loading" | "idle" | "error">("idle");
  const [repDetail, setRepDetail] = useState<RepDetailResponse | null>(null);
  const [summaryLimit, setSummaryLimit] = useState(SUMMARY_PAGE_SIZE);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const lastSeenSyncRef = useRef<string | null>(null);
  const hasLoadedSummaryRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ role: roleFilter, granularity: chartGranularity });
    if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
    if (selectedMonth) params.set("month", selectedMonth);
    if (selectedDate) params.set("date", selectedDate);
    if (selectedRep) params.set("rep", selectedRep);
    if (selectedRegion) params.set("region", selectedRegion);
    if (selectedTeamLeader) params.set("teamLeader", selectedTeamLeader);

    (async () => {
      try {
        const res = await fetch(`/api/timestamps/summary?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as TimestampSummaryResponse & { error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load Timestamps summary.");
        if (controller.signal.aborted) return;
        setSummary(body);
        lastSeenSyncRef.current = body.syncUpdatedAt;
        hasLoadedSummaryRef.current = true;
        setStatus("idle");
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load Timestamps summary", error);
          setStatus("error");
        }
      }
    })();

    return () => controller.abort();
  }, [selectedPrincipalKey, selectedMonth, selectedDate, selectedRep, selectedRegion, selectedTeamLeader, roleFilter, chartGranularity, refreshRevision]);

  useEffect(() => {
    let cancelled = false;
    const checkForUpdates = async () => {
      try {
        const res = await fetch("/api/timestamps/status", { cache: "no-store" });
        const body = (await res.json()) as { syncUpdatedAt?: string | null };
        if (!res.ok || cancelled || !hasLoadedSummaryRef.current || body.syncUpdatedAt === lastSeenSyncRef.current) return;
        setRefreshRevision((revision) => revision + 1);
      } catch {
        // Keep the current aggregate visible and retry on the next check.
      }
    };
    void checkForUpdates();
    const intervalId = window.setInterval(() => void checkForUpdates(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!drilldownRep) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ rep: drilldownRep, role: roleFilter, granularity: chartGranularity });
    if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
    if (selectedMonth) params.set("month", selectedMonth);
    if (selectedDate) params.set("date", selectedDate);
    if (selectedRegion) params.set("region", selectedRegion);
    if (selectedTeamLeader) params.set("teamLeader", selectedTeamLeader);
    setRepDetailStatus("loading");
    setRepDetail(null);
    void fetch(`/api/timestamps/rep-detail?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as RepDetailResponse & { error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load rep detail.");
        if (!controller.signal.aborted) {
          setRepDetail(body);
          setRepDetailStatus("idle");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("Failed to load rep detail", error);
          setRepDetailStatus("error");
        }
      });
    return () => controller.abort();
  }, [drilldownRep, selectedPrincipalKey, selectedMonth, selectedDate, selectedRegion, selectedTeamLeader, roleFilter, chartGranularity]);

  if (status === "loading") return <FullPageSpinner label="Loading Timestamps..." />;
  if (status === "error" || !summary) {
    return <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="Couldn't load Timestamps" description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule." />;
  }
  const hasData = summary.summaries.length > 0 || summary.availableDates.length > 0;
  const availableReps = summary.availableReps;
  const selectedRepName = selectedRep ? availableReps.find((rep) => rep.employeeCode === selectedRep)?.salesRep : undefined;
  const repSearchResults = (repQuery.trim() ? availableReps.filter((rep) => rep.salesRep.toLowerCase().includes(repQuery.trim().toLowerCase())) : availableReps).slice(0, 10);
  // No single date selected ("All <month>" or "All months") -> average per rep
  // instead of a long day-by-day list, so First/Last Call reflects each rep's
  // typical time rather than whichever day happens to sort first.
  const isMonthlyAverage = selectedDate === null;
  const repRows: (RepDaySummary | RepMonthlyAverageRow)[] = isMonthlyAverage ? buildRepMonthlyAverages(summary.summaries) : summary.summaries;
  const sortedSummaries = [...repRows].sort(compareTimeManagementRows);
  const needsAttentionCount = sortedSummaries.filter((row) => firstCallStatus(row.firstCall) === "late").length;
  const thumbsUpCount = sortedSummaries.filter((row) => firstCallStatus(row.firstCall) === "on-time").length;
  const timeManagementSummaries = sortedSummaries.filter((row) => {
    const timeStatus = firstCallStatus(row.firstCall);
    if (timeManagementFilter === "attention") return timeStatus === "late";
    if (timeManagementFilter === "thumbs-up") return timeStatus === "on-time";
    return true;
  });
  const visibleSummaries = timeManagementSummaries.slice(0, summaryLimit);
  const buckets = chartBuckets(summary.chartRows, chartGranularity);
  const primaryProductiveDays = new Set(summary.summaries.filter((r) => r.salesRole === "Primary Sales" && r.productiveCalls > 0).map((r) => r.date)).size;
  const secondaryProductiveDays = new Set(summary.summaries.filter((r) => r.salesRole === "Secondary Sales" && r.productiveCalls > 0).map((r) => r.date)).size;
  const repProductivitySummary = buildRepProductivitySummary(summary.summaries);
  const topProductiveDaysReps = repProductivitySummary.slice(0, 15);
  const availableMonths = recentMonthOptions(new Date()).slice().reverse();
  const datesForSelectedMonth = selectedMonth ? summary.availableDates.filter((date) => date.startsWith(selectedMonth)) : summary.availableDates;
  const selectedMonthLabel = selectedMonth ? formatMonthLabel(`${selectedMonth}-01`) : null;
  const reportMonthLabel = selectedMonthLabel ?? (availableMonths.length === 1 ? formatMonthLabel(`${availableMonths[0]}-01`) : "available months");
  const reportDateLabel = selectedDate ? formatDateLabel(selectedDate) : `All ${reportMonthLabel}`;
  const reportRoleLabel = roleFilter === "all" ? "All roles" : roleFilter;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Timestamps" action={<span className="text-xs text-muted">{selectedMonthLabel ?? "Current month"} · summary-first loading</span>}>
        <div className="flex flex-wrap items-end gap-3">
          <PrincipalSelector />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Month</span>
            <div className="flex items-center rounded-full border border-border bg-background-elevated px-3 py-1.5">
              <select
                aria-label="Month"
                value={selectedMonth ?? ""}
                onChange={(event) => {
                  setSelectedMonth(event.target.value || null);
                  setSelectedDate(null);
                  setSelectedRep(null);
                  setRepQuery("");
                  setSummaryLimit(SUMMARY_PAGE_SIZE);
                }}
                className="max-w-[180px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
              >
                <option value="">All months</option>
                {availableMonths.map((month) => <option key={month} value={month}>{formatMonthLabel(`${month}-01`)}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Date</span>
            <div className="flex items-center rounded-full border border-border bg-background-elevated px-3 py-1.5">
              <select
                aria-label="Date"
                value={selectedDate ?? ""}
                onChange={(event) => {
                  setSelectedDate(event.target.value || null);
                  setSelectedRep(null);
                  setRepQuery("");
                  setSummaryLimit(SUMMARY_PAGE_SIZE);
                }}
                className="max-w-[160px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
              >
                <option value="">All {selectedMonthLabel ?? "dates"}</option>
                {[...datesForSelectedMonth].reverse().map((date) => <option key={date} value={date}>{formatDateLabel(date)}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Filter by rep</span>
            <div className="relative w-56">
              <input
                value={selectedRep ? selectedRepName ?? "" : repQuery}
                onChange={(event) => {
                  setRepQuery(event.target.value);
                  setSelectedRep(null);
                  setRepDropdownOpen(true);
                }}
                onFocus={() => setRepDropdownOpen(true)}
                onBlur={() => setTimeout(() => setRepDropdownOpen(false), 150)}
                placeholder="Search reps..."
                className="w-full rounded-full border border-border bg-surface px-3.5 py-1.5 pr-8 text-xs text-foreground outline-none focus:border-secondary-blue"
              />
              {selectedRep ? (
                <button onClick={() => { setSelectedRep(null); setRepQuery(""); }} aria-label="Clear rep filter" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
                  <Dismiss12Regular />
                </button>
              ) : null}
              {repDropdownOpen && !selectedRep ? (
                <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
                  {repSearchResults.length === 0 ? (
                    <div className="px-4 py-2 text-xs text-muted">No matching reps</div>
                  ) : (
                    repSearchResults.map((rep) => (
                      <button
                        key={rep.employeeCode}
                        onMouseDown={() => {
                          setSelectedRep(rep.employeeCode);
                          setRepQuery("");
                          setRepDropdownOpen(false);
                          setSummaryLimit(SUMMARY_PAGE_SIZE);
                        }}
                        className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-accent-blue-soft"
                      >
                        {rep.salesRep}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Sales role</span>
            <RoleToggle value={roleFilter} onChange={(role) => { setRoleFilter(role); setSelectedRep(null); setRepQuery(""); setSelectedRegion(null); setSummaryLimit(SUMMARY_PAGE_SIZE); }} />
          </div>
          <span className="mb-1 ml-auto text-xs text-muted">Live sync: 5 min{summary.syncUpdatedAt ? ` · ${formatTime12h(summary.syncUpdatedAt)}` : ""}</span>
        </div>
      </SectionCard>

      <nav aria-label="Timestamps dashboard views" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {([
          ["overview", "Overview", "Call volume, sales and case quantity"],
          ["reps", "Rep performance", "Productive days and outlet drill-down"],
          ["time", "Time management", "Start, finish and in-day productivity"],
        ] as const).map(([slide, label, description]) => (
          <button
            key={slide}
            type="button"
            onClick={() => setActiveSlide(slide)}
            aria-pressed={activeSlide === slide}
            className={`rounded-xl border px-4 py-3 text-left transition-all ${activeSlide === slide ? "border-primary-blue bg-primary-blue text-white shadow-cyan-glow" : "border-border bg-surface text-brand-navy hover:border-secondary-blue hover:bg-accent-blue-soft"}`}
          >
            <span className="block text-sm font-bold">{label}</span>
            <span className={`mt-0.5 block text-xs ${activeSlide === slide ? "text-white/80" : "text-muted"}`}>{description}</span>
          </button>
        ))}
      </nav>

      {!hasData ? (
        <EmptyState icon={<Clock20Regular className="h-10 w-10" />} title="No call activity recorded for this period" description="Pick a different month above, or check back shortly — the current month refreshes automatically from the direct-SQL sync every five minutes." />
      ) : (
      <>
      {activeSlide === "overview" ? <>
      <SectionCard
        title="Calls by Time (Primary vs Secondary)"
        action={
          <div className="flex items-center gap-3">
            <div className="inline-flex gap-0.5 rounded-full bg-background-elevated p-0.5">
              {(["Hourly", "Daily", "Weekly"] as const).map((granularity) => (
                <button
                  key={granularity}
                  onClick={() => setChartGranularity(granularity)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-300 ${chartGranularity === granularity ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"}`}
                >
                  {granularity}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted">Africa/Nairobi time</span>
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={buckets} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} interval={chartGranularity === "Hourly" ? 1 : 0} axisLine={false} tickLine={false} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} width={28} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
            <Legend verticalAlign="top" align="right" height={20} wrapperStyle={{ fontSize: 11, top: -6 }} />
            <Bar dataKey="Primary" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="Secondary" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="Sales snapshot" action={<span className="text-xs text-muted">Compact role comparison</span>}>
        <div className={`grid gap-3 ${roleFilter === "all" ? "lg:grid-cols-2" : "grid-cols-1"}`}>
          {roleFilter !== "Secondary Sales" ? <SalesRoleSnapshot title="Primary Sales" stats={summary.primaryStats} tone="primary" productiveDays={primaryProductiveDays} /> : null}
          {roleFilter !== "Primary Sales" ? <SalesRoleSnapshot title="Secondary Sales" stats={summary.secondaryStats} tone="secondary" productiveDays={secondaryProductiveDays} /> : null}
        </div>
        <p className="mt-3 text-xs text-muted">Cases use the source product UOM (pieces ÷ units per case). A dash means one or more sold products in that selection have not yet supplied a valid UOM.</p>
      </SectionCard>

      </> : null}

      {activeSlide === "reps" ? <>
      <SectionCard title="Productive Days by Rep" action={<span className="text-xs text-muted">Top {topProductiveDaysReps.length} of {repProductivitySummary.length} reps · vs. Calls Made &amp; Strike Rate</span>}>
        <ResponsiveContainer width="100%" height={Math.max(180, topProductiveDaysReps.length * 26)}>
          <BarChart data={topProductiveDaysReps.map((r) => ({ name: r.salesRep, value: r.productiveDays }))} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_COLOR} />
            <XAxis type="number" allowDecimals={false} fontSize={10} stroke={CHART_AXIS_COLOR} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={120} fontSize={10} stroke={CHART_AXIS_COLOR} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => [`${value} day(s)`, "Productive Days"]} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16}>
              {topProductiveDaysReps.map((r, index) => (
                <Cell key={index} fill={tierBarColor[strikeRateTier(r.strikeRatePct)]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <TableWrap>
          <Thead>
            <Th>Sales Rep</Th>
            <Th>Region</Th>
            <Th>Sales Role</Th>
            <Th align="right">Calls Made</Th>
            <Th align="right">Productive</Th>
            <Th align="center">Strike Rate</Th>
            <Th align="right">Outlets Covered</Th>
            <Th align="right">Productive Days</Th>
            <Th align="right">Sales</Th>
            <Th align="right">Pieces</Th>
            <Th align="right">Cases</Th>
          </Thead>
          <tbody>
            {repProductivitySummary.map((row) => (
              <tr key={row.employeeCode}>
                <Td><button onClick={() => setDrilldownRep(row.employeeCode)} className="font-semibold text-primary-blue hover:underline">{row.salesRep}</button></Td>
                <Td>{row.region}</Td>
                <Td>{row.salesRole}</Td>
                <Td align="right">{formatNumber(row.callsMade)}</Td>
                <Td align="right">{formatNumber(row.productiveCalls)}</Td>
                <Td align="center"><StrikeRateBadge strikeRate={row.strikeRatePct} /></Td>
                <Td align="right">{formatNumber(row.outletsCovered)}</Td>
                <Td align="right"><span className="font-semibold text-brand-navy">{formatNumber(row.productiveDays)}</span></Td>
                <Td align="right">{formatCompact(row.sales)}</Td>
                <Td align="right">{formatNumber(row.qty)}</Td>
                <Td align="right">{formatCases(row.cases)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      </> : null}

      {activeSlide === "time" ? <>
      <SectionCard
        title={isMonthlyAverage ? "Rep Monthly Average" : "Rep Daily Summary"}
        action={
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs text-muted">
            {isMonthlyAverage ? <span className="font-semibold text-primary-blue">First/Last Call averaged per rep across {reportMonthLabel}</span> : null}
            <span><strong className="font-semibold text-muted-strong">Date:</strong> {reportDateLabel}</span>
            <span><strong className="font-semibold text-muted-strong">Sales role:</strong> {reportRoleLabel}</span>
            {selectedRegion ? <span><strong className="font-semibold text-muted-strong">Region:</strong> {selectedRegion}</span> : null}
            {selectedTeamLeader ? <span><strong className="font-semibold text-muted-strong">Team Leader:</strong> {selectedTeamLeader}</span> : null}
            {selectedRepName ? <span><strong className="font-semibold text-muted-strong">Rep:</strong> {selectedRepName}</span> : null}
            {selectedPrincipalKey ? <span><span className="font-semibold text-muted-strong">Principal:</span> <strong className="font-bold text-foreground">{selectedPrincipalKey}</strong></span> : null}
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold text-primary-blue">Time management</span>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-elevated px-3 py-1.5">
            <label htmlFor="timestamp-region" className="text-[10px] font-semibold uppercase tracking-wide text-muted">Region</label>
            <select
              id="timestamp-region"
              aria-label="Region"
              value={selectedRegion ?? ""}
              onChange={(event) => {
                setSelectedRegion(event.target.value || null);
                setSelectedRep(null);
                setRepQuery("");
                setSummaryLimit(SUMMARY_PAGE_SIZE);
              }}
              className="max-w-[150px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
            >
              <option value="">All regions</option>
              {summary.availableRegions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-elevated px-3 py-1.5">
            <label htmlFor="timestamp-team-leader" className="text-[10px] font-semibold uppercase tracking-wide text-muted">Team Leader</label>
            <select
              id="timestamp-team-leader"
              aria-label="Team Leader"
              value={selectedTeamLeader ?? ""}
              onChange={(event) => {
                setSelectedTeamLeader(event.target.value || null);
                setSelectedRep(null);
                setRepQuery("");
                setSummaryLimit(SUMMARY_PAGE_SIZE);
              }}
              className="max-w-[160px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
            >
              <option value="">All Team Leaders</option>
              {summary.availableTeamLeaders.map((tl) => <option key={tl} value={tl}>{tl}</option>)}
            </select>
          </div>
          <button onClick={() => { setTimeManagementFilter("all"); setSummaryLimit(SUMMARY_PAGE_SIZE); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${timeManagementFilter === "all" ? "bg-dark-navy text-white" : "bg-background-elevated text-muted-strong hover:bg-surface-active"}`}>
            All reps
          </button>
          <button onClick={() => { setTimeManagementFilter("attention"); setSummaryLimit(SUMMARY_PAGE_SIZE); }} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${timeManagementFilter === "attention" ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"}`}>
            <Warning20Regular /> Needs attention ({needsAttentionCount})
          </button>
          <button onClick={() => { setTimeManagementFilter("thumbs-up"); setSummaryLimit(SUMMARY_PAGE_SIZE); }} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${timeManagementFilter === "thumbs-up" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
            <ThumbLike20Regular /> Thumbs Up ({thumbsUpCount})
          </button>
          <span className="ml-auto text-xs text-muted">Start: green at 9:30 AM or earlier · red after 9:30 AM</span>
        </div>
        <UnmappedEmployeesNote unmappedEmployees={summary.unmappedEmployees} />
        <TableWrap>
          <Thead>
            <Th>Sales Rep</Th><Th>{isMonthlyAverage ? "Avg First Call" : "First Call"}</Th><Th>Start Status</Th><Th>{isMonthlyAverage ? "Avg Last Call" : "Last Call"}</Th><Th>Closing Remark</Th>
            <Th align="right">Hours in Day</Th><Th align="right">Calls Made</Th><Th align="right">Productive</Th><Th align="center">Strike Rate</Th><Th align="right">Outlets Covered</Th><Th align="right">Avg Interval (mins)</Th><Th align="right">Sales</Th><Th align="right">Pieces</Th><Th align="right">Cases</Th>
            {isMonthlyAverage ? <Th align="right">Days Worked</Th> : null}
          </Thead>
          <tbody>
            {visibleSummaries.map((row) => {
              const startStatus = firstCallStatus(row.firstCall);
              const closeStatus = isMonthlyAverage ? closingStatusForMinutes(nairobiMinutesAfterMidnight(row.lastCall)) : closingStatus(row.date, row.lastCall);
              return (
                <tr key={`${row.date}|${row.employeeCode}|${row.salesRole}`}>
                  <Td><button onClick={() => setDrilldownRep(row.employeeCode)} className="font-semibold text-primary-blue hover:underline">{row.salesRep}</button></Td>
                  <Td><span className={`inline-flex items-center gap-1 font-semibold ${timeStatusClass(startStatus)}`}>{startStatus === "late" ? <Warning20Regular /> : startStatus === "on-time" ? <ThumbLike20Regular /> : null}{formatTime12h(row.firstCall)}</span></Td>
                  <Td><span className={`text-xs font-semibold ${timeStatusClass(startStatus)}`}>{timeStatusLabel(startStatus)}</span></Td>
                  <Td><span className={`font-semibold ${closingStatusClass(closeStatus)}`}>{formatTime12h(row.lastCall)}</span></Td>
                  <Td><span className={`inline-flex items-center gap-1 text-xs font-semibold ${closingStatusClass(closeStatus)}`}>{closeStatus === "closed-early" ? <Warning20Regular /> : closeStatus === "closed-on-time" ? <ThumbLike20Regular /> : null}{closingStatusLabel(closeStatus)}</span></Td>
                  <Td align="right">{row.hoursInDay.toFixed(1)}</Td><Td align="right">{formatNumber(row.callsMade)}</Td><Td align="right">{formatNumber(row.productiveCalls)}</Td>
                  <Td align="center"><StrikeRateBadge strikeRate={row.strikeRatePct} /></Td><Td align="right">{formatNumber(row.outletsCovered)}</Td><Td align="right">{row.avgIntervalMins !== null ? row.avgIntervalMins.toFixed(0) : "--"}</Td><Td align="right">{formatCompact(row.sales)}</Td><Td align="right">{formatNumber(row.qty)}</Td><Td align="right">{formatCases(row.cases)}</Td>
                  {isMonthlyAverage ? <Td align="right">{formatNumber((row as RepMonthlyAverageRow).daysWorked)}</Td> : null}
                </tr>
              );
            })}
            <TotalRow>
              <Td>Total</Td><Td>--</Td><Td>--</Td><Td>--</Td><Td>--</Td><Td align="right">--</Td>
              <Td align="right">{formatNumber(summary.overall.totalCalls)}</Td><Td align="right">{formatNumber(summary.overall.productiveCalls)}</Td><Td align="center"><StrikeRateBadge strikeRate={summary.overall.strikeRate} /></Td><Td align="right">{formatNumber(summary.overall.outletsCovered)}</Td><Td align="right">--</Td><Td align="right">{formatCompact(summary.overall.sales)}</Td><Td align="right">{formatNumber(summary.overall.qty)}</Td><Td align="right">{formatCases(summary.overall.cases)}</Td>
              {isMonthlyAverage ? <Td align="right">--</Td> : null}
            </TotalRow>
          </tbody>
        </TableWrap>
        {timeManagementSummaries.length > visibleSummaries.length ? (
          <div className="mt-3 flex justify-center">
            <button onClick={() => setSummaryLimit((limit) => limit + SUMMARY_PAGE_SIZE)} className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
              Show 50 more reps
            </button>
          </div>
        ) : null}
      </SectionCard>
      </> : null}
      </>
      )}
      {drilldownRep ? <RepJourneyPanel detail={repDetail} status={repDetailStatus} onClose={() => { setDrilldownRep(null); setRepDetail(null); }} /> : null}
    </div>
  );
}
