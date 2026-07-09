"use client";

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { AchievementBadge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact } from "@/lib/format";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { CANONICAL_MONTHS, getAvailableMonths, summarizeSalesForPeriod } from "@/lib/timeIntelligence";
import { weeklyRowsFor, aggregateWeekly } from "@/lib/trends";
import { CHART_COLORS, CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

function month3(month: string): string {
  return month.slice(0, 3);
}

export default function SalesPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;

  const currentSummary = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);
  const weeklyRows = weeklyRowsFor(dataset, selectedPrincipalKey);
  const weekly = aggregateWeekly(weeklyRows);
  const principals = principalsByRevenueDesc(dataset, period);

  const monthsThisYear = getAvailableMonths(dataset, period.year);
  const monthlyRows = CANONICAL_MONTHS.filter((m) => monthsThisYear.includes(m)).map((month) => ({
    month,
    ...summarizeSalesForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey),
  }));

  const trendChartData = monthlyRows.map((r) => ({ name: month3(r.month), Revenue: r.revenue, Target: r.target ?? undefined }));
  const byPrincipalChartData = principals.slice(0, 12).map((p, i) => ({ name: p.principal, value: p.revenue, fill: CHART_COLORS[i % CHART_COLORS.length] }));

  return (
    <>
      <KpiGrid>
        <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={<AnimatedValue value={currentSummary.revenue} format={formatCompact} />} />
        <KpiCard
          accent="mission"
          label={`${period.kind} Target`}
          value={currentSummary.target !== null ? <AnimatedValue value={currentSummary.target} format={formatCompact} /> : "N/A"}
        />
        <KpiCard
          accent="mission"
          label="Achievement"
          value={
            <div className="flex w-full justify-center">
              <AchievementGauge pct={currentSummary.achievementPct} size={72} />
            </div>
          }
        />
        <KpiCard accent="revenue" label="Gross Profit" value={<AnimatedValue value={currentSummary.grossProfit} format={formatCompact} />} />
        <KpiCard accent="growth" label="Weekly Revenue" value={<AnimatedValue value={weekly.weeklyRevenue} format={formatCompact} />} />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title="Sales Trend">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Revenue" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="Target" stroke={CHART_COLORS[7]} strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Revenue by Principal">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byPrincipalChartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
              <XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
              <YAxis type="category" dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} width={100} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} fill={CHART_COLORS[0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Revenue by Month">
        <TableWrap>
          <Thead>
            <Th>Month</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Target</Th>
            <Th align="center">Achievement</Th>
            <Th align="right">Gross Profit</Th>
          </Thead>
          <tbody>
            {monthlyRows.map((r) => (
              <tr key={r.month}>
                <Td>{r.month}</Td>
                <Td align="right">{formatCompact(r.revenue)}</Td>
                <Td align="right">{r.target !== null ? formatCompact(r.target) : "N/A"}</Td>
                <Td align="center">
                  <AchievementBadge pct={r.achievementPct} />
                </Td>
                <Td align="right">{formatCompact(r.grossProfit)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">{formatCompact(currentSummary.revenue)}</Td>
              <Td align="right">{currentSummary.target !== null ? formatCompact(currentSummary.target) : "N/A"}</Td>
              <Td align="center">
                <AchievementBadge pct={currentSummary.achievementPct} />
              </Td>
              <Td align="right">{formatCompact(currentSummary.grossProfit)}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Sales Performance by Principal">
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Target</Th>
            <Th align="center">Achievement</Th>
            <Th align="right">Gross Profit</Th>
          </Thead>
          <tbody>
            {principals.map((p) => (
              <tr key={p.principalKey} className={selectedPrincipalKey === p.principalKey ? "bg-accent-blue-soft" : ""}>
                <Td>{p.principal}</Td>
                <Td align="right">{formatCompact(p.revenue)}</Td>
                <Td align="right">{p.target !== null ? formatCompact(p.target) : "N/A"}</Td>
                <Td align="center">
                  <AchievementBadge pct={p.achievementPct} />
                </Td>
                <Td align="right">{formatCompact(p.grossProfit)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">{formatCompact(currentSummary.revenue)}</Td>
              <Td align="right">{currentSummary.target !== null ? formatCompact(currentSummary.target) : "N/A"}</Td>
              <Td align="center">
                <AchievementBadge pct={currentSummary.achievementPct} />
              </Td>
              <Td align="right">{formatCompact(currentSummary.grossProfit)}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </>
  );
}
