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
import { useDashboardStore } from "@/lib/store";
import { formatCompact, formatNumber, achievementTier, tierBarColor } from "@/lib/format";
import { principalsByRevenueDesc, summarizeTargets } from "@/lib/selectors";
import { generatePortfolioInsights, generatePrincipalInsights } from "@/lib/insights";
import { summarizeSalesForPeriod, resolvePeriodMonths, getPreviousMonthPeriod, type PeriodSelection } from "@/lib/timeIntelligence";
import { weeklyRowsFor, aggregateWeekly } from "@/lib/trends";
import {
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  tooltipContentStyle,
  tooltipLabelStyle,
} from "@/components/charts/theme";

export function OverviewView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);

  // Land on a broad "how are we doing" picture (YTD) rather than a narrow default MTD
  // sliver — the single-period selector only drives everything below once the user
  // has actually touched it.
  const effectivePeriod: PeriodSelection = hasUserSelectedPeriod
    ? period
    : { kind: "YTD", year: period.year, month: period.month };

  const principals = principalsByRevenueDesc(dataset, effectivePeriod);
  const summary = summarizeTargets(principals);
  const insights = selectedPrincipalKey
    ? generatePrincipalInsights(dataset, effectivePeriod, selectedPrincipalKey)
    : generatePortfolioInsights(dataset, effectivePeriod);

  const selected = principals.find((p) => p.principalKey === selectedPrincipalKey) ?? null;
  const currentSummary = summarizeSalesForPeriod(dataset, effectivePeriod, selectedPrincipalKey);

  const h1Summary = summarizeSalesForPeriod(dataset, { kind: "H1", year: period.year }, selectedPrincipalKey);
  const h2Summary = summarizeSalesForPeriod(dataset, { kind: "H2", year: period.year }, selectedPrincipalKey);
  const ytdSummary = summarizeSalesForPeriod(dataset, { kind: "YTD", year: period.year, month: period.month }, selectedPrincipalKey);

  const weeklyRows = weeklyRowsFor(dataset, selectedPrincipalKey);
  const weekly = aggregateWeekly(weeklyRows);

  // Genuine month-over-month comparison for the Revenue KPI's delta pill — deliberately
  // anchored to a single calendar month regardless of what effectivePeriod itself spans
  // (YTD/H1/etc.), so "vs last month" always means exactly that, not a mismatched
  // multi-month-vs-one-month comparison.
  const currentMonthPeriod: PeriodSelection = { kind: "MONTH", year: effectivePeriod.year, month: effectivePeriod.month };
  const currentMonthSummary = summarizeSalesForPeriod(dataset, currentMonthPeriod, selectedPrincipalKey);
  const previousMonthPeriod = getPreviousMonthPeriod(currentMonthPeriod);
  const previousMonthSummary = previousMonthPeriod ? summarizeSalesForPeriod(dataset, previousMonthPeriod, selectedPrincipalKey) : null;
  const revenueDeltaPct =
    previousMonthSummary && previousMonthSummary.revenue > 0
      ? ((currentMonthSummary.revenue - previousMonthSummary.revenue) / previousMonthSummary.revenue) * 100
      : null;

  // Trailing revenue-by-month series (real data, not synthetic) for the Revenue KPI's sparkline.
  const revenueTrend = (() => {
    const rows = selectedPrincipalKey ? dataset.monthlySales.filter((r) => r.principalKey === selectedPrincipalKey) : dataset.monthlySales;
    const byMonth = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.year}-${String(r.monthIndex).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + r.revenue);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-8)
      .map(([, revenue]) => revenue);
  })();

  const topRevenue = principals[0]?.revenue || 1;

  const achievementChartData: { name: string; value: number; fill: string }[] = selected
    ? [
        { name: "Revenue", value: currentSummary.revenue, fill: "var(--primary-blue)" },
        { name: "Target", value: currentSummary.target ?? 0, fill: "var(--accent-grey)" },
      ]
    : principals.map((p) => ({
        name: p.principal,
        value: p.achievementPct ?? 0,
        fill: tierBarColor[achievementTier(p.achievementPct)],
      }));

  const periodMonths = resolvePeriodMonths(effectivePeriod);
  const periodLabel = hasUserSelectedPeriod
    ? periodMonths.length > 1
      ? `${effectivePeriod.kind} ${effectivePeriod.year}`
      : `${effectivePeriod.month ?? ""} ${effectivePeriod.year}`.trim()
    : `YTD ${effectivePeriod.year}`;

  return (
    <div className="flex flex-col gap-6">
      {!hasUserSelectedPeriod ? (
        <SectionCard title="General Performance">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(
              [
                { label: "YTD", s: currentSummary },
                { label: "H1", s: h1Summary },
                { label: "H2", s: h2Summary },
              ] as const
            ).map(({ label, s }) => (
              <div key={label} className="rounded-xl border border-border p-4 flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {label} {period.year}
                </span>
                <span className="text-2xl font-semibold tabular-nums text-foreground">{formatCompact(s.revenue)}</span>
                <div className="flex items-center justify-between text-xs text-muted-strong">
                  <span>Target: {s.target !== null ? formatCompact(s.target) : "N/A"}</span>
                  <AchievementBadge pct={s.achievementPct} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

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
        <KpiCard
          accent="revenue"
          label={`${periodLabel} Revenue`}
          value={<AnimatedValue value={currentSummary.revenue} format={formatCompact} />}
          delta={revenueDeltaPct !== null ? { value: revenueDeltaPct, caption: "vs last month" } : undefined}
          sparkline={revenueTrend.length >= 2 ? revenueTrend : undefined}
        />
        <KpiCard
          accent="mission"
          label={`${periodLabel} Target`}
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
        {hasUserSelectedPeriod ? (
          <KpiCard
            accent="revenue"
            label={`YTD ${period.year} Revenue`}
            value={<AnimatedValue value={ytdSummary.revenue} format={formatCompact} />}
          />
        ) : null}
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
                    className={`w-28 shrink-0 truncate ${isSelected ? "text-primary-blue font-semibold" : "text-muted-strong"}`}
                    title={p.principal}
                  >
                    {p.principal}
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-background-elevated overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (p.revenue / topRevenue) * 100)}%`,
                        background: isSelected ? "var(--primary-blue)" : tierBarColor[tier],
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
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: "rgba(21,61,154,0.08)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
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
