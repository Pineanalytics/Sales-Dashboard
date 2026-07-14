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
import { formatCompact, formatNumber, formatPercent, productivityTier, tierTextClass, type Tier } from "@/lib/format";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle, CHART_COLORS } from "@/components/charts/theme";
import { CalendarCheckmark20Regular, Dismiss12Regular } from "@fluentui/react-icons";

interface JourneyPlanRow {
  costCentreGroup: string;
  principalCostCentre: string;
  salesRole: string;
  userGroup: string;
  employeeCode: string;
  employeeName: string;
  monthLabel: string;
  day: string;
  date: string;
  weekOfMonth: number;
  dayIndex: number;
  routeSeq: number;
  customerId: string;
  customerName: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  visitsPerWeek: number;
  minOutletsTarget: number;
  dayOutletCount: number;
  status: string;
}

interface JpAdherenceDailyRow {
  date: string;
  monthLabel: string;
  employeeCode: string;
  employeeName: string;
  userGroup: string;
  salesRole: string;
  costCentre: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  visitedNotPlanned: number;
  totalActualVisits: number;
  status: string;
}

interface MonthlySplitRow {
  monthLabel: string;
  monthIndex: number;
  year: string;
  costCentre: string;
  salesRole: string;
  employeeCode: string;
  employeeName: string;
  activityStatus: string;
  coverage: number;
  productive: number;
  productivityPct: number;
  revenue: number;
  qty: number;
}

const TOP_N_PLAN_ROWS = 200;

function formatDateLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function dateKey(dateStr: string): string {
  return dateStr.slice(0, 10);
}

const ADHERENCE_STATUS_TIER: Record<string, Tier> = {
  Excellent: "good",
  Good: "warn",
  "Below Target": "bad",
};
const PLAN_STATUS_TIER: Record<string, Tier> = { OK: "good", "BELOW TARGET": "bad" };
const ACTIVITY_STATUS_TIER: Record<string, Tier> = { Active: "good", Inactive: "bad" };

export default function JpAdherencePage() {
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [journeyPlan, setJourneyPlan] = useState<JourneyPlanRow[]>([]);
  const [adherenceDaily, setAdherenceDaily] = useState<JpAdherenceDailyRow[]>([]);
  const [monthlySplit, setMonthlySplit] = useState<MonthlySplitRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [repQuery, setRepQuery] = useState("");
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [repDropdownOpen, setRepDropdownOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/jp-adherence", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load JP Adherence data.");
        if (!cancelled) {
          setJourneyPlan(body.journeyPlan);
          setAdherenceDaily(body.adherenceDaily);
          setMonthlySplit(body.monthlySplit);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") return <FullPageSpinner label="Loading JP Adherence…" />;
  if (status === "error") {
    return (
      <EmptyState
        icon={<CalendarCheckmark20Regular className="h-10 w-10" />}
        title="Couldn't load JP Adherence"
        description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule."
      />
    );
  }
  if (adherenceDaily.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheckmark20Regular className="h-10 w-10" />}
        title="No Journey Plan data yet"
        description="This page reflects a rolling 90-day window and refreshes automatically from the twice-daily direct-SQL sync — no manual upload needed."
      />
    );
  }

  // Global principal filter — journeyPlan/adherenceDaily/monthlySplit all persist the
  // real per-line principal (never the internal "Key Accounts" multi-Cost-Centre-rep
  // grouping token), so filtering by it works correctly even for Key Accounts reps.
  const planByPrincipal = selectedPrincipalKey ? journeyPlan.filter((r) => r.principalCostCentre === selectedPrincipalKey) : journeyPlan;
  const dailyByPrincipal = selectedPrincipalKey ? adherenceDaily.filter((r) => r.costCentre === selectedPrincipalKey) : adherenceDaily;
  const splitByPrincipal = selectedPrincipalKey ? monthlySplit.filter((r) => r.costCentre === selectedPrincipalKey) : monthlySplit;

  const availableDates = Array.from(new Set(dailyByPrincipal.map((r) => dateKey(r.date)))).sort();
  const planByDate = selectedDate ? planByPrincipal.filter((r) => dateKey(r.date) === selectedDate) : planByPrincipal;
  const dailyByDate = selectedDate ? dailyByPrincipal.filter((r) => dateKey(r.date) === selectedDate) : dailyByPrincipal;

  const availableReps = Array.from(new Map(dailyByDate.map((r) => [r.employeeCode, r.employeeName] as const)).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const filteredPlan = selectedRep ? planByDate.filter((r) => r.employeeCode === selectedRep) : planByDate;
  const filteredDaily = selectedRep ? dailyByDate.filter((r) => r.employeeCode === selectedRep) : dailyByDate;
  const filteredSplit = selectedRep ? splitByPrincipal.filter((r) => r.employeeCode === selectedRep) : splitByPrincipal;

  const selectedRepName = selectedRep ? availableReps.find(([code]) => code === selectedRep)?.[1] : undefined;
  const repSearchResults = (repQuery.trim() ? availableReps.filter(([, name]) => name.toLowerCase().includes(repQuery.trim().toLowerCase())) : availableReps).slice(0, 10);

  // Distinct-outlet-weighted averages (sum(visited)/sum(planned)) rather than a naive
  // average of daily percentages — avoids the "average of ratios" distortion when reps
  // have very different planned-outlet counts.
  const totalPlanned = filteredDaily.reduce((s, r) => s + r.outletsPlanned, 0);
  const totalVisited = filteredDaily.reduce((s, r) => s + r.outletsVisited, 0);
  const totalProductive = filteredDaily.reduce((s, r) => s + r.productiveOutlets, 0);
  const totalPlannedNotVisited = filteredDaily.reduce((s, r) => s + r.plannedNotVisited, 0);
  const totalVisitedNotPlanned = filteredDaily.reduce((s, r) => s + r.visitedNotPlanned, 0);
  const avgAdherencePct = totalPlanned > 0 ? (totalVisited / totalPlanned) * 100 : 0;
  const avgStrikeRatePct = totalVisited > 0 ? (totalProductive / totalVisited) * 100 : 0;

  // Trend by date — same distinct-outlet-weighted calculation, re-aggregated per date
  // since a date can carry several rep rows.
  const byDate = new Map<string, { planned: number; visited: number; productive: number }>();
  for (const r of filteredDaily) {
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
      "Adherence %": acc.planned > 0 ? Math.round((acc.visited / acc.planned) * 1000) / 10 : 0,
      "Strike Rate %": acc.visited > 0 ? Math.round((acc.productive / acc.visited) * 1000) / 10 : 0,
    }));

  const capped = filteredPlan.slice(0, TOP_N_PLAN_ROWS);

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Date" action={<span className="text-xs text-muted">Trailing 90-day window</span>}>
        <DateCalendarPicker availableDates={availableDates} selectedDate={selectedDate} onSelectDate={setSelectedDate} allLabel="All Dates" />
      </SectionCard>

      <SectionCard title="Filter by Rep">
        <div className="relative max-w-sm">
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
            className="w-full rounded-full border border-border bg-surface px-4 py-2 pr-9 text-sm text-foreground outline-none focus:border-secondary-blue"
          />
          {selectedRep ? (
            <button
              onClick={() => {
                setSelectedRep(null);
                setRepQuery("");
              }}
              aria-label="Clear rep filter"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <Dismiss12Regular />
            </button>
          ) : null}
          {repDropdownOpen && !selectedRep ? (
            <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
              {repSearchResults.length === 0 ? (
                <div className="px-4 py-2 text-xs text-muted">No matching reps</div>
              ) : (
                repSearchResults.map(([code, name]) => (
                  <button
                    key={code}
                    onMouseDown={() => {
                      setSelectedRep(code);
                      setRepQuery("");
                      setRepDropdownOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-accent-blue-soft"
                  >
                    {name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="JP Adherence">
        <KpiGrid>
          <KpiCard accent="coverage" label="Outlets Planned" value={<AnimatedValue value={totalPlanned} format={formatNumber} />} />
          <KpiCard accent="coverage" label="Outlets Visited" value={<AnimatedValue value={totalVisited} format={formatNumber} />} />
          <KpiCard accent="growth" label="JP Adherence" value={<span className={tierTextClass[productivityTier(avgAdherencePct)]}>{formatPercent(avgAdherencePct)}</span>} />
          <KpiCard accent="quarter" label="Strike Rate" value={<span className={tierTextClass[productivityTier(avgStrikeRatePct)]}>{formatPercent(avgStrikeRatePct)}</span>} />
          <KpiCard accent="revenue" label="Planned Not Visited" value={<AnimatedValue value={totalPlannedNotVisited} format={formatNumber} />} />
          <KpiCard accent="mission" label="Unplanned Visits" value={<AnimatedValue value={totalVisitedNotPlanned} format={formatNumber} />} />
        </KpiGrid>
      </SectionCard>

      <SectionCard title="JP Adherence Trend" action={<span className="text-xs text-muted">Adherence % vs Strike Rate %</span>}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} unit="%" />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Adherence %" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Strike Rate %" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard
        title="JP Adherence Report"
        action={
          <span className="text-xs text-muted">
            {selectedDate ? formatDateLabel(selectedDate) : "Trailing 90 days"}
            {selectedRepName ? ` · ${selectedRepName}` : ""}
            {selectedPrincipalKey ? ` · ${selectedPrincipalKey}` : ""}
          </span>
        }
      >
        <TableWrap>
          <Thead>
            <Th>Date</Th>
            <Th>Employee</Th>
            <Th>Sales Role</Th>
            <Th>Cost Centre</Th>
            <Th align="right">Planned</Th>
            <Th align="right">Visited</Th>
            <Th align="center">Adherence %</Th>
            <Th align="right">Productive</Th>
            <Th align="center">Strike Rate</Th>
            <Th align="right">Planned Not Visited</Th>
            <Th align="right">Unplanned</Th>
            <Th align="center">Status</Th>
          </Thead>
          <tbody>
            {filteredDaily.map((r) => (
              <tr key={`${r.date}|${r.employeeCode}`}>
                <Td>{formatDateLabel(r.date)}</Td>
                <Td>{r.employeeName}</Td>
                <Td>{r.salesRole}</Td>
                <Td>{r.costCentre}</Td>
                <Td align="right">{formatNumber(r.outletsPlanned)}</Td>
                <Td align="right">{formatNumber(r.outletsVisited)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.jpAdherencePct * 100)}>{(r.jpAdherencePct * 100).toFixed(1)}%</Badge>
                </Td>
                <Td align="right">{formatNumber(r.productiveOutlets)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.strikeRatePct * 100)}>{(r.strikeRatePct * 100).toFixed(1)}%</Badge>
                </Td>
                <Td align="right">{formatNumber(r.plannedNotVisited)}</Td>
                <Td align="right">{formatNumber(r.visitedNotPlanned)}</Td>
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
              <Td align="right">{formatNumber(totalPlanned)}</Td>
              <Td align="right">{formatNumber(totalVisited)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(avgAdherencePct)}>{avgAdherencePct.toFixed(1)}%</Badge>
              </Td>
              <Td align="right">{formatNumber(totalProductive)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(avgStrikeRatePct)}>{avgStrikeRatePct.toFixed(1)}%</Badge>
              </Td>
              <Td align="right">{formatNumber(totalPlannedNotVisited)}</Td>
              <Td align="right">{formatNumber(totalVisitedNotPlanned)}</Td>
              <Td align="center">—</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard
        title="Journey Plan"
        action={
          <span className="text-xs text-muted">
            Most recent 7 days only ·{" "}
            {filteredPlan.length > TOP_N_PLAN_ROWS ? `Showing top ${TOP_N_PLAN_ROWS} of ${formatNumber(filteredPlan.length)} rows` : `${formatNumber(filteredPlan.length)} rows`}
          </span>
        }
      >
        <TableWrap>
          <Thead>
            <Th>Date</Th>
            <Th>Day</Th>
            <Th>Employee</Th>
            <Th>Cost Centre</Th>
            <Th>Customer</Th>
            <Th>Territory</Th>
            <Th align="right">Route Seq</Th>
            <Th align="right">Visits/Week</Th>
            <Th align="right">Day Outlet Count</Th>
            <Th align="right">Min Target</Th>
            <Th align="center">Status</Th>
          </Thead>
          <tbody>
            {capped.map((r) => (
              <tr key={`${r.date}|${r.employeeCode}|${r.customerId}`}>
                <Td>{formatDateLabel(r.date)}</Td>
                <Td>{r.day}</Td>
                <Td>{r.employeeName}</Td>
                <Td>{r.principalCostCentre}</Td>
                <Td>{r.customerName}</Td>
                <Td>{r.territory}</Td>
                <Td align="right">{r.routeSeq}</Td>
                <Td align="right">{r.visitsPerWeek}</Td>
                <Td align="right">{formatNumber(r.dayOutletCount)}</Td>
                <Td align="right">{formatNumber(r.minOutletsTarget)}</Td>
                <Td align="center">
                  <Badge tier={PLAN_STATUS_TIER[r.status] ?? "neutral"}>{r.status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Monthly Split">
        <TableWrap>
          <Thead>
            <Th>Month</Th>
            <Th>Cost Centre</Th>
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
            {filteredSplit.map((r) => (
              <tr key={`${r.monthLabel}|${r.costCentre}|${r.salesRole}|${r.employeeCode}|${r.activityStatus}`}>
                <Td>{r.monthLabel}</Td>
                <Td>{r.costCentre}</Td>
                <Td>{r.salesRole}</Td>
                <Td>{r.employeeName}</Td>
                <Td align="center">
                  <Badge tier={ACTIVITY_STATUS_TIER[r.activityStatus] ?? "neutral"}>{r.activityStatus}</Badge>
                </Td>
                <Td align="right">{formatNumber(r.coverage)}</Td>
                <Td align="right">{formatNumber(r.productive)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.productivityPct * 100)}>{(r.productivityPct * 100).toFixed(1)}%</Badge>
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
              <Td align="right">{formatNumber(filteredSplit.reduce((s, r) => s + r.coverage, 0))}</Td>
              <Td align="right">{formatNumber(filteredSplit.reduce((s, r) => s + r.productive, 0))}</Td>
              <Td align="center">—</Td>
              <Td align="right">{formatCompact(filteredSplit.reduce((s, r) => s + r.revenue, 0))}</Td>
              <Td align="right">{formatNumber(filteredSplit.reduce((s, r) => s + r.qty, 0))}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
