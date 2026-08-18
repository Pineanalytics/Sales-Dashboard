"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { Badge } from "@/components/ui/Badge";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { DateCalendarPicker } from "@/components/ui/DateCalendarPicker";
import { RoleToggle, type RoleFilter } from "@/components/ui/RoleToggle";
import { formatCompact, formatNumber, formatPercent, productivityTier, tierTextClass, type Tier } from "@/lib/format";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle, CHART_COLORS } from "@/components/charts/theme";
import { CalendarCheckmark20Regular, Dismiss12Regular } from "@fluentui/react-icons";

interface JpKpis {
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
}

interface JpRepDaySummaryRow {
  date: string;
  employeeCode: string;
  employeeName: string;
  salesRole: string;
  teamLeader: string;
  principal: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  status: string;
}

interface JpRepSummaryRow {
  employeeCode: string;
  employeeName: string;
  salesRole: string;
  teamLeader: string;
  principal: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  status: string;
}

interface JpMonthlyCoverageRow {
  year: string;
  monthIndex: number;
  employeeCode: string;
  employeeName: string;
  principal: string;
  principalKey: string;
  salesRole: string;
  activityStatus: string;
  coverage: number;
  productive: number;
  productivityPct: number;
  revenue: number;
  qty: number;
}

interface JpPlanRepRow {
  employeeCode: string;
  employeeName: string;
  teamLeader: string;
  principal: string;
  salesRole: string;
  plannedOutlets: number;
  visitedOutlets: number;
  planAdherencePct: number;
  missedOutlets: number;
  status: string;
}

interface JpPlanAdherence {
  kpis: {
    plannedOutlets: number;
    visitedOutlets: number;
    planAdherencePct: number;
    unplannedVisits: number;
  };
  repRows: JpPlanRepRow[];
}

interface JpAdherenceResponse {
  kpis: JpKpis;
  repDaySummary: JpRepDaySummaryRow[];
  availableMonths: string[];
  availableDates: string[];
  availableReps: { employeeCode: string; employeeName: string }[];
  availableTeamLeaders: string[];
  monthlyCoverage: JpMonthlyCoverageRow[];
  planAdherence: JpPlanAdherence;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function currentMonthLabel(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr.slice(0, 10)}T12:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function dateKey(dateStr: string): string {
  return dateStr.slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function statusFor(jpAdherencePct: number): string {
  if (jpAdherencePct >= 90) return "Excellent";
  if (jpAdherencePct >= 75) return "Good";
  return "Below Target";
}

/** Rolls the day-level repDaySummary up to one row per rep for the PJP
 *  Ownership Adherence Report table — the Date column is redundant there
 *  since the calendar picker above it already narrows the period, and a
 *  single row per rep is what "no Date column" actually requires (showing
 *  several dateless rows for the same rep would be ambiguous). The PJP
 *  Ownership Trend chart below still needs day-level data, so it keeps
 *  reading data.repDaySummary directly rather than this rollup. */
function rollUpByRep(rows: JpRepDaySummaryRow[]): JpRepSummaryRow[] {
  const byRep = new Map<string, JpRepSummaryRow>();
  for (const r of rows) {
    const existing = byRep.get(r.employeeCode);
    if (existing) {
      existing.outletsPlanned += r.outletsPlanned;
      existing.outletsVisited += r.outletsVisited;
      existing.productiveOutlets += r.productiveOutlets;
    } else {
      byRep.set(r.employeeCode, {
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        salesRole: r.salesRole,
        teamLeader: r.teamLeader,
        principal: r.principal,
        outletsPlanned: r.outletsPlanned,
        outletsVisited: r.outletsVisited,
        jpAdherencePct: 0,
        productiveOutlets: r.productiveOutlets,
        strikeRatePct: 0,
        plannedNotVisited: 0,
        status: "",
      });
    }
  }
  return Array.from(byRep.values())
    .map((r) => {
      const jpAdherencePct = r.outletsPlanned > 0 ? round1((r.outletsVisited / r.outletsPlanned) * 100) : 0;
      return {
        ...r,
        jpAdherencePct,
        strikeRatePct: r.outletsVisited > 0 ? round1((r.productiveOutlets / r.outletsVisited) * 100) : 0,
        plannedNotVisited: r.outletsPlanned - r.outletsVisited,
        status: statusFor(jpAdherencePct),
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

const ADHERENCE_STATUS_TIER: Record<string, Tier> = {
  Excellent: "good",
  Good: "warn",
  "Below Target": "bad",
};
const ACTIVITY_STATUS_TIER: Record<string, Tier> = { Active: "good", Inactive: "bad" };

export default function JpAdherencePage() {
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [data, setData] = useState<JpAdherenceResponse | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthLabel());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedDayNames, setSelectedDayNames] = useState<string[]>([]);
  const [repQuery, setRepQuery] = useState("");
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [repDropdownOpen, setRepDropdownOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [selectedTeamLeader, setSelectedTeamLeader] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const params = new URLSearchParams({ month: selectedMonth, role: roleFilter });
    if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
    if (selectedDate) params.set("date", selectedDate);
    if (selectedDayNames.length > 0) params.set("dayNames", selectedDayNames.join(","));
    if (selectedRep) params.set("rep", selectedRep);
    if (selectedTeamLeader) params.set("teamLeader", selectedTeamLeader);

    (async () => {
      try {
        const res = await fetch(`/api/jp-adherence?${params.toString()}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load JP Adherence data.");
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
  }, [selectedMonth, selectedPrincipalKey, selectedDate, selectedDayNames, selectedRep, selectedTeamLeader, roleFilter]);

  if (status === "loading") return <FullPageSpinner label="Loading JP Adherence…" />;
  if (status === "error" || !data) {
    return (
      <EmptyState
        icon={<CalendarCheckmark20Regular className="h-10 w-10" />}
        title="Couldn't load JP Adherence"
        description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule."
      />
    );
  }

  const hasData = data.repDaySummary.length > 0;
  const repSummary = rollUpByRep(data.repDaySummary);

  const availableMonths = data.availableMonths.length > 0 ? data.availableMonths : [selectedMonth];
  const selectedRepName = selectedRep ? data.availableReps.find((r) => r.employeeCode === selectedRep)?.employeeName : undefined;
  const repSearchResults = (repQuery.trim() ? data.availableReps.filter((r) => r.employeeName.toLowerCase().includes(repQuery.trim().toLowerCase())) : data.availableReps).slice(0, 10);

  // Productive Days: distinct dates in the current selection where the rep(s) actually
  // made a productive (Sale-outcome) visit — derived client-side from repDaySummary,
  // which already reflects every active filter (month/date/day-names/role/TL/rep).
  const productiveDaysCount = new Set(data.repDaySummary.filter((r) => r.productiveOutlets > 0).map((r) => r.date)).size;

  // Trend by date — re-aggregated (sum(visited)/sum(planned)) rather than a naive
  // average of daily percentages, avoiding the "average of ratios" distortion.
  const byDate = new Map<string, { planned: number; visited: number; productive: number }>();
  for (const r of data.repDaySummary) {
    const k = dateKey(r.date);
    const acc = byDate.get(k) ?? { planned: 0, visited: 0, productive: 0 };
    acc.planned += r.outletsPlanned;
    acc.visited += r.outletsVisited;
    acc.productive += r.productiveOutlets;
    byDate.set(k, acc);
  }
  const trendData = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, acc]) => ({
      name: formatDateLabel(date),
      "PJP Adherence %": acc.planned > 0 ? Math.round((acc.visited / acc.planned) * 1000) / 10 : 0,
      "PJP Strike Rate %": acc.visited > 0 ? Math.round((acc.productive / acc.visited) * 1000) / 10 : 0,
    }));

  // Monthly Coverage is a broader multi-month view (RepCall's own retention),
  // independent of the day-level Adherence's Month/Date/Day-Name selection —
  // only Principal/Role/Rep narrow it, matching the page's original intent.
  const monthlyCoverage = data.monthlyCoverage.filter((m) => {
    if (roleFilter !== "all" && m.salesRole !== roleFilter) return false;
    if (selectedRep && m.employeeCode !== selectedRep) return false;
    return true;
  });

  const toggleDayName = (day: string) => {
    setSelectedDayNames((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="PJP Ownership Adherence" action={<span className="text-xs text-muted">{formatMonthLabel(selectedMonth)}</span>}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div className="shrink-0">
            <DateCalendarPicker availableDates={data.availableDates} selectedDate={selectedDate} onSelectDate={setSelectedDate} allLabel="All Dates" />
          </div>
          <div className="h-auto w-px shrink-0 self-stretch bg-border/60 max-lg:hidden" />
          <div className="flex flex-1 flex-wrap items-start gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Month</span>
              <div className="flex items-center rounded-full border border-border bg-background-elevated px-3 py-1.5">
                <select
                  aria-label="Month"
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setSelectedDate(null);
                  }}
                  className="max-w-[180px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
                >
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Day</span>
              <div className="flex flex-wrap gap-1">
                {DAY_NAMES.map((day) => (
                  <button
                    key={day}
                    onClick={() => toggleDayName(day)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${selectedDayNames.includes(day) ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "bg-background-elevated text-muted-strong hover:bg-surface-active"}`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Sales Role</span>
              <RoleToggle value={roleFilter} onChange={setRoleFilter} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Team Leader</span>
              <div className="flex items-center rounded-full border border-border bg-background-elevated px-3 py-1.5">
                <select
                  aria-label="Team Leader"
                  value={selectedTeamLeader ?? ""}
                  onChange={(e) => {
                    setSelectedTeamLeader(e.target.value || null);
                    setSelectedRep(null);
                    setRepQuery("");
                  }}
                  className="max-w-[160px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
                >
                  <option value="">All Team Leaders</option>
                  {data.availableTeamLeaders.map((tl) => (
                    <option key={tl} value={tl}>
                      {tl}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Filter by Rep</span>
              <div className="relative w-56">
                <input
                  value={selectedRep ? selectedRepName ?? "" : repQuery}
                  onChange={(e) => {
                    setRepQuery(e.target.value);
                    setSelectedRep(null);
                    setRepDropdownOpen(true);
                  }}
                  onFocus={() => setRepDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setRepDropdownOpen(false), 150)}
                  placeholder="Search reps…"
                  className="w-full rounded-full border border-border bg-surface px-3.5 py-1.5 pr-8 text-xs text-foreground outline-none focus:border-secondary-blue"
                />
                {selectedRep ? (
                  <button
                    onClick={() => {
                      setSelectedRep(null);
                      setRepQuery("");
                    }}
                    aria-label="Clear rep filter"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  >
                    <Dismiss12Regular />
                  </button>
                ) : null}
                {repDropdownOpen && !selectedRep ? (
                  <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
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
                          }}
                          className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-accent-blue-soft"
                        >
                          {rep.employeeName}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Journey Plan Adherence"
        action={<span className="text-xs text-muted">Planned for that exact day (uploaded Journey Plan) vs actually visited that day</span>}
      >
        {data.planAdherence.repRows.length === 0 ? (
          <EmptyState
            icon={<CalendarCheckmark20Regular className="h-10 w-10" />}
            title="No Journey Plan rows for this period"
            description="This needs an uploaded Journey Plan (rep/outlet/date schedule) covering the selected period — check the plan upload for this month."
          />
        ) : (
          <>
            <KpiGrid>
              <KpiCard accent="coverage" label="Planned Outlets" value={<AnimatedValue value={data.planAdherence.kpis.plannedOutlets} format={formatNumber} />} sublabel="Rep × outlet × day, from the uploaded plan" />
              <KpiCard accent="coverage" label="Visited (on plan)" value={<AnimatedValue value={data.planAdherence.kpis.visitedOutlets} format={formatNumber} />} />
              <KpiCard accent="growth" label="Plan Adherence" value={<span className={tierTextClass[productivityTier(data.planAdherence.kpis.planAdherencePct)]}>{formatPercent(data.planAdherence.kpis.planAdherencePct)}</span>} />
              <KpiCard accent="revenue" label="Unplanned Visits" value={<AnimatedValue value={data.planAdherence.kpis.unplannedVisits} format={formatNumber} />} sublabel="Visited, but not on that day's plan" />
            </KpiGrid>
            <div className="mt-4">
              <TableWrap>
                <Thead>
                  <Th>Rep Name</Th>
                  <Th>Team Leader</Th>
                  <Th>Principal</Th>
                  <Th>Sales Role</Th>
                  <Th align="right">Planned</Th>
                  <Th align="right">Visited</Th>
                  <Th align="center">Adherence %</Th>
                  <Th align="right">Missed</Th>
                  <Th align="center">Status</Th>
                </Thead>
                <tbody>
                  {data.planAdherence.repRows.map((r) => (
                    <tr key={r.employeeCode}>
                      <Td>{r.employeeName}</Td>
                      <Td>{r.teamLeader}</Td>
                      <Td>{r.principal}</Td>
                      <Td>{r.salesRole}</Td>
                      <Td align="right">{formatNumber(r.plannedOutlets)}</Td>
                      <Td align="right">{formatNumber(r.visitedOutlets)}</Td>
                      <Td align="center">
                        <Badge tier={productivityTier(r.planAdherencePct)}>{r.planAdherencePct.toFixed(1)}%</Badge>
                      </Td>
                      <Td align="right">{formatNumber(r.missedOutlets)}</Td>
                      <Td align="center">
                        <Badge tier={ADHERENCE_STATUS_TIER[r.status] ?? "neutral"}>{r.status}</Badge>
                      </Td>
                    </tr>
                  ))}
                  <TotalRow>
                    <Td>Total</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                    <Td align="right">{formatNumber(data.planAdherence.kpis.plannedOutlets)}</Td>
                    <Td align="right">{formatNumber(data.planAdherence.kpis.visitedOutlets)}</Td>
                    <Td align="center">
                      <Badge tier={productivityTier(data.planAdherence.kpis.planAdherencePct)}>{data.planAdherence.kpis.planAdherencePct.toFixed(1)}%</Badge>
                    </Td>
                    <Td align="right">{formatNumber(data.planAdherence.kpis.plannedOutlets - data.planAdherence.kpis.visitedOutlets)}</Td>
                    <Td align="center">—</Td>
                  </TotalRow>
                </tbody>
              </TableWrap>
            </div>
          </>
        )}
      </SectionCard>

      {!hasData ? (
        <EmptyState
          icon={<CalendarCheckmark20Regular className="h-10 w-10" />}
          title="No Timestamp visits for this period"
          description="PJP ownership adherence is calculated from the active Pine outlet owner and live Timestamp calls. Choose a month with Timestamp activity or check the live sync."
        />
      ) : (
        <>
          <SectionCard
            title="PJP Ownership Adherence"
            action={<span className="text-xs text-muted">Territory alignment: are today's visits to outlets you own? Not tied to a specific planned day.</span>}
          >
            <KpiGrid>
              <KpiCard accent="coverage" label="Timestamp Visits" value={<AnimatedValue value={data.kpis.outletsPlanned} format={formatNumber} />} />
              <KpiCard accent="coverage" label="PJP-aligned Visits" value={<AnimatedValue value={data.kpis.outletsVisited} format={formatNumber} />} />
              <KpiCard accent="growth" label="PJP Ownership Adherence" value={<span className={tierTextClass[productivityTier(data.kpis.jpAdherencePct)]}>{formatPercent(data.kpis.jpAdherencePct)}</span>} />
              <KpiCard accent="quarter" label="PJP Strike Rate" value={<span className={tierTextClass[productivityTier(data.kpis.strikeRatePct)]}>{formatPercent(data.kpis.strikeRatePct)}</span>} />
              <KpiCard accent="revenue" label="Outside PJP" value={<AnimatedValue value={data.kpis.plannedNotVisited} format={formatNumber} />} />
              <KpiCard accent="coverage" label="Productive Days" value={<AnimatedValue value={productiveDaysCount} format={formatNumber} />} sublabel="Days with ≥1 productive visit" />
            </KpiGrid>
          </SectionCard>

          <SectionCard title="PJP Ownership Trend" action={<span className="text-xs text-muted">Ownership adherence % vs PJP strike rate %</span>}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={10} unit="%" axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                <Legend verticalAlign="top" align="right" height={20} wrapperStyle={{ fontSize: 11, top: -6 }} />
                <Line type="monotone" dataKey="PJP Adherence %" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="PJP Strike Rate %" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard
            title="PJP Ownership Adherence Report"
            action={
              <span className="text-xs text-muted">
                {selectedDate ? formatDateLabel(selectedDate) : formatMonthLabel(selectedMonth)}
                {selectedTeamLeader ? ` · ${selectedTeamLeader}` : ""}
                {selectedRepName ? ` · ${selectedRepName}` : ""}
                {selectedPrincipalKey ? ` · ${selectedPrincipalKey}` : ""}
              </span>
            }
          >
            <TableWrap>
              <Thead>
                <Th>Rep Name</Th>
                <Th>Team Leader</Th>
                <Th>Principal</Th>
                <Th>Sales Role</Th>
                <Th align="right">Timestamp Visits</Th>
                <Th align="right">PJP-aligned</Th>
                <Th align="center">Adherence %</Th>
                <Th align="right">Productive</Th>
                <Th align="center">Strike Rate</Th>
                <Th align="right">Outside PJP</Th>
                <Th align="center">Status</Th>
              </Thead>
              <tbody>
                {repSummary.map((r) => (
                  <tr key={r.employeeCode}>
                    <Td>{r.employeeName}</Td>
                    <Td>{r.teamLeader}</Td>
                    <Td>{r.principal}</Td>
                    <Td>{r.salesRole}</Td>
                    <Td align="right">{formatNumber(r.outletsPlanned)}</Td>
                    <Td align="right">{formatNumber(r.outletsVisited)}</Td>
                    <Td align="center">
                      <Badge tier={productivityTier(r.jpAdherencePct)}>{r.jpAdherencePct.toFixed(1)}%</Badge>
                    </Td>
                    <Td align="right">{formatNumber(r.productiveOutlets)}</Td>
                    <Td align="center">
                      <Badge tier={productivityTier(r.strikeRatePct)}>{r.strikeRatePct.toFixed(1)}%</Badge>
                    </Td>
                    <Td align="right">{formatNumber(r.plannedNotVisited)}</Td>
                    <Td align="center">
                      <Badge tier={ADHERENCE_STATUS_TIER[r.status] ?? "neutral"}>{r.status}</Badge>
                    </Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td align="right">{formatNumber(data.kpis.outletsPlanned)}</Td>
                  <Td align="right">{formatNumber(data.kpis.outletsVisited)}</Td>
                  <Td align="center">
                    <Badge tier={productivityTier(data.kpis.jpAdherencePct)}>{data.kpis.jpAdherencePct.toFixed(1)}%</Badge>
                  </Td>
                  <Td align="right">{formatNumber(data.kpis.productiveOutlets)}</Td>
                  <Td align="center">
                    <Badge tier={productivityTier(data.kpis.strikeRatePct)}>{data.kpis.strikeRatePct.toFixed(1)}%</Badge>
                  </Td>
                  <Td align="right">{formatNumber(data.kpis.plannedNotVisited)}</Td>
                  <Td align="center">—</Td>
                </TotalRow>
              </tbody>
            </TableWrap>
          </SectionCard>

          <SectionCard title="Monthly Coverage" action={<span className="text-xs text-muted">Coverage/productivity: Pine (RepCall) · all retained months</span>}>
            <TableWrap>
              <Thead>
                <Th>Month</Th>
                <Th>Principal</Th>
                <Th>Sales Role</Th>
                <Th>Employee</Th>
                <Th align="center">Activity Status</Th>
                <Th align="right">Coverage</Th>
                <Th align="right">Productive</Th>
                <Th align="center">Productivity %</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">Qty</Th>
              </Thead>
              <tbody>
                {monthlyCoverage.map((r) => (
                  <tr key={`${r.year}-${r.monthIndex}|${r.employeeCode}`}>
                    <Td>{`${r.monthIndex + 1}/${r.year}`}</Td>
                    <Td>{r.principal}</Td>
                    <Td>{r.salesRole}</Td>
                    <Td>{r.employeeName}</Td>
                    <Td align="center">
                      <Badge tier={ACTIVITY_STATUS_TIER[r.activityStatus] ?? "neutral"}>{r.activityStatus}</Badge>
                    </Td>
                    <Td align="right">{formatNumber(r.coverage)}</Td>
                    <Td align="right">{formatNumber(r.productive)}</Td>
                    <Td align="center">
                      <Badge tier={productivityTier(r.productivityPct)}>{r.productivityPct.toFixed(1)}%</Badge>
                    </Td>
                    <Td align="right">{formatCompact(r.revenue)}</Td>
                    <Td align="right">{formatNumber(r.qty)}</Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td align="center">—</Td>
                  <Td align="right">{formatNumber(monthlyCoverage.reduce((s, r) => s + r.coverage, 0))}</Td>
                  <Td align="right">{formatNumber(monthlyCoverage.reduce((s, r) => s + r.productive, 0))}</Td>
                  <Td align="center">—</Td>
                  <Td align="right">{formatCompact(monthlyCoverage.reduce((s, r) => s + r.revenue, 0))}</Td>
                  <Td align="right">{formatNumber(monthlyCoverage.reduce((s, r) => s + r.qty, 0))}</Td>
                </TotalRow>
              </tbody>
            </TableWrap>
          </SectionCard>
        </>
      )}
    </div>
  );
}
