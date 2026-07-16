"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
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
import { formatCompact, formatNumber, formatPercent, productivityTier, tierTextClass } from "@/lib/format";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle, CHART_COLORS } from "@/components/charts/theme";
import { Clock20Regular, Dismiss12Regular } from "@fluentui/react-icons";

interface RepCallRow {
  date: string;
  employeeCode: string;
  salesRep: string;
  employeeGroup: string;
  salesRole: string;
  region: string;
  callSequence: number;
  callTime: string;
  callOutcome: string;
  noSaleReason: string | null;
  outletId: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  costCentresBought: string;
  intervalMins: number | null;
  documents: number;
  sales: number;
  qty: number;
  firstCallOfDay: string;
  lastCallOfDay: string;
  hoursInDay: number;
  callsInDay: number;
  productiveInDay: number;
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
  costCentresCovered: string;
  sales: number;
}

// Africa/Nairobi is a fixed UTC+3 offset year-round (no DST) — used instead of relying
// on the browser's own local timezone, which would show wrong times for anyone viewing
// the dashboard from outside Kenya.
const NAIROBI_UTC_OFFSET_HOURS = 3;

function nairobiHour(iso: string): number {
  return (new Date(iso).getUTCHours() + NAIROBI_UTC_OFFSET_HOURS) % 24;
}

function formatTime12h(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "Africa/Nairobi", hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short" });
}

function dateKey(dateStr: string): string {
  return dateStr.slice(0, 10);
}

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${period}`;
}

interface RoleStats {
  totalCalls: number;
  productiveCalls: number;
  strikeRate: number;
  outletsCovered: number;
  avgIntervalMins: number | null;
  sales: number;
}

/** Revenue attributable to `principalKey` specifically (sum of `sales` only on calls
 *  whose Cost Centres include it) — unlike call/productivity counts, "Sales" is a
 *  genuinely principal-scoped figure, so it stays narrowed even though the rows
 *  passed in may now span every principal a rep touched that day (see
 *  `principalFiltered` below). Sums every row's sales when `principalKey` is null. */
function principalSales(rows: RepCallRow[], principalKey: string | null): number {
  const scoped = principalKey ? rows.filter((c) => c.costCentresBought.split(", ").filter(Boolean).includes(principalKey)) : rows;
  return scoped.reduce((s, c) => s + c.sales, 0);
}

function computeRoleStats(rows: RepCallRow[], principalKey: string | null): RoleStats {
  const totalCalls = rows.length;
  const productiveCalls = rows.filter((c) => c.callOutcome === "Sale").length;
  const strikeRate = totalCalls > 0 ? Math.round((productiveCalls / totalCalls) * 1000) / 10 : 0;
  const outletsCovered = new Set(rows.map((c) => c.outletId)).size;
  const intervals = rows.map((c) => c.intervalMins).filter((v): v is number => v !== null);
  const avgIntervalMins = intervals.length > 0 ? Math.round((intervals.reduce((s, v) => s + v, 0) / intervals.length) * 10) / 10 : null;
  const sales = principalSales(rows, principalKey);
  return { totalCalls, productiveCalls, strikeRate, outletsCovered, avgIntervalMins, sales };
}

export default function TimestampsPage() {
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [calls, setCalls] = useState<RepCallRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [repQuery, setRepQuery] = useState("");
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [repDropdownOpen, setRepDropdownOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/timestamps", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load Timestamps data.");
        if (!cancelled) {
          setCalls(body.calls);
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

  if (status === "loading") return <FullPageSpinner label="Loading Timestamps…" />;
  if (status === "error") {
    return (
      <EmptyState
        icon={<Clock20Regular className="h-10 w-10" />}
        title="Couldn't load Timestamps"
        description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule."
      />
    );
  }
  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<Clock20Regular className="h-10 w-10" />}
        title="No call activity recorded yet this month"
        description="This page always reflects the current calendar month only and refreshes automatically from the direct-SQL sync, which runs every 10 minutes — no manual upload needed."
      />
    );
  }

  // Principal filter (the global selector, same one every other page respects) — scoped
  // by REP-DAY relevance, not by call, otherwise every No-Sale call gets silently
  // dropped (a No-Sale visit has no Cost Centre, since nothing was bought) and Strike
  // Rate degenerates to a meaningless 100% for every rep once any principal is
  // selected. A rep-day counts as relevant once they made at least one Sale call
  // attributable to the selected principal that day; every one of that rep's calls
  // that day (any outcome, any Cost Centre) then counts toward Calls Made/Productive/
  // Strike Rate/Outlets Covered — "Sales" stays principal-scoped via principalSales().
  const principalFiltered = (() => {
    if (!selectedPrincipalKey) return calls;
    const relevantRepDays = new Set(
      calls
        .filter((c) => c.costCentresBought.split(", ").filter(Boolean).includes(selectedPrincipalKey))
        .map((c) => `${dateKey(c.date)}|${c.employeeCode}`)
    );
    return calls.filter((c) => relevantRepDays.has(`${dateKey(c.date)}|${c.employeeCode}`));
  })();

  const availableDates = Array.from(new Set(principalFiltered.map((c) => dateKey(c.date)))).sort();
  const dateFiltered = selectedDate ? principalFiltered.filter((c) => dateKey(c.date) === selectedDate) : principalFiltered;

  const availableReps = Array.from(new Map(dateFiltered.map((c) => [c.employeeCode, c.salesRep] as const)).entries()).sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  const filteredCalls = selectedRep ? dateFiltered.filter((c) => c.employeeCode === selectedRep) : dateFiltered;

  const selectedRepName = selectedRep ? availableReps.find(([code]) => code === selectedRep)?.[1] : undefined;
  const repSearchResults = (repQuery.trim() ? availableReps.filter(([, name]) => name.toLowerCase().includes(repQuery.trim().toLowerCase())) : availableReps).slice(
    0,
    10
  );

  const primaryCalls = filteredCalls.filter((c) => c.salesRole === "Primary Sales");
  const secondaryCalls = filteredCalls.filter((c) => c.salesRole === "Secondary Sales");
  const primaryStats = computeRoleStats(primaryCalls, selectedPrincipalKey);
  const secondaryStats = computeRoleStats(secondaryCalls, selectedPrincipalKey);
  // The role toggle scopes the table + chart below to one role — the two KPI
  // sections above stay computed from the full filteredCalls set regardless
  // (each is already scoped to its own role) and are just shown/hidden.
  const roleFilteredCalls = roleFilter === "all" ? filteredCalls : filteredCalls.filter((c) => c.salesRole === roleFilter);
  const overallProductive = roleFilteredCalls.filter((c) => c.callOutcome === "Sale").length;
  const overallStrikeRate = roleFilteredCalls.length > 0 ? Math.round((overallProductive / roleFilteredCalls.length) * 1000) / 10 : 0;
  const overallOutletsCovered = new Set(roleFilteredCalls.map((c) => c.outletId)).size;
  const overallSales = principalSales(roleFilteredCalls, selectedPrincipalKey);

  // Rep Daily Summary — split by Sales Role, not just Rep x Day: a TDR touching both
  // Mars and non-Mars Cost Centres in the same day genuinely has mixed-role calls, so
  // recomputing every stat fresh from each role-specific group (rather than trusting
  // RepCall's precomputed whole-day fields) is what actually "splits everything."
  const byRepDayRole = new Map<string, RepCallRow[]>();
  for (const c of roleFilteredCalls) {
    const key = `${c.date}|${c.employeeCode}|${c.salesRole}`;
    if (!byRepDayRole.has(key)) byRepDayRole.set(key, []);
    byRepDayRole.get(key)!.push(c);
  }
  const repDaySummaries: RepDaySummary[] = Array.from(byRepDayRole.values()).map((group) => {
    const first = group[0];
    const sorted = [...group].sort((a, b) => new Date(a.callTime).getTime() - new Date(b.callTime).getTime());
    const outlets = new Set(group.map((c) => c.outletId));
    const intervals = group.map((c) => c.intervalMins).filter((v): v is number => v !== null);
    const costCentres = new Set<string>();
    group.forEach((c) => c.costCentresBought.split(", ").filter(Boolean).forEach((cc) => costCentres.add(cc)));
    const productive = group.filter((c) => c.callOutcome === "Sale").length;
    const firstCall = sorted[0].callTime;
    const lastCall = sorted[sorted.length - 1].callTime;
    const hoursInDay = Math.round(((new Date(lastCall).getTime() - new Date(firstCall).getTime()) / 3600000) * 100) / 100;
    return {
      date: first.date,
      employeeCode: first.employeeCode,
      salesRep: first.salesRep,
      region: first.region,
      salesRole: first.salesRole,
      firstCall,
      lastCall,
      hoursInDay,
      callsMade: group.length,
      productiveCalls: productive,
      strikeRatePct: group.length > 0 ? Math.round((productive / group.length) * 1000) / 10 : 0,
      outletsCovered: outlets.size,
      avgIntervalMins: intervals.length > 0 ? Math.round((intervals.reduce((s, v) => s + v, 0) / intervals.length) * 10) / 10 : null,
      costCentresCovered: Array.from(costCentres).sort().join(", "),
      sales: principalSales(group, selectedPrincipalKey),
    };
  });
  repDaySummaries.sort((a, b) => (a.date === b.date ? a.salesRep.localeCompare(b.salesRep) : a.date.localeCompare(b.date)));

  // Calls by time of day, split Primary vs Secondary, in Nairobi local time.
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ name: hourLabel(h), Primary: 0, Secondary: 0 }));
  for (const c of roleFilteredCalls) {
    const h = nairobiHour(c.callTime);
    if (c.salesRole === "Primary Sales") hourBuckets[h].Primary += 1;
    else hourBuckets[h].Secondary += 1;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Date" action={<span className="text-xs text-muted">Current calendar month only</span>}>
        <DateCalendarPicker availableDates={availableDates} selectedDate={selectedDate} onSelectDate={setSelectedDate} allLabel="All Month" />
      </SectionCard>

      <SectionCard title="Sales Role">
        <RoleToggle value={roleFilter} onChange={setRoleFilter} />
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

      {roleFilter !== "Secondary Sales" ? (
        <SectionCard title="Primary Sales">
          <KpiGrid>
            <KpiCard accent="coverage" label="Calls" value={<AnimatedValue value={primaryStats.totalCalls} format={formatNumber} />} />
            <KpiCard accent="coverage" label="Productive Calls" value={<AnimatedValue value={primaryStats.productiveCalls} format={formatNumber} />} />
            <KpiCard
              accent="growth"
              label="Strike Rate"
              value={<span className={tierTextClass[productivityTier(primaryStats.strikeRate)]}>{formatPercent(primaryStats.strikeRate)}</span>}
            />
            <KpiCard accent="quarter" label="Outlets Covered" value={<AnimatedValue value={primaryStats.outletsCovered} format={formatNumber} />} />
            <KpiCard accent="revenue" label="Avg Interval Between Calls" value={primaryStats.avgIntervalMins !== null ? `${primaryStats.avgIntervalMins.toFixed(0)}m` : "—"} />
            <KpiCard accent="mission" label="Sales" value={<AnimatedValue value={primaryStats.sales} format={formatCompact} />} />
          </KpiGrid>
        </SectionCard>
      ) : null}

      {roleFilter !== "Primary Sales" ? (
        <SectionCard title="Secondary Sales">
          <KpiGrid>
            <KpiCard accent="coverage" label="Calls" value={<AnimatedValue value={secondaryStats.totalCalls} format={formatNumber} />} />
            <KpiCard accent="coverage" label="Productive Calls" value={<AnimatedValue value={secondaryStats.productiveCalls} format={formatNumber} />} />
            <KpiCard
              accent="growth"
              label="Strike Rate"
              value={<span className={tierTextClass[productivityTier(secondaryStats.strikeRate)]}>{formatPercent(secondaryStats.strikeRate)}</span>}
            />
            <KpiCard accent="quarter" label="Outlets Covered" value={<AnimatedValue value={secondaryStats.outletsCovered} format={formatNumber} />} />
            <KpiCard
              accent="revenue"
              label="Avg Interval Between Calls"
              value={secondaryStats.avgIntervalMins !== null ? `${secondaryStats.avgIntervalMins.toFixed(0)}m` : "—"}
            />
            <KpiCard accent="mission" label="Sales" value={<AnimatedValue value={secondaryStats.sales} format={formatCompact} />} />
          </KpiGrid>
        </SectionCard>
      ) : null}

      <SectionCard title="Calls by Time of Day (Primary vs Secondary)" action={<span className="text-xs text-muted">Africa/Nairobi time</span>}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={hourBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} interval={1} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Primary" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Secondary" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard
        title="Rep Daily Summary"
        action={
          <span className="text-xs text-muted">
            {selectedDate ? formatDateLabel(selectedDate) : "Current calendar month"}
            {selectedRepName ? ` · ${selectedRepName}` : ""}
            {selectedPrincipalKey ? ` · ${selectedPrincipalKey}` : ""}
          </span>
        }
      >
        <TableWrap>
          <Thead>
            <Th>Date</Th>
            <Th>Sales Rep</Th>
            <Th>Sales Role</Th>
            <Th>Region</Th>
            <Th>First Call</Th>
            <Th>Last Call</Th>
            <Th align="right">Hours in Day</Th>
            <Th align="right">Calls Made</Th>
            <Th align="right">Productive</Th>
            <Th align="center">Strike Rate</Th>
            <Th align="right">Outlets Covered</Th>
            <Th align="right">Avg Interval (mins)</Th>
            <Th align="right">Sales</Th>
          </Thead>
          <tbody>
            {repDaySummaries.map((r) => (
              <tr key={`${r.date}|${r.employeeCode}|${r.salesRole}`}>
                <Td>{formatDateLabel(r.date)}</Td>
                <Td>{r.salesRep}</Td>
                <Td>{r.salesRole}</Td>
                <Td>{r.region}</Td>
                <Td>{formatTime12h(r.firstCall)}</Td>
                <Td>{formatTime12h(r.lastCall)}</Td>
                <Td align="right">{r.hoursInDay.toFixed(1)}</Td>
                <Td align="right">{formatNumber(r.callsMade)}</Td>
                <Td align="right">{formatNumber(r.productiveCalls)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.strikeRatePct)}>{r.strikeRatePct.toFixed(1)}%</Badge>
                </Td>
                <Td align="right">{formatNumber(r.outletsCovered)}</Td>
                <Td align="right">{r.avgIntervalMins !== null ? r.avgIntervalMins.toFixed(0) : "—"}</Td>
                <Td align="right">{formatCompact(r.sales)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td align="right">—</Td>
              <Td align="right">{formatNumber(roleFilteredCalls.length)}</Td>
              <Td align="right">{formatNumber(overallProductive)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(overallStrikeRate)}>{overallStrikeRate.toFixed(1)}%</Badge>
              </Td>
              <Td align="right">{formatNumber(overallOutletsCovered)}</Td>
              <Td align="right">—</Td>
              <Td align="right">{formatCompact(overallSales)}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
