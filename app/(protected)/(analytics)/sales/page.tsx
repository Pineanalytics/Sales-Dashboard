"use client";

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { AchievementBadge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { formatCompact } from "@/lib/format";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { CANONICAL_MONTHS, resolvePeriodMonths, summarizeSalesForPeriod } from "@/lib/timeIntelligence";
import { WeeklyRevenueKpi } from "@/components/dashboard/WeeklyRevenueKpi";
import { CHART_COLORS, CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { grossProfitTargetForPeriod, grossProfitTargetPerformance } from "@/lib/grossProfitTarget";
import { SalesSectionNav, useAvailableSalesSections, type SalesSection } from "@/components/dashboard/SalesSectionNav";
import DashboardPage from "../dashboard/page";
import TimeIntelligencePage from "../time-intelligence/page";
import RepsPage from "../reps/page";
import CustomersPage from "../customers/page";

function month3(month: string): string {
  return month.slice(0, 3);
}

export default function SalesPage() {
  const active = useDashboardStore((state) => state.salesSection);
  const setActive = useDashboardStore((state) => state.setSalesSection);
  const availableSections = useAvailableSalesSections();
  const current: SalesSection = availableSections.some((section) => section.id === active) ? active : availableSections[0]?.id ?? "cockpit";
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <SalesSectionNav active={current} onSelect={setActive} />
      {current === "cockpit" ? <SalesCockpit /> : null}
      {current === "executive" ? <DashboardPage embedded /> : null}
      {current === "time" ? <TimeIntelligencePage /> : null}
      {current === "reps" ? <RepsPage /> : null}
      {current === "customers" ? <CustomersPage /> : null}
    </div>
  );
}

function SalesCockpit() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  if (!dataset) return null;

  const currentSummary = summarizeSalesForPeriod(dataset, period, selectedPrincipalKey);
  const principals = principalsByRevenueDesc(dataset, period);

  // Keep the trend contextual without displaying future, zero-actual months. A
  // single-month selection still shows the year-to-date run-up to that month.
  const trendPeriod = period.kind === "MTD" || period.kind === "MONTH"
    ? { kind: "YTD" as const, year: period.year, month: period.month }
    : period;
  const trendMonths = resolvePeriodMonths(trendPeriod);
  const includesMultipleYears = new Set(trendMonths.map((month) => month.year)).size > 1;
  const monthlyRows = trendMonths.map(({ year, monthIndex }) => {
    const month = CANONICAL_MONTHS[monthIndex];
    const monthPeriod = { kind: "MONTH" as const, year, month };
    const summary = summarizeSalesForPeriod(dataset, monthPeriod, selectedPrincipalKey);
    const grossProfitTarget = grossProfitTargetForPeriod(dataset, monthPeriod, selectedPrincipalKey);
    return {
      key: `${year}-${monthIndex}`,
      month,
      label: includesMultipleYears ? `${month3(month)} ${year}` : month,
      ...summary,
      grossProfitTarget,
      ...grossProfitTargetPerformance(summary.grossProfit, grossProfitTarget),
    };
  });
  const displayedSummary = summarizeSalesForPeriod(dataset, trendPeriod, selectedPrincipalKey);
  const displayedGrossProfitTarget = grossProfitTargetForPeriod(dataset, trendPeriod, selectedPrincipalKey);
  const displayedGrossProfitPerformance = grossProfitTargetPerformance(displayedSummary.grossProfit, displayedGrossProfitTarget);

  const trendChartData = monthlyRows.map((r) => ({ name: includesMultipleYears ? r.label : month3(r.month), Revenue: r.revenue, Target: r.target ?? undefined }));
  const byPrincipalChartData = principals.slice(0, 12).map((p) => ({ name: p.principal, value: p.revenue }));
  const targetBalance = currentSummary.target !== null ? currentSummary.target - currentSummary.revenue : null;

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(155px,1fr))] gap-3">
        <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={<AnimatedValue value={currentSummary.revenue} format={formatCompact} />} sublabel={`${currentSummary.monthsIncluded} month${currentSummary.monthsIncluded === 1 ? "" : "s"} included`} />
        <KpiCard
          accent="mission"
          label={`${period.kind} Target`}
          value={currentSummary.target !== null ? <AnimatedValue value={currentSummary.target} format={formatCompact} /> : "N/A"}
          sublabel={targetBalance !== null ? `${targetBalance >= 0 ? "Balance" : "Ahead by"} ${formatCompact(Math.abs(targetBalance))}` : "No target loaded"}
        />
        <KpiCard
          accent="mission"
          label="Achievement"
          value={
            <div className="flex w-full justify-center">
              <AchievementGauge pct={currentSummary.achievementPct} size={64} />
            </div>
          }
        />
        <KpiCard accent="revenue" label="Gross Profit" value={<AnimatedValue value={currentSummary.grossProfit} format={formatCompact} />} sublabel={currentSummary.grossMarginPct !== null ? `${currentSummary.grossMarginPct.toFixed(1)}% margin` : "Margin unavailable"} />
        <WeeklyRevenueKpi dataset={dataset} principalKey={selectedPrincipalKey} />
        <GrowthComparison dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} compact />
      </div>

      <ChartGrid>
        <SectionCard title="Sales Trend">
          <ResponsiveContainer width="100%" height={260}>
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
          <ResponsiveContainer width="100%" height={260}>
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
            <Th align="right">Variance</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="right">GP Target</Th>
            <Th align="center">GP Attainment</Th>
            <Th align="right">Attainment Variance</Th>
            <Th align="right">GP Margin</Th>
          </Thead>
          <tbody>
            {monthlyRows.map((r) => (
              <tr key={r.key}>
                <Td>{r.label}</Td>
                <Td align="right">{formatCompact(r.revenue)}</Td>
                <Td align="right">{r.target !== null ? formatCompact(r.target) : "N/A"}</Td>
                <Td align="center">
                  <AchievementBadge pct={r.achievementPct} />
                </Td>
                <Td align="right" className={r.target !== null && r.revenue - r.target < 0 ? "text-red-600" : "text-emerald-700"}>{r.target !== null ? formatCompact(r.revenue - r.target) : "N/A"}</Td>
                <Td align="right">{formatCompact(r.grossProfit)}</Td>
                <Td align="right">{r.grossProfitTarget !== null ? formatCompact(r.grossProfitTarget) : "N/A"}</Td>
                <Td align="center"><AchievementBadge pct={r.attainmentPct} /></Td>
                <Td align="right" className={r.variance !== null && r.variance < 0 ? "text-red-600" : "text-emerald-700"}>{r.variance !== null ? formatCompact(r.variance) : "N/A"}</Td>
                <Td align="right">{r.grossMarginPct !== null ? `${r.grossMarginPct.toFixed(1)}%` : "N/A"}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">{formatCompact(displayedSummary.revenue)}</Td>
              <Td align="right">{displayedSummary.target !== null ? formatCompact(displayedSummary.target) : "N/A"}</Td>
              <Td align="center">
                <AchievementBadge pct={displayedSummary.achievementPct} />
              </Td>
              <Td align="right">{displayedSummary.target !== null ? formatCompact(displayedSummary.revenue - displayedSummary.target) : "N/A"}</Td>
              <Td align="right">{formatCompact(displayedSummary.grossProfit)}</Td>
              <Td align="right">{displayedGrossProfitTarget !== null ? formatCompact(displayedGrossProfitTarget) : "N/A"}</Td>
              <Td align="center"><AchievementBadge pct={displayedGrossProfitPerformance.attainmentPct} /></Td>
              <Td align="right" className={displayedGrossProfitPerformance.variance !== null && displayedGrossProfitPerformance.variance < 0 ? "text-red-600" : "text-emerald-700"}>{displayedGrossProfitPerformance.variance !== null ? formatCompact(displayedGrossProfitPerformance.variance) : "N/A"}</Td>
              <Td align="right">{displayedSummary.grossMarginPct !== null ? `${displayedSummary.grossMarginPct.toFixed(1)}%` : "N/A"}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </>
  );
}
