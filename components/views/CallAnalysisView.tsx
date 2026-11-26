"use client";

import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { PrincipalSelector } from "@/components/dashboard/PrincipalSelector";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { RoleToggle } from "@/components/ui/RoleToggle";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { clockTime, DATE_PRESETS, DEFINITIONS, figure, monthRange, nairobiToday, partialNote, presetRange, toReport, type DatePreset } from "@/lib/callAnalysis/present";
import {
  CALL_ANALYSIS_MAX_DAYS,
  CALL_GROUP_OPTIONS,
  CALL_SOURCES,
  CALL_SOURCE_LABELS,
  type CallAnalysisResult,
  type CallGroupBy,
  type CallMetrics,
  type CallRoleFilter,
  type CallRow,
  type CallSource,
} from "@/lib/callAnalysis/types";
import { formatCompact, strikeRateTier } from "@/lib/format";
import { slugify, triggerDownload } from "@/lib/reports/download";
import { reportToExcelBlob } from "@/lib/reports/toExcel";
import { useDashboardStore } from "@/lib/store";

const PAGE_SIZE = 50;

interface Column {
  key: string;
  label: string;
  title?: string;
  /** What the column sorts on. */
  value: (row: CallRow) => number | null;
  show: (row: CallMetrics) => React.ReactNode;
  /** Left out when the grouping makes it meaningless. */
  hiddenFor?: CallGroupBy[];
}

const partial = (text: string, note: string | null) =>
  note ? (
    <span title={note} className="underline decoration-dotted underline-offset-2">
      {text}
    </span>
  ) : (
    text
  );

const COLUMNS: Column[] = [
  { key: "reps", label: "Reps", value: (r) => r.reps, show: (m) => figure(m.reps), hiddenFor: ["rep", "repDay"] },
  { key: "repDays", label: "Rep-days", title: "Days worked, added up over reps", value: (r) => r.repDays, show: (m) => figure(m.repDays), hiddenFor: ["repDay"] },
  { key: "start", label: "Start", title: "Average first activity of the day", value: (r) => r.avgStartMinutes, show: (m) => clockTime(m.avgStartMinutes) },
  { key: "close", label: "Close", title: "Average last activity of the day", value: (r) => r.avgCloseMinutes, show: (m) => clockTime(m.avgCloseMinutes) },
  { key: "hours", label: "Hours", title: "Hours between first and last activity", value: (r) => r.avgHours, show: (m) => figure(m.avgHours, 1) },
  { key: "late", label: "Late %", title: "Share of days starting after 9:30 AM", value: (r) => r.lateStartPct, show: (m) => figure(m.lateStartPct, 0, "%") },
  { key: "interval", label: "Mins / call", title: "Average minutes between calls (Pine)", value: (r) => r.avgIntervalMins, show: (m) => figure(m.avgIntervalMins, 0) },
  { key: "calls", label: "Calls", value: (r) => r.calls, show: (m) => figure(m.calls) },
  { key: "productive", label: "Productive", value: (r) => r.productive, show: (m) => figure(m.productive) },
  {
    key: "strike",
    label: "Strike rate",
    value: (r) => r.strikeRatePct,
    show: (m) => (m.strikeRatePct === null ? "—" : <Badge tier={strikeRateTier(m.strikeRatePct)}>{`${m.strikeRatePct.toFixed(1)}%`}</Badge>),
  },
  { key: "coverage", label: "Coverage", title: "Different outlets, counted once per month", value: (r) => r.coverage, show: (m) => figure(m.coverage) },
  { key: "bought", label: "Bought", title: "Different outlets that bought", value: (r) => r.productiveCoverage, show: (m) => figure(m.productiveCoverage) },
  { key: "lppc", label: "LPPC", title: "Lines per productive call", value: (r) => r.lppc, show: (m) => partial(figure(m.lppc, 1), m.lppc === null ? null : partialNote(m.lppcDataPct, "Lines")) },
  { key: "drop", label: "Drop (KES)", title: "Sales value per productive call", value: (r) => r.dropSizeValue, show: (m) => figure(m.dropSizeValue) },
  { key: "dropCases", label: "Drop (cs)", title: "Cases per productive call", value: (r) => r.dropSizeCases, show: (m) => partial(figure(m.dropSizeCases, 2), m.dropSizeCases === null ? null : partialNote(m.casesDataPct, "Cases")) },
  { key: "value", label: "Sales", value: (r) => r.value, show: (m) => formatCompact(m.value) },
];

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

const FIELD = "rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs font-semibold text-foreground outline-none";

function CallTable({ result }: { result: CallAnalysisResult }) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const columns = COLUMNS.filter((column) => !column.hiddenFor?.includes(result.groupBy));
  const heading = CALL_GROUP_OPTIONS.find((option) => option.key === result.groupBy)!.label;

  const needle = search.trim().toLowerCase();
  let rows = needle ? result.rows.filter((row) => `${row.label} ${row.detail ?? ""}`.toLowerCase().includes(needle)) : result.rows;
  const column = sort ? columns.find((c) => c.key === sort.key) : null;
  if (sort && column) {
    // Rows without the figure always go last.
    rows = [...rows].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (left === null || right === null) return left === null ? (right === null ? 0 : 1) : -1;
      return sort.descending ? right - left : left - right;
    });
  }
  const visible = rows.slice(0, shown);

  return (
    <div className="flex flex-col gap-3">
      <input
        aria-label={`Search ${heading.toLowerCase()}`}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setShown(PAGE_SIZE);
        }}
        placeholder={`Search ${heading.toLowerCase()}`}
        className={`${FIELD} w-full max-w-xs`}
      />
      <TableWrap>
        <Thead>
          <Th>{heading}</Th>
          {columns.map((c) => (
            <Th key={c.key} align="right">
              <button
                type="button"
                title={c.title ? `${c.title}. Click to sort.` : "Click to sort."}
                onClick={() => setSort((current) => ({ key: c.key, descending: current?.key === c.key ? !current.descending : true }))}
                className="font-medium uppercase tracking-wide hover:text-white"
              >
                {c.label}
                {sort?.key === c.key ? (sort.descending ? " ▼" : " ▲") : ""}
              </button>
            </Th>
          ))}
        </Thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.key}>
              <Td>
                <div className="font-semibold">{row.label}</div>
                {row.detail ? <div className="text-[11px] text-muted">{row.detail}</div> : null}
              </Td>
              {columns.map((c) => (
                <Td key={c.key} align="right">
                  {c.show(row)}
                </Td>
              ))}
            </tr>
          ))}
          <TotalRow>
            <Td>Total (all rows)</Td>
            {columns.map((c) => (
              <Td key={c.key} align="right">
                {c.show(result.total)}
              </Td>
            ))}
          </TotalRow>
        </tbody>
      </TableWrap>
      {rows.length > visible.length ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE * 4)} className="self-start text-xs font-semibold text-primary-blue hover:underline">
          Show more ({visible.length} of {rows.length})
        </button>
      ) : null}
    </div>
  );
}

export function CallAnalysisView() {
  const principals = useDashboardStore((s) => s.selectedPrincipalKeys);
  const [today] = useState(() => nairobiToday());
  const [preset, setPreset] = useState<DatePreset>("month");
  const [range, setRange] = useState(() => presetRange("month", nairobiToday()));
  const [groupBy, setGroupBy] = useState<CallGroupBy>("rep");
  const [source, setSource] = useState<CallSource | "">("");
  const [role, setRole] = useState<CallRoleFilter>("all");
  const [teamLeader, setTeamLeader] = useState("");
  const [rep, setRep] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; result: CallAnalysisResult | null; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const params = new URLSearchParams({ from: range.from, to: range.to, group: groupBy, role });
  if (source) params.set("source", source);
  if (teamLeader) params.set("teamLeader", teamLeader);
  if (rep) params.set("rep", rep);
  for (const principal of principals) params.append("principal", principal);
  const query = params.toString();
  const requestKey = `${query}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/coverage/call-analysis?${requestKey.split("#")[0]}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((body as { error?: string }).error || "Failed to load the call analysis.");
        setLoaded({ query: requestKey, result: body as CallAnalysisResult, error: "" });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoaded({ query: requestKey, result: null, error: error.message });
      });
    return () => controller.abort();
  }, [requestKey]);

  const loading = loaded?.query !== requestKey;
  // The last figures stay on screen, dimmed, while the next ones load.
  const result = loaded?.result ?? null;
  const error = loading ? "" : loaded.error;

  function choosePreset(next: Exclude<DatePreset, "custom">) {
    setPreset(next);
    setRange(presetRange(next, today));
  }

  function setDay(edge: "from" | "to", day: string) {
    if (!day) return;
    setPreset("custom");
    setRange((current) => {
      const next = { ...current, [edge]: day };
      // Keep the range the right way round: moving one end past the other brings that one with it.
      if (next.from > next.to) return { from: day, to: day };
      return next;
    });
  }

  const firstDay = result?.availability.reduce<string | null>((min, a) => (a.first && (!min || a.first < min) ? a.first : min), null) ?? null;
  const months: string[] = [];
  if (firstDay) {
    for (let cursor = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`); cursor.toISOString().slice(0, 7) >= firstDay.slice(0, 7) && months.length < 24; cursor.setUTCMonth(cursor.getUTCMonth() - 1)) {
      months.push(cursor.toISOString().slice(0, 7));
    }
  }
  const wholeMonth = months.find((month) => {
    const r = monthRange(month, today);
    return r.from === range.from && r.to === range.to;
  });
  const monthName = (month: string) => new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });

  // Systems whose data starts inside or after the chosen dates, so a short figure isn't read as a quiet period.
  const late = (result?.availability ?? []).filter((a) => (!source || a.source === source) && a.first && a.first > range.from);

  function exportExcel() {
    if (!result) return;
    const report = toReport(result, [
      ["Dates", `${result.from} to ${result.to}`],
      ["Principal", principals.length ? principals.join(", ") : "All"],
      ["System", source ? CALL_SOURCE_LABELS[source] : "All"],
      ["Sales role", role === "all" ? "All" : role],
      ["Team leader", teamLeader || "All"],
      ["Rep", rep ? (result.options.reps.find((r) => r.key === rep)?.label ?? rep) : "All"],
    ]);
    triggerDownload(reportToExcelBlob(report), `${slugify(report.title)}.xlsx`);
  }

  const total = result?.total;
  const trend = (result?.trend ?? []).map((row) => ({
    day: row.key.slice(5),
    calls: row.calls,
    productive: row.productive,
    strike: row.strikeRatePct,
    lppc: row.lppc,
    drop: row.dropSizeValue,
  }));

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Call analysis filters" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-[0_4px_14px_rgba(11,61,53,0.08)]">
        <div className="flex flex-wrap items-center gap-1.5">
          {DATE_PRESETS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={preset === option.key}
              onClick={() => choosePreset(option.key as Exclude<DatePreset, "custom">)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${preset === option.key ? "bg-primary-blue text-white" : "bg-background-elevated text-muted-strong hover:text-primary-blue"}`}
            >
              {option.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {loading ? <Spinner className="h-4 w-4 text-accent-blue" /> : null}
            <Button variant="secondary" onClick={exportExcel} disabled={!result || loading || result.rows.length === 0}>
              Export Excel
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-2.5 gap-y-3">
          <Filter label="From">
            <input type="date" value={range.from} max={today} onChange={(e) => setDay("from", e.target.value)} className={FIELD} />
          </Filter>
          <Filter label="To">
            <input type="date" value={range.to} max={today} onChange={(e) => setDay("to", e.target.value)} className={FIELD} />
          </Filter>
          <Filter label="Whole month">
            <select
              value={wholeMonth ?? ""}
              onChange={(e) => {
                if (!e.target.value) return;
                setPreset("custom");
                setRange(monthRange(e.target.value, today));
              }}
              className={FIELD}
            >
              <option value="">Choose a month</option>
              {months.map((month) => (
                <option key={month} value={month}>
                  {monthName(month)}
                </option>
              ))}
            </select>
          </Filter>
          <PrincipalSelector bare />
          <Filter label="System">
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value as CallSource | "");
                setRep("");
              }}
              className={FIELD}
            >
              <option value="">All systems</option>
              {CALL_SOURCES.map((key) => (
                <option key={key} value={key}>
                  {CALL_SOURCE_LABELS[key]}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Team leader">
            <select value={teamLeader} onChange={(e) => setTeamLeader(e.target.value)} className={`${FIELD} max-w-[180px]`}>
              <option value="">All team leaders</option>
              {teamLeader && !result?.options.teamLeaders.includes(teamLeader) ? <option value={teamLeader}>{teamLeader}</option> : null}
              {(result?.options.teamLeaders ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Rep">
            <select value={rep} onChange={(e) => setRep(e.target.value)} className={`${FIELD} max-w-[240px]`}>
              <option value="">All reps</option>
              {rep && !result?.options.reps.some((r) => r.key === rep) ? <option value={rep}>Selected rep (no activity here)</option> : null}
              {(result?.options.reps ?? []).map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </Filter>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Sales role</span>
            <RoleToggle value={role} onChange={setRole} />
          </div>
        </div>
        {late.length > 0 ? (
          <p className="text-[11px] text-muted" role="note">
            Part of these dates is before the data held: {late.map((a) => `${CALL_SOURCE_LABELS[a.source]} from ${a.first}`).join("; ")}.
          </p>
        ) : null}
      </section>

      {error ? (
        <EmptyState title="Couldn't load the call analysis" description={`${error} (Up to ${CALL_ANALYSIS_MAX_DAYS} days at a time.)`} action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>} />
      ) : !result || !total ? (
        <FullPageSpinner label="Loading the call analysis…" />
      ) : result.rows.length === 0 ? (
        loading ? <FullPageSpinner label="Loading the call analysis…" /> : <EmptyState title="No calls for these filters" description="Try other dates, or clear the principal, system, team leader, rep or role filter." />
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          <KpiGrid>
            <KpiCard accent="coverage" label="Productive calls" value={figure(total.productive)} sublabel={total.calls === null ? "Calls without a sale are not recorded" : `of ${figure(total.calls)} calls · ${figure(total.productivePerRepDay, 1)} per rep-day`} />
            <KpiCard accent="coverage" label="Strike rate" value={figure(total.strikeRatePct, 1, "%")} sublabel="Productive ÷ calls" />
            <KpiCard accent="coverage" label="Outlets covered" value={figure(total.coverage)} sublabel={`${figure(total.productiveCoverage)} bought · ${figure(total.reps)} reps`} />
            <KpiCard accent="mission" label="LPPC" value={figure(total.lppc, 1)} sublabel={total.lppc !== null && partialNote(total.lppcDataPct, "Lines") ? `Lines held for ${total.lppcDataPct!.toFixed(0)}% of productive` : "Lines per productive call"} />
            <KpiCard accent="revenue" label="Drop size" size="md" value={`KES ${figure(total.dropSizeValue)}`} sublabel={total.dropSizeCases === null ? "Per productive call" : `${figure(total.dropSizeCases, 2)} cases per productive call`} />
            <KpiCard accent="quarter" label="Start to close" size="md" value={`${clockTime(total.avgStartMinutes)} – ${clockTime(total.avgCloseMinutes)}`} sublabel={`${figure(total.avgHours, 1)} hours · ${figure(total.lateStartPct, 0, "%")} late starts`} />
          </KpiGrid>

          {trend.length > 1 ? (
            <ChartGrid>
              <SectionCard title="Calls and strike rate by day">
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={trend} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                    <XAxis dataKey="day" stroke={CHART_AXIS_COLOR} fontSize={11} />
                    <YAxis yAxisId="count" stroke={CHART_AXIS_COLOR} fontSize={11} />
                    <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} unit="%" stroke={CHART_AXIS_COLOR} fontSize={11} />
                    <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="count" dataKey="calls" name="Calls" fill="var(--accent-blue)" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="count" dataKey="productive" name="Productive" fill="var(--primary-blue)" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="pct" type="monotone" dataKey="strike" name="Strike rate %" stroke="var(--accent-green)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </SectionCard>
              <SectionCard title="LPPC and drop size by day">
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={trend} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                    <XAxis dataKey="day" stroke={CHART_AXIS_COLOR} fontSize={11} />
                    <YAxis yAxisId="drop" tickFormatter={(v: number) => formatCompact(v)} stroke={CHART_AXIS_COLOR} fontSize={11} />
                    <YAxis yAxisId="lines" orientation="right" stroke={CHART_AXIS_COLOR} fontSize={11} />
                    <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="drop" dataKey="drop" name="Drop size (KES)" fill="var(--primary-blue)" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="lines" type="monotone" dataKey="lppc" name="LPPC" stroke="var(--accent-green)" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </SectionCard>
            </ChartGrid>
          ) : null}

          <SectionCard
            title="Analysis"
            action={
              <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                Group by
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as CallGroupBy)} className={FIELD}>
                  {CALL_GROUP_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            }
          >
            <CallTable key={result.groupBy} result={result} />
          </SectionCard>

          <details className="rounded-xl border border-border bg-surface px-4 py-3 text-xs">
            <summary className="cursor-pointer font-semibold text-brand-navy">How these figures are worked out</summary>
            <dl className="mt-2 grid gap-1.5">
              {DEFINITIONS.map(([name, meaning]) => (
                <div key={name}>
                  <dt className="inline font-semibold">{name}: </dt>
                  <dd className="inline text-muted">{meaning}</dd>
                </div>
              ))}
              <div>
                <dt className="inline font-semibold">Principal: </dt>
                <dd className="inline text-muted">
                  A Pine rep sits under their Employee Roaster principal. Choosing principals takes every rep whose own principal or Team Leader covers them, with the rep&apos;s whole day, as on Timestamps.
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold">Data held: </dt>
                <dd className="inline text-muted">{result.availability.map((a) => `${CALL_SOURCE_LABELS[a.source]} ${a.first ? `${a.first} to ${a.last}` : "none"}`).join("; ")}.</dd>
              </div>
            </dl>
          </details>
        </div>
      )}
    </div>
  );
}
