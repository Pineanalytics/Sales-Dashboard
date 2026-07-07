"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AchievementBadge, Badge } from "@/components/ui/Badge";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { InsightsPanel } from "@/components/ui/InsightsPanel";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, achievementTier, tierBarColor } from "@/lib/format";
import { principalsByRevenueDesc, summarizeTargets } from "@/lib/selectors";
import { generatePortfolioInsights, generatePrincipalInsights } from "@/lib/insights";
import { summarizeSalesForPeriod, resolvePeriodMonths, type PeriodSelection } from "@/lib/timeIntelligence";
import { weeklyRowsFor, aggregateWeekly } from "@/lib/trends";
import {
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  tooltipContentStyle,
  tooltipLabelStyle,
} from "@/components/charts/theme";

export function OverviewView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const principals = principalsByRevenueDesc(dataset, period);
  const summary = summarizeTargets(principals);
  const insights = selectedPrincipalKey
    ? generatePrincipalInsights(dataset, period, selectedPrincipalKey)
    : generatePortfolioInsights(dataset, period);

  const selected = principals.find((p) => p.principalKey === selectedPrincipalKey) ?? null;
  const currentSummary = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);

  const ytdPeriod: PeriodSelection = { kind: "YTD", year: period.year, month: period.month };
  const ytdSummary = summarizeSalesForPeriod(dataset, ytdPeriod, selectedPrincipalKey);

  const weeklyRows = weeklyRowsFor(dataset, selectedPrincipalKey);
  const weekly = aggregateWeekly(weeklyRows);

  const topRevenue = principals[0]?.revenue || 1;

  const achievementChartData: { name: string; value: number; fill: string }[] = selected
    ? [
        { name: "Revenue", value: currentSummary.revenue, fill: "var(--accent-blue)" },
        { name: "Target", value: currentSummary.target ?? 0, fill: "var(--accent-grey)" },
      ]
    : principals.map((p) => ({
        name: p.principal.split("-")[0],
        value: p.achievementPct ?? 0,
        fill: tierBarColor[achievementTier(p.achievementPct)],
      }));

  const periodMonths = resolvePeriodMonths(period);
  const periodLabel = periodMonths.length > 1 ? `${period.kind} ${period.year}` : `${period.month ?? ""} ${period.year}`.trim();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <Badge tier="good">{summary.onTarget} on target</Badge>
        <Badge tier="warn">{summary.atRisk} at risk</Badge>
        <Badge tier="bad">{summary.below} below</Badge>
        <Badge tier="neutral">{summary.noTarget} no target</Badge>
        <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-strong">
          <span>
            {periodLabel} Revenue: <b className="text-foreground">{formatCompact(currentSummary.revenue)}</b>
          </span>
          <span>
            Gross Profit: <b className="text-foreground">{formatCompact(currentSummary.grossProfit)}</b>
          </span>
          <span>
            Stock Value: <b className="text-foreground">{formatCompact(dataset.stockTotal.value)}</b>
          </span>
          <span>
            Stock Items: <b className="text-foreground">{formatNumber(dataset.stockTotal.itemCount)}</b>
          </span>
        </div>
      </div>

      <KpiGrid>
        <KpiCard accent="revenue" label={`${periodLabel} Revenue`} value={<AnimatedValue value={currentSummary.revenue} format={formatCompact} />} />
        <KpiCard
          accent="mission"
          label={`${periodLabel} Target`}
          value={currentSummary.target !== null ? <AnimatedValue value={currentSummary.target} format={formatCompact} /> : "N/A"}
        />
        <KpiCard accent="mission" label="Achievement" value={<AchievementGauge pct={currentSummary.achievementPct} />} />
        <KpiCard accent="revenue" label="Gross Profit" value={<AnimatedValue value={currentSummary.grossProfit} format={formatCompact} />} />
        <KpiCard accent="revenue" label="YTD Revenue" value={<AnimatedValue value={ytdSummary.revenue} format={formatCompact} />} />
        <KpiCard accent="growth" label="Weekly Revenue" value={<AnimatedValue value={weekly.weeklyRevenue} format={formatCompact} />} />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title={`${periodLabel} Revenue Ranking`}>
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
            {principals.map((p) => {
              const tier = achievementTier(p.achievementPct);
              const isSelected = selectedPrincipalKey === p.principalKey;
              return (
                <div key={p.principalKey} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-28 shrink-0 truncate ${isSelected ? "text-accent-blue font-semibold" : "text-muted-strong"}`}
                    title={p.principal}
                  >
                    {p.principal}
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-background-elevated overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (p.revenue / topRevenue) * 100)}%`,
                        background: isSelected ? "var(--accent-blue)" : tierBarColor[tier],
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-strong">{formatCompact(p.revenue)}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title={selected ? `${selected.principal} — Revenue vs Target` : "Achievement by Principal (%)"}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={achievementChartData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis
                dataKey="name"
                stroke={CHART_AXIS_COLOR}
                fontSize={11}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={60}
              />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: "rgba(10,42,138,0.06)" }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {achievementChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Insights">
        <InsightsPanel insights={insights} />
      </SectionCard>

      <SectionCard title="Performance">
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
    </div>
  );
}
