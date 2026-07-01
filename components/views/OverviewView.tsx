"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AchievementBadge, Badge } from "@/components/ui/Badge";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TrendPercent, SignedCompact } from "@/components/ui/TrendValue";
import { InsightsPanel } from "@/components/ui/InsightsPanel";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, achievementTier, tierBarColor } from "@/lib/format";
import { principalsByMtdRevDesc, summarizeTargets } from "@/lib/selectors";
import { generatePortfolioInsights, generatePrincipalInsights } from "@/lib/insights";
import {
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  tooltipContentStyle,
  tooltipLabelStyle,
} from "@/components/charts/theme";

export function OverviewView({ dataset, principal }: ViewProps) {
  const principals = principalsByMtdRevDesc(dataset);
  const summary = summarizeTargets(dataset.principals);
  const insights = principal ? generatePrincipalInsights(principal) : generatePortfolioInsights(dataset);
  const topMtd = principals[0]?.mtdRev || 1;

  const achievementChartData: { name: string; value: number; fill: string }[] = principal
    ? [
        { name: "MTD Rev", value: principal.mtdRev, fill: "var(--accent-blue)" },
        { name: "MTD Target", value: principal.mtdTarget, fill: "var(--accent-grey)" },
        { name: "Full Target", value: principal.fullTarget, fill: "var(--accent-purple)" },
      ]
    : principals.map((p) => ({
        name: p.name.split("-")[0],
        value: p.achMTD ?? 0,
        fill: tierBarColor[achievementTier(p.achMTD)],
      }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <Badge tier="good">{summary.onTarget} on target</Badge>
        <Badge tier="warn">{summary.atRisk} at risk</Badge>
        <Badge tier="bad">{summary.below} below</Badge>
        <Badge tier="neutral">{summary.noTarget} no target</Badge>
        <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-strong">
          <span>
            MTD Rev: <b className="text-foreground">{formatCompact(dataset.totals.mtdRev)}</b>
          </span>
          <span>
            Gross Profit: <b className="text-foreground">{formatCompact(dataset.totals.grossProfit)}</b>
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
        {principal ? (
          <>
            <KpiCard accent="revenue" label="MTD Revenue" value={<AnimatedValue value={principal.mtdRev} format={formatCompact} />} />
            <KpiCard accent="mission" label="MTD Target" value={<AnimatedValue value={principal.mtdTarget} format={formatCompact} />} />
            <KpiCard accent="mission" label="Achievement" value={<AchievementGauge pct={principal.achMTD} />} />
            <KpiCard
              accent="growth"
              label="Balance of Month"
              value={<AnimatedValue value={principal.balMonth} format={formatCompact} />}
              sublabel={<SignedCompact value={principal.balMonth} />}
            />
            <KpiCard accent="growth" label="MOM" value={<TrendPercent value={principal.mom} />} />
            <KpiCard accent="revenue" label="YTD Revenue" value={<AnimatedValue value={principal.ytdRev} format={formatCompact} />} />
          </>
        ) : (
          <>
            <KpiCard accent="revenue" label="MTD Revenue" value={<AnimatedValue value={dataset.totals.mtdRev} format={formatCompact} />} />
            <KpiCard accent="mission" label="MTD Target" value={<AnimatedValue value={dataset.totals.mtdTarget} format={formatCompact} />} />
            <KpiCard
              accent="mission"
              label="MTD Achievement"
              value={<AchievementGauge pct={dataset.totals.achMTD} />}
            />
            <KpiCard
              accent="growth"
              label="Balance of Month"
              value={<AnimatedValue value={dataset.totals.balMonth} format={formatCompact} />}
              sublabel={<SignedCompact value={dataset.totals.balMonth} />}
            />
            <KpiCard accent="revenue" label="Avg Monthly Sales" value={<AnimatedValue value={dataset.totals.avgSales} format={formatCompact} />} />
            <KpiCard accent="revenue" label="YTD Revenue" value={<AnimatedValue value={dataset.totals.ytdRev} format={formatCompact} />} />
          </>
        )}
      </KpiGrid>

      <ChartGrid>
        <SectionCard title="MTD Revenue Ranking">
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
            {principals.map((p) => {
              const tier = achievementTier(p.achMTD);
              const isSelected = principal?.name === p.name;
              return (
                <div key={p.name} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-28 shrink-0 truncate ${isSelected ? "text-accent-blue font-semibold" : "text-muted-strong"}`}
                    title={p.name}
                  >
                    {p.name}
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-background-elevated overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (p.mtdRev / topMtd) * 100)}%`,
                        background: isSelected ? "var(--accent-blue)" : tierBarColor[tier],
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-strong">{formatCompact(p.mtdRev)}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title={principal ? `${principal.name} — MTD vs Target` : "MTD Achievement by Principal (%)"}>
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
            <Th align="right">MTD Rev</Th>
            <Th align="right">MTD Target</Th>
            <Th align="center">Achievement</Th>
            <Th align="right">Balance</Th>
            <Th align="right">MOM</Th>
            <Th align="right">YTD Rev</Th>
          </Thead>
          <tbody>
            {principals.map((p) => (
              <tr key={p.name} className={principal?.name === p.name ? "bg-accent-blue-soft" : ""}>
                <Td>{p.name}</Td>
                <Td align="right">{formatCompact(p.mtdRev)}</Td>
                <Td align="right">{formatCompact(p.mtdTarget)}</Td>
                <Td align="center">
                  <AchievementBadge pct={p.achMTD} />
                </Td>
                <Td align="right">
                  <SignedCompact value={p.balMonth} />
                </Td>
                <Td align="right">
                  <TrendPercent value={p.mom} />
                </Td>
                <Td align="right">{formatCompact(p.ytdRev)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">{formatCompact(dataset.totals.mtdRev)}</Td>
              <Td align="right">{formatCompact(dataset.totals.mtdTarget)}</Td>
              <Td align="center">
                <AchievementBadge pct={dataset.totals.achMTD} />
              </Td>
              <Td align="right">
                <SignedCompact value={dataset.totals.balMonth} />
              </Td>
              <Td align="right">
                <TrendPercent value={dataset.totals.mom} />
              </Td>
              <Td align="right">{formatCompact(dataset.totals.ytdRev)}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
