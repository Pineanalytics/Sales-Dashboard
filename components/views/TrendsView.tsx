"use client";

import { ComposedChart, Area, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TrendPercent, SignedCompact } from "@/components/ui/TrendValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatTrendPercent } from "@/lib/format";
import { getYears, seriesForPrincipal, latestDataPoint, computeYoyAt, weeklyRowsFor, aggregateWeekly } from "@/lib/trends";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

export function TrendsView({ dataset, principal }: ViewProps) {
  const years = getYears(dataset);
  const series = seriesForPrincipal(dataset, principal);
  const latest = latestDataPoint(dataset, principal);
  const olderYear = years[years.length - 2];
  const newerYear = years[years.length - 1];

  const lineData = dataset.trendedRevenue.months.map((m, i) => ({
    month: m.slice(0, 3),
    ...(olderYear ? { [olderYear]: series[olderYear]?.[i] ?? null } : {}),
    ...(newerYear ? { [newerYear]: series[newerYear]?.[i] ?? null } : {}),
  }));

  const weeklyRows = weeklyRowsFor(dataset, principal);
  const weekly = aggregateWeekly(weeklyRows);

  const weeklyBarData = principal
    ? [{ name: principal.name.split("-")[0], revenue: weekly.weeklyRevenue, projection: weekly.weeklyProjection }]
    : weeklyRows.map((r) => ({ name: r.principal.split("-")[0], revenue: r.weeklyRevenue, projection: r.weeklyProjection }));

  const nextMonthForecast = principal ? principal.nextMonthForecast : dataset.totals.nextMonthForecast;
  const nextQuarterForecast = principal ? principal.nextQuarterForecast : dataset.totals.nextQuarterForecast;

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="quarter" label="Next Month Forecast" value={<AnimatedValue value={nextMonthForecast} format={formatCompact} />} />
        <KpiCard accent="quarter" label="Next Quarter Forecast" value={<AnimatedValue value={nextQuarterForecast} format={formatCompact} />} />
        <KpiCard
          accent="revenue"
          label={latest ? `${latest.month} ${latest.year} Revenue` : "Latest Month Revenue"}
          value={latest ? <AnimatedValue value={latest.value} format={formatCompact} /> : "—"}
          sublabel={latest ? <TrendPercent value={latest.yoy} /> : undefined}
        />
        <KpiCard accent="revenue" label="Weekly Revenue" value={<AnimatedValue value={weekly.weeklyRevenue} format={formatCompact} />} />
        <KpiCard accent="mission" label="Weekly Projection" value={<AnimatedValue value={weekly.weeklyProjection} format={formatCompact} />} />
        <KpiCard
          accent="growth"
          label="Achieved vs Weekly Projection"
          value={formatTrendPercent(weekly.achievedProjectionPct)}
          sublabel={<SignedCompact value={weekly.weekVariance} />}
        />
      </KpiGrid>

      <SectionCard title={principal ? `${principal.name} — Monthly Revenue Trend` : "Portfolio Monthly Revenue Trend"}>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={lineData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {olderYear ? (
              <Line
                type="monotone"
                dataKey={olderYear}
                name={olderYear}
                stroke="var(--muted)"
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            ) : null}
            {newerYear ? (
              <Area
                type="monotone"
                dataKey={newerYear}
                name={newerYear}
                stroke="var(--accent-blue)"
                strokeWidth={2.5}
                fill="url(#revFill)"
                connectNulls={false}
                dot={{ r: 3, fill: "var(--accent-blue)" }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title={principal ? `${principal.name} — Weekly Revenue vs Projection` : "Weekly Revenue vs Projection by Principal"}>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={weeklyBarData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="revenue" name="Weekly Revenue" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="projection" name="Weekly Projection" fill="var(--accent-grey)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <ChartGrid>
        <SectionCard title="Monthly Trend">
          <TableWrap>
            <Thead>
              <Th>Month</Th>
              {olderYear ? <Th align="right">{olderYear} Revenue</Th> : null}
              {newerYear ? <Th align="right">{newerYear} Revenue</Th> : null}
              <Th align="right">YOY%</Th>
            </Thead>
            <tbody>
              {dataset.trendedRevenue.months.map((m, i) => {
                const newerVal = newerYear ? series[newerYear]?.[i] ?? null : null;
                const yoy = newerYear && newerVal !== null ? computeYoyAt(series, years, newerYear, i) : null;
                return (
                  <tr key={m}>
                    <Td>{m}</Td>
                    {olderYear ? <Td align="right">{formatCompact(series[olderYear]?.[i] ?? null)}</Td> : null}
                    {newerYear ? <Td align="right">{newerVal !== null ? formatCompact(newerVal) : "—"}</Td> : null}
                    <Td align="right">{newerVal !== null ? <TrendPercent value={yoy} /> : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </SectionCard>

        <SectionCard title="Weekly Projection Scorecard">
          <TableWrap>
            <Thead>
              <Th>Principal</Th>
              <Th align="right">Weekly Rev</Th>
              <Th align="right">Weekly Proj</Th>
              <Th align="right">Weekly RR</Th>
              <Th align="right">Variance</Th>
              <Th align="center">Achieved</Th>
            </Thead>
            <tbody>
              {weeklyRows.map((r) => (
                <tr key={r.principal}>
                  <Td>{r.principal}</Td>
                  <Td align="right">{formatCompact(r.weeklyRevenue)}</Td>
                  <Td align="right">{formatCompact(r.weeklyProjection)}</Td>
                  <Td align="right">{formatCompact(r.weeklyRR)}</Td>
                  <Td align="right">
                    <SignedCompact value={r.weekVariance} />
                  </Td>
                  <Td align="center">
                    <Badge tier={r.achievedProjectionPct >= 100 ? "good" : r.achievedProjectionPct >= 60 ? "warn" : "bad"}>
                      {r.achievedProjectionPct.toFixed(1)}%
                    </Badge>
                  </Td>
                </tr>
              ))}
              {!principal ? (
                <TotalRow>
                  <Td>Total</Td>
                  <Td align="right">{formatCompact(weekly.weeklyRevenue)}</Td>
                  <Td align="right">{formatCompact(weekly.weeklyProjection)}</Td>
                  <Td align="right">{formatCompact(weekly.weeklyRR)}</Td>
                  <Td align="right">
                    <SignedCompact value={weekly.weekVariance} />
                  </Td>
                  <Td align="center">
                    <Badge tier={weekly.achievedProjectionPct >= 100 ? "good" : weekly.achievedProjectionPct >= 60 ? "warn" : "bad"}>
                      {weekly.achievedProjectionPct.toFixed(1)}%
                    </Badge>
                  </Td>
                </TotalRow>
              ) : null}
            </tbody>
          </TableWrap>
        </SectionCard>
      </ChartGrid>
    </div>
  );
}
