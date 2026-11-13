"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Calendar20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AchievementBadge } from "@/components/ui/Badge";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { isKenyaWorkingDay } from "@/lib/kenyaBusinessCalendar";
import {
  growthPct,
  nairobiToday,
  proratedTarget,
  seriesByBucket,
  sumRange,
  targetDates,
  totalsByPrincipal,
  type RangeDailyRow,
  type SalesDateRange,
} from "@/lib/salesRange";
import type { SalesSection } from "@/components/dashboard/SalesSectionNav";
import { CHART_COLORS, CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

interface RangeResponse {
  from: string;
  to: string;
  daily: RangeDailyRow[];
  previous: { from: string; to: string; daily: RangeDailyRow[] };
  lastYear: { from: string; to: string; daily: RangeDailyRow[] };
  latestDate: string | null;
  reps: { employeeCode: string | null; name: string; sapName: string; principals: string[]; revenue: number; grossProfit: number; cases: number; previousRevenue: number }[];
  customers: { customerName: string; sapName: string; revenue: number; grossProfit: number; cases: number }[];
  brands: { principal: string; brand: string; revenue: number; grossProfit: number; cases: number }[];
  customerDataFrom: string | null;
}

function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

function rangeText(from: string, to: string): string {
  return from === to ? dateLabel(from) : `${dateLabel(from)} – ${dateLabel(to)}`;
}

function GrowthCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return <span className={value >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{formatPercent(value, { signed: true })}</span>;
}

/** Every Sales Performance section, for a date range on the SAP daily feed (see SalesRangeBar). */
export function SalesRangeView({ section, range }: { section: SalesSection; range: SalesDateRange }) {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const principalParam = selectedPrincipalKeys.join(",");
  const requestKey = `${range.from}|${range.to}|${principalParam}`;
  // `key` is the request the shown data (or error) belongs to; while it differs from requestKey a new one is loading.
  const [state, setState] = useState<{ key: string | null; data: RangeResponse | null; error: string | null }>({ key: null, data: null, error: null });
  const loading = state.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (principalParam) params.set("principals", principalParam);
    fetch(`/api/sales/range?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load sales for this date range.");
        setState({ key: requestKey, data: body as RangeResponse, error: null });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState({ key: requestKey, data: null, error: error.message });
      });
    return () => controller.abort();
  }, [range.from, range.to, principalParam, requestKey]);

  const derived = useMemo(() => {
    const data = state.data;
    if (!data || !dataset) return null;
    const today = nairobiToday();
    const totals = sumRange(data.daily);
    const previous = sumRange(data.previous.daily);
    const lastYear = sumRange(data.lastYear.daily);
    const datesForTarget = targetDates(range, today);
    const target = proratedTarget(dataset.monthlySales, datesForTarget);
    const workingDays = datesForTarget.filter((date) => isKenyaWorkingDay(date)).length;
    const series = seriesByBucket(data.daily, range);
    const previousSeries = seriesByBucket(data.previous.daily, { ...range, ...data.previous });
    const lastYearSeries = seriesByBucket(data.lastYear.daily, { ...range, ...data.lastYear });
    const chartRows = series.map((bucket, index) => ({
      label: bucket.label,
      revenue: bucket.revenue,
      grossProfit: bucket.grossProfit,
      target: proratedTarget(dataset.monthlySales, bucket.dates.filter((date) => date <= today)),
      previous: previousSeries[index]?.revenue ?? null,
      lastYear: lastYearSeries[index]?.revenue ?? null,
    }));
    const previousByPrincipal = new Map(totalsByPrincipal(data.previous.daily).map((row) => [row.principal, row.revenue]));
    const lastYearByPrincipal = new Map(totalsByPrincipal(data.lastYear.daily).map((row) => [row.principal, row.revenue]));
    const principals = totalsByPrincipal(data.daily).map((row) => {
      const principalTarget = proratedTarget(dataset.monthlySales.filter((sale) => sale.principal === row.principal), datesForTarget);
      return {
        ...row,
        target: principalTarget,
        achievementPct: principalTarget ? (row.revenue / principalTarget) * 100 : null,
        sharePct: totals.revenue ? (row.revenue / totals.revenue) * 100 : null,
        vsPrevious: growthPct(row.revenue, previousByPrincipal.get(row.principal)),
        vsLastYear: growthPct(row.revenue, lastYearByPrincipal.get(row.principal)),
      };
    });
    return {
      data,
      totals,
      previous,
      lastYear,
      target,
      achievementPct: target ? (totals.revenue / target) * 100 : null,
      dailyAverage: workingDays > 0 ? totals.revenue / workingDays : null,
      workingDays,
      chartRows,
      principals,
    };
  }, [state.data, dataset, range]);

  if (loading && !state.data) return <FullPageSpinner label="Loading sales for this date range…" />;
  if (state.error || !derived) {
    return <EmptyState icon={<Calendar20Regular className="h-10 w-10" />} title="Couldn't load this date range" description={state.error ?? "Try another range, or refresh the page."} />;
  }

  const { data, totals, previous, lastYear, target, achievementPct, dailyAverage, workingDays, chartRows, principals } = derived;
  const vsPrevious = growthPct(totals.revenue, previous.revenue);
  const vsLastYear = growthPct(totals.revenue, lastYear.revenue);
  const header = (
    <p className="text-xs text-muted">
      <span className="font-semibold text-brand-navy">{rangeText(data.from, data.to)}</span> · grouped by {range.groupBy} · compared with {rangeText(data.previous.from, data.previous.to)} (previous period) and{" "}
      {rangeText(data.lastYear.from, data.lastYear.to)} (same dates last year)
      {data.latestDate ? ` · SAP daily sales through ${dateLabel(data.latestDate)}` : ""}
      {loading ? " · updating…" : ""}
    </p>
  );
  const noSales = data.daily.length === 0;

  const kpis = (
    <KpiGrid>
      <KpiCard accent="revenue" size="fit" label="Revenue" value={formatCompact(totals.revenue)} delta={vsPrevious !== null ? { value: vsPrevious, caption: "vs previous period" } : undefined} />
      <KpiCard accent="mission" size="fit" label="Target (pro-rated)" value={target === null ? "—" : formatCompact(target)} sublabel={`${workingDays} working day${workingDays === 1 ? "" : "s"}`} />
      <KpiCard accent="mission" size="fit" label="Achievement" value={achievementPct === null ? "N/T" : formatPercent(achievementPct)} />
      <KpiCard accent="growth" size="fit" label="Gross Profit" value={formatCompact(totals.grossProfit)} sublabel={totals.grossMarginPct === null ? undefined : `${formatPercent(totals.grossMarginPct)} margin`} />
      <KpiCard accent="growth" size="fit" label="vs Same Dates LY" value={vsLastYear === null ? "—" : formatPercent(vsLastYear, { signed: true })} sublabel={`LY ${formatCompact(lastYear.revenue)}`} />
      <KpiCard accent="quarter" size="fit" label="Avg / Working Day" value={dailyAverage === null ? "—" : formatCompact(dailyAverage)} />
    </KpiGrid>
  );

  const principalTable = (
    <SectionCard title="By principal" action={<span className="text-xs text-muted">{principals.length} principal{principals.length === 1 ? "" : "s"} with sales in the range</span>}>
      <TableWrap>
        <Thead>
          <Th>Principal</Th>
          <Th align="right">Revenue</Th>
          <Th align="right">Target (pro-rated)</Th>
          <Th align="center">Achievement</Th>
          <Th align="right">Gross Profit</Th>
          <Th align="right">GP %</Th>
          <Th align="right">Share</Th>
          <Th align="right">vs Previous</Th>
          <Th align="right">vs LY</Th>
        </Thead>
        <tbody>
          {principals.map((row) => (
            <tr key={row.principal}>
              <Td className="font-semibold">{row.principal}</Td>
              <Td align="right">{formatCompact(row.revenue)}</Td>
              <Td align="right">{row.target === null ? "—" : formatCompact(row.target)}</Td>
              <Td align="center"><AchievementBadge pct={row.achievementPct} /></Td>
              <Td align="right">{formatCompact(row.grossProfit)}</Td>
              <Td align="right">{row.grossMarginPct === null ? "—" : formatPercent(row.grossMarginPct)}</Td>
              <Td align="right">{row.sharePct === null ? "—" : formatPercent(row.sharePct)}</Td>
              <Td align="right"><GrowthCell value={row.vsPrevious} /></Td>
              <Td align="right"><GrowthCell value={row.vsLastYear} /></Td>
            </tr>
          ))}
          <TotalRow>
            <Td>Total</Td>
            <Td align="right">{formatCompact(totals.revenue)}</Td>
            <Td align="right">{target === null ? "—" : formatCompact(target)}</Td>
            <Td align="center"><AchievementBadge pct={achievementPct} /></Td>
            <Td align="right">{formatCompact(totals.grossProfit)}</Td>
            <Td align="right">{totals.grossMarginPct === null ? "—" : formatPercent(totals.grossMarginPct)}</Td>
            <Td align="right">100%</Td>
            <Td align="right"><GrowthCell value={vsPrevious} /></Td>
            <Td align="right"><GrowthCell value={vsLastYear} /></Td>
          </TotalRow>
        </tbody>
      </TableWrap>
    </SectionCard>
  );

  const revenueChart = (
    <SectionCard title={`Revenue by ${range.groupBy} vs target`} action={<span className="text-xs text-muted">Target pro-rated by working days</span>}>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={11} />
          <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
          <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="target" name="Target" stroke={CHART_COLORS[3] ?? "#d97706"} strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </SectionCard>
  );

  if (noSales && section !== "customers") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState icon={<Calendar20Regular className="h-10 w-10" />} title="No sales in this date range" description={data.latestDate ? `SAP daily sales currently run through ${dateLabel(data.latestDate)}.` : "There are no SAP daily sales for this selection yet."} />
      </div>
    );
  }

  if (section === "cockpit") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {kpis}
        {revenueChart}
        {principalTable}
      </div>
    );
  }

  if (section === "executive") {
    const withTarget = principals.filter((row) => row.achievementPct !== null);
    const behind = [...withTarget].sort((a, b) => (a.achievementPct ?? 0) - (b.achievementPct ?? 0)).slice(0, 5);
    const growing = principals.filter((row) => row.vsPrevious !== null && (row.vsPrevious ?? 0) > 0).sort((a, b) => (b.vsPrevious ?? 0) - (a.vsPrevious ?? 0)).slice(0, 5);
    const declining = principals.filter((row) => row.vsPrevious !== null && (row.vsPrevious ?? 0) < 0).sort((a, b) => (a.vsPrevious ?? 0) - (b.vsPrevious ?? 0)).slice(0, 5);
    const list = (title: string, rows: typeof principals, value: (row: (typeof principals)[number]) => React.ReactNode, empty: string) => (
      <SectionCard title={title}>
        {rows.length === 0 ? (
          <p className="px-1 py-4 text-sm text-muted">{empty}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((row) => (
              <li key={row.principal} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-semibold text-brand-navy">{row.principal}</span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  {formatCompact(row.revenue)} {value(row)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    );
    return (
      <div className="flex flex-col gap-4">
        {header}
        {kpis}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {list("Furthest behind target", behind, (row) => <AchievementBadge pct={row.achievementPct} />, "No principal has a target in this range.")}
          {list("Growing fastest vs previous period", growing, (row) => <GrowthCell value={row.vsPrevious} />, "No principal grew on the previous period.")}
          {list("Declining vs previous period", declining, (row) => <GrowthCell value={row.vsPrevious} />, "No principal declined.")}
        </div>
        {revenueChart}
      </div>
    );
  }

  if (section === "time") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {kpis}
        <SectionCard title={`Revenue by ${range.groupBy}: this range, previous period and same dates last year`} action={<span className="text-xs text-muted">Compared position by position</span>}>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="revenue" name="This range" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="previous" name="Previous period" stroke={CHART_COLORS[2] ?? "#64748b"} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
              <Line type="monotone" dataKey="lastYear" name="Same dates last year" stroke={CHART_COLORS[3] ?? "#d97706"} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title={`By ${range.groupBy}`}>
          <TableWrap>
            <Thead>
              <Th>{range.groupBy === "day" ? "Date" : range.groupBy === "week" ? "Week" : "Month"}</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Target</Th>
              <Th align="center">Achievement</Th>
              <Th align="right">Gross Profit</Th>
              <Th align="right">GP %</Th>
              <Th align="right">Previous period</Th>
              <Th align="right">Same dates LY</Th>
              <Th align="right">vs LY</Th>
            </Thead>
            <tbody>
              {chartRows.map((row) => (
                <tr key={row.label}>
                  <Td className="font-semibold">{row.label}</Td>
                  <Td align="right">{formatCompact(row.revenue)}</Td>
                  <Td align="right">{row.target === null ? "—" : formatCompact(row.target)}</Td>
                  <Td align="center"><AchievementBadge pct={row.target ? (row.revenue / row.target) * 100 : null} /></Td>
                  <Td align="right">{formatCompact(row.grossProfit)}</Td>
                  <Td align="right">{row.revenue ? formatPercent((row.grossProfit / row.revenue) * 100) : "—"}</Td>
                  <Td align="right">{row.previous === null ? "—" : formatCompact(row.previous)}</Td>
                  <Td align="right">{row.lastYear === null ? "—" : formatCompact(row.lastYear)}</Td>
                  <Td align="right"><GrowthCell value={growthPct(row.revenue, row.lastYear)} /></Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatCompact(totals.revenue)}</Td>
                <Td align="right">{target === null ? "—" : formatCompact(target)}</Td>
                <Td align="center"><AchievementBadge pct={achievementPct} /></Td>
                <Td align="right">{formatCompact(totals.grossProfit)}</Td>
                <Td align="right">{totals.grossMarginPct === null ? "—" : formatPercent(totals.grossMarginPct)}</Td>
                <Td align="right">{formatCompact(previous.revenue)}</Td>
                <Td align="right">{formatCompact(lastYear.revenue)}</Td>
                <Td align="right"><GrowthCell value={vsLastYear} /></Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </SectionCard>
      </div>
    );
  }

  if (section === "reps") {
    return <RepsRange header={header} kpis={kpis} reps={data.reps} total={totals.revenue} />;
  }

  // customers
  const customerGap = data.customerDataFrom !== null && data.from < data.customerDataFrom;
  const customerTotal = data.customers.reduce((sum, row) => sum + row.revenue, 0);
  return (
    <div className="flex flex-col gap-4">
      {header}
      {customerGap ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Daily customer and brand sales start on {dateLabel(data.customerDataFrom!)}; dates before that are not included in the tables below.
        </p>
      ) : null}
      <ChartGrid>
        <SectionCard title="Top customers" action={<span className="text-xs text-muted">Top {data.customers.length} by revenue</span>}>
          <TableWrap>
            <Thead>
              <Th>Customer</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">GP %</Th>
              <Th align="right">Cases</Th>
              <Th align="right">Share</Th>
            </Thead>
            <tbody>
              {data.customers.map((row) => (
                <tr key={`${row.customerName}|${row.sapName}`}>
                  <Td className="max-w-[260px]" title={`${row.customerName} · rep ${row.sapName}`}>
                    <span className="block truncate font-semibold">{row.customerName}</span>
                    <span className="block truncate text-[11px] text-muted">{row.sapName}</span>
                  </Td>
                  <Td align="right">{formatCompact(row.revenue)}</Td>
                  <Td align="right">{row.revenue ? formatPercent((row.grossProfit / row.revenue) * 100) : "—"}</Td>
                  <Td align="right">{formatNumber(row.cases)}</Td>
                  <Td align="right">{customerTotal ? formatPercent((row.revenue / customerTotal) * 100) : "—"}</Td>
                </tr>
              ))}
              {data.customers.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No customer sales in this date range.</td></tr>
              ) : null}
            </tbody>
          </TableWrap>
        </SectionCard>
        <SectionCard title="Top brands" action={<span className="text-xs text-muted">Top {data.brands.length} by revenue</span>}>
          <TableWrap>
            <Thead>
              <Th>Brand</Th>
              <Th>Principal</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">GP %</Th>
              <Th align="right">Cases</Th>
            </Thead>
            <tbody>
              {data.brands.map((row) => (
                <tr key={`${row.principal}|${row.brand}`}>
                  <Td className="font-semibold">{row.brand}</Td>
                  <Td>{row.principal}</Td>
                  <Td align="right">{formatCompact(row.revenue)}</Td>
                  <Td align="right">{row.revenue ? formatPercent((row.grossProfit / row.revenue) * 100) : "—"}</Td>
                  <Td align="right">{formatNumber(row.cases)}</Td>
                </tr>
              ))}
              {data.brands.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No brand sales in this date range.</td></tr>
              ) : null}
            </tbody>
          </TableWrap>
        </SectionCard>
      </ChartGrid>
    </div>
  );
}

function RepsRange({ header, kpis, reps, total }: { header: React.ReactNode; kpis: React.ReactNode; reps: RangeResponse["reps"]; total: number }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = words.length ? reps.filter((rep) => words.every((word) => `${rep.name} ${rep.sapName} ${rep.employeeCode ?? ""} ${rep.principals.join(" ")}`.toLowerCase().includes(word))) : reps;
  return (
    <div className="flex flex-col gap-4">
      {header}
      {kpis}
      <SectionCard
        title={`Reps (${rows.length})`}
        action={
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rep, code or principal"
            aria-label="Search reps"
            className="w-56 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs outline-none focus:border-secondary-blue"
          />
        }
      >
        <TableWrap>
          <Thead>
            <Th>Rep</Th>
            <Th>Principals</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Share</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="right">GP %</Th>
            <Th align="right">Cases</Th>
            <Th align="right">Previous period</Th>
            <Th align="right">vs Previous</Th>
          </Thead>
          <tbody>
            {rows.map((rep) => (
              <tr key={`${rep.employeeCode ?? ""}|${rep.sapName}`}>
                <Td>
                  <span className="block font-semibold">{rep.name}</span>
                  <span className="block text-[11px] text-muted">{rep.employeeCode ? `${rep.employeeCode} · ` : ""}{rep.sapName}</span>
                </Td>
                <Td className="max-w-[220px] truncate" title={rep.principals.join(", ")}>{rep.principals.join(", ")}</Td>
                <Td align="right">{formatCompact(rep.revenue)}</Td>
                <Td align="right">{total ? formatPercent((rep.revenue / total) * 100) : "—"}</Td>
                <Td align="right">{formatCompact(rep.grossProfit)}</Td>
                <Td align="right">{rep.revenue ? formatPercent((rep.grossProfit / rep.revenue) * 100) : "—"}</Td>
                <Td align="right">{formatNumber(rep.cases)}</Td>
                <Td align="right">{formatCompact(rep.previousRevenue)}</Td>
                <Td align="right"><GrowthCell value={growthPct(rep.revenue, rep.previousRevenue)} /></Td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted">No rep sales match.</td></tr>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
