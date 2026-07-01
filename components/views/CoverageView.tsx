"use client";

import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber, formatPercent, productivityTier, tierBarColor } from "@/lib/format";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

export function CoverageView({ dataset, principal }: ViewProps) {
  const { coverageTrends } = dataset;
  const monthOrder = coverageTrends.totals.map((t) => t.month);
  const sortByMonth = (a: { month: string }, b: { month: string }) => monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month);

  const currentMonthRows = coverageTrends.rows.filter((r) => r.month === coverageTrends.currentMonth);
  const highestCoverage = [...currentMonthRows].sort((a, b) => b.coverage - a.coverage)[0];
  const lowestProductivity = [...currentMonthRows].sort((a, b) => a.productivityPct - b.productivityPct)[0];

  const principalRows = principal
    ? [...coverageTrends.rows.filter((r) => r.principal === principal.name)].sort(sortByMonth)
    : [];
  const principalAvg = principalRows.length
    ? {
        coverage: Math.round(principalRows.reduce((s, r) => s + r.coverage, 0) / principalRows.length),
        productiveCalls: Math.round(principalRows.reduce((s, r) => s + r.productiveCalls, 0) / principalRows.length),
        productivityPct: Math.round((principalRows.reduce((s, r) => s + r.productivityPct, 0) / principalRows.length) * 10) / 10,
      }
    : { coverage: 0, productiveCalls: 0, productivityPct: 0 };
  const principalCurrent = principalRows.find((r) => r.month === coverageTrends.currentMonth) ?? null;

  const lineChartData = principalRows.map((r) => ({ month: r.month, coverage: r.coverage, productive: r.productiveCalls }));
  const barChartData = currentMonthRows.map((r) => ({ name: r.principal.split("-")[0], coverage: r.coverage, productive: r.productiveCalls }));

  const productivityChartData = principal
    ? principalRows.map((r) => ({ name: r.month, value: r.productivityPct, fill: tierBarColor[productivityTier(r.productivityPct)] }))
    : currentMonthRows.map((r) => ({ name: r.principal.split("-")[0], value: r.productivityPct, fill: tierBarColor[productivityTier(r.productivityPct)] }));

  const tableRows = principal ? principalRows : coverageTrends.totals;

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        {principal ? (
          <>
            <KpiCard accent="coverage" label={`${coverageTrends.currentMonth} Coverage`} value={<AnimatedValue value={principalCurrent?.coverage ?? 0} format={formatNumber} />} />
            <KpiCard accent="coverage" label={`${coverageTrends.currentMonth} Productive`} value={<AnimatedValue value={principalCurrent?.productiveCalls ?? 0} format={formatNumber} />} />
            <KpiCard
              accent="coverage"
              label={`${coverageTrends.currentMonth} Productivity`}
              value={<AnimatedValue value={principalCurrent?.productivityPct ?? 0} format={formatPercent} />}
            />
            <KpiCard accent="coverage" label="Average Coverage" value={<AnimatedValue value={principalAvg.coverage} format={formatNumber} />} />
            <KpiCard accent="coverage" label="Average Productive" value={<AnimatedValue value={principalAvg.productiveCalls} format={formatNumber} />} />
            <KpiCard accent="coverage" label="Average Productivity" value={<AnimatedValue value={principalAvg.productivityPct} format={formatPercent} />} />
          </>
        ) : (
          <>
            <KpiCard accent="coverage" label="Average Outlets Covered" value={<AnimatedValue value={dataset.covTotal.ytdCoverage} format={formatNumber} />} />
            <KpiCard accent="coverage" label="Average Productive Outlets" value={<AnimatedValue value={dataset.covTotal.productiveCalls} format={formatNumber} />} />
            <KpiCard
              accent="coverage"
              label="Average Productivity"
              value={<AnimatedValue value={dataset.covTotal.productivityPct} format={formatPercent} />}
            />
            <KpiCard accent="coverage" label={`${coverageTrends.currentMonth} Coverage`} value={<AnimatedValue value={dataset.covTotal.currentCoverage} format={formatNumber} />} />
            <KpiCard
              accent="coverage"
              size="md"
              label="Highest Coverage"
              value={highestCoverage?.principal.split("-")[0] ?? "—"}
              sublabel={highestCoverage ? formatNumber(highestCoverage.coverage) : undefined}
            />
            <KpiCard
              accent="growth"
              size="md"
              label="Lowest Productivity"
              value={lowestProductivity?.principal.split("-")[0] ?? "—"}
              sublabel={lowestProductivity ? `${lowestProductivity.productivityPct.toFixed(1)}%` : undefined}
            />
          </>
        )}
      </KpiGrid>

      <ChartGrid>
        <SectionCard title={principal ? `${principal.name} — Coverage vs Productive Outlets` : "Coverage vs Productive Outlets (Current Month)"}>
          <ResponsiveContainer width="100%" height={320}>
            {principal ? (
              <LineChart data={lineChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="month" stroke={CHART_AXIS_COLOR} fontSize={11} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="coverage" name="Coverage" stroke="var(--accent-blue)" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="productive" name="Productive" stroke="var(--accent-green)" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            ) : (
              <BarChart data={barChartData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="coverage" name="Coverage" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="productive" name="Productive" fill="var(--accent-green)" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Productivity %">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={productivityChartData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {productivityChartData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title={principal ? `${principal.name} — Monthly Coverage` : "Portfolio Monthly Coverage (Total Rows)"}>
        <TableWrap>
          <Thead>
            <Th>Month</Th>
            <Th align="right">Outlets Covered</Th>
            <Th align="right">Productive Outlets</Th>
            <Th align="center">Productivity %</Th>
          </Thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.month}>
                <Td>{r.month}</Td>
                <Td align="right">{formatNumber(r.coverage)}</Td>
                <Td align="right">{formatNumber(r.productiveCalls)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.productivityPct)}>{r.productivityPct.toFixed(1)}%</Badge>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Average</Td>
              <Td align="right">{formatNumber(principal ? principalAvg.coverage : coverageTrends.average.coverage)}</Td>
              <Td align="right">{formatNumber(principal ? principalAvg.productiveCalls : coverageTrends.average.productiveCalls)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(principal ? principalAvg.productivityPct : coverageTrends.average.productivityPct)}>
                  {(principal ? principalAvg.productivityPct : coverageTrends.average.productivityPct).toFixed(1)}%
                </Badge>
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
