"use client";

import { ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatPercent, formatTrendPercent, trendTier } from "@/lib/format";
import { tierTextClass } from "@/lib/format";
import {
  CANONICAL_MONTHS,
  getAvailableYears,
  getAvailableMonths,
  summarizeSalesForPeriod,
} from "@/lib/timeIntelligence";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

export function TimeIntelligenceView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const years = getAvailableYears(dataset);
  const yearIdx = years.indexOf(period.year);
  const priorYear = yearIdx > 0 ? years[yearIdx - 1] : null;

  const currentSummary = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);

  const priorPeriodSummary = priorYear
    ? summarizeSalesForPeriod(dataset, { ...period, year: priorYear }, selectedPrincipalKey)
    : null;

  const yoyVariance =
    priorPeriodSummary && priorPeriodSummary.revenue > 0
      ? ((currentSummary.revenue - priorPeriodSummary.revenue) / priorPeriodSummary.revenue) * 100
      : null;

  const monthsThisYear = getAvailableMonths(dataset, period.year);
  const monthlyRows = CANONICAL_MONTHS.filter((m) => monthsThisYear.includes(m)).map((month) => {
    const cur = summarizeSalesForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey);
    const prior = priorYear
      ? summarizeSalesForPeriod(dataset, { kind: "MONTH", year: priorYear, month }, selectedPrincipalKey)
      : null;
    return {
      month,
      revenue: cur.revenue,
      target: cur.target,
      achievementPct: cur.achievementPct,
      grossMarginPct: cur.grossMarginPct,
      priorRevenue: prior?.revenue ?? null,
    };
  });

  const chartData = monthlyRows.map((r) => ({
    name: month3(r.month),
    Revenue: r.revenue,
    Target: r.target ?? undefined,
    [priorYear ? `Revenue ${priorYear}` : "Prior Revenue"]: r.priorRevenue ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={<AnimatedValue value={currentSummary.revenue} format={formatCompact} />} />
        <KpiCard
          accent="mission"
          label={`${period.kind} Target`}
          value={currentSummary.target !== null ? <AnimatedValue value={currentSummary.target} format={formatCompact} /> : "N/A"}
        />
        <KpiCard accent="mission" label="Achievement" value={<AchievementGauge pct={currentSummary.achievementPct} />} size="md" />
        <KpiCard accent="quarter" label="Gross Margin" value={formatPercent(currentSummary.grossMarginPct)} size="md" />
        <KpiCard
          accent="growth"
          label={priorYear ? `YOY vs ${priorYear}` : "YOY"}
          value={
            <span className={tierTextClass[trendTier(yoyVariance)]}>{yoyVariance !== null ? formatTrendPercent(yoyVariance) : "—"}</span>
          }
          size="md"
        />
      </KpiGrid>

      <SectionCard title={`Monthly Revenue Trend — ${period.year}${priorYear ? ` vs ${priorYear}` : ""}`}>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {priorYear ? (
              <Area type="monotone" dataKey={`Revenue ${priorYear}`} fill="var(--accent-grey)" stroke="var(--accent-grey)" fillOpacity={0.15} />
            ) : null}
            <Bar dataKey="Revenue" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="Target" stroke="var(--accent-amber)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title={`${period.year} Monthly Scorecard`}>
        <TableWrap>
          <Thead>
            <Th>Month</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Target</Th>
            <Th align="center">Achievement</Th>
            <Th align="right">Gross Margin</Th>
            <Th align="right">YOY</Th>
          </Thead>
          <tbody>
            {monthlyRows.map((r) => {
              const rowYoy = r.priorRevenue && r.priorRevenue > 0 ? ((r.revenue - r.priorRevenue) / r.priorRevenue) * 100 : null;
              return (
                <tr key={r.month}>
                  <Td>{r.month}</Td>
                  <Td align="right">{formatCompact(r.revenue)}</Td>
                  <Td align="right">{r.target !== null ? formatCompact(r.target) : "N/A"}</Td>
                  <Td align="center">{formatPercent(r.achievementPct)}</Td>
                  <Td align="right">{formatPercent(r.grossMarginPct)}</Td>
                  <Td align="right" className={tierTextClass[trendTier(rowYoy)]}>
                    {rowYoy !== null ? formatTrendPercent(rowYoy) : "—"}
                  </Td>
                </tr>
              );
            })}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">{formatCompact(monthlyRows.reduce((s, r) => s + r.revenue, 0))}</Td>
              <Td align="right">
                {monthlyRows.every((r) => r.target !== null)
                  ? formatCompact(monthlyRows.reduce((s, r) => s + (r.target ?? 0), 0))
                  : "N/A"}
              </Td>
              <Td align="center">—</Td>
              <Td align="right">—</Td>
              <Td align="right">—</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}

function month3(month: string): string {
  return month.slice(0, 3);
}
