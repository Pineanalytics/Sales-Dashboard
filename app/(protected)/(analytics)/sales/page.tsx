"use client";

import { ArrowTrending20Regular, Board20Regular, ChartMultiple20Regular, DataLine20Regular, PersonCircle20Regular } from "@fluentui/react-icons";
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
import { useCurrentUser } from "@/components/dashboard/UserContext";
import { grossProfitTargetForPeriod, grossProfitTargetPerformance } from "@/lib/grossProfitTarget";
import DashboardPage from "../dashboard/page";
import TimeIntelligencePage from "../time-intelligence/page";
import RepsPage from "../reps/page";
import CustomersPage from "../customers/page";

function month3(month: string): string {
  return month.slice(0, 3);
}

type SalesSection = "cockpit" | "executive" | "time" | "reps" | "customers";

const SALES_SECTIONS: { id: SalesSection; pageKey: string; label: string; description: string; Icon: typeof ArrowTrending20Regular }[] = [
  { id: "cockpit", pageKey: "sales", label: "Sales cockpit", description: "Revenue, target and principal mix", Icon: ArrowTrending20Regular },
  { id: "executive", pageKey: "dashboard", label: "Executive", description: "MTD and YTD leadership view", Icon: Board20Regular },
  { id: "time", pageKey: "time-intelligence", label: "Time intelligence", description: "Trends, growth and comparisons", Icon: DataLine20Regular },
  { id: "reps", pageKey: "reps", label: "Rep performance", description: "People, contribution and productivity", Icon: PersonCircle20Regular },
  { id: "customers", pageKey: "customers", label: "Customers & brands", description: "Customer concentration and brand mix", Icon: ChartMultiple20Regular },
];

export default function SalesPage() {
  const active = useDashboardStore((state) => state.salesSection);
  const setActive = useDashboardStore((state) => state.setSalesSection);
  const user = useCurrentUser();
  const availableSections = SALES_SECTIONS.filter((section) => user?.role === "ADMIN" || (user?.allowedPages ?? []).includes(section.pageKey));
  const current = availableSections.some((section) => section.id === active) ? active : availableSections[0]?.id;
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <section className="rounded-2xl border border-border bg-surface p-3 shadow-sm md:p-4">
        <div className="grid items-center gap-3 xl:grid-cols-[minmax(230px,0.72fr)_minmax(0,3.28fr)]">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-blue">Commercial analysis</p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground">Sales Performance</h1>
            <p className="mt-0.5 text-xs text-muted">Global period and principal filters apply to every view.</p>
          </div>
          <nav aria-label="Sales analysis sections" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            {availableSections.map(({ id, label, description, Icon }) => (
              <button key={id} type="button" onClick={() => setActive(id)} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${current === id ? "border-primary-blue bg-accent-blue-soft shadow-sm" : "border-border bg-surface hover:border-secondary-blue/50 hover:bg-accent-blue-soft/40"}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4 ${current === id ? "bg-primary-blue text-white" : "bg-accent-blue-soft text-secondary-blue"}`}><Icon /></span>
                <span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{label}</span><span className="block truncate text-[10px] text-muted">{description}</span></span>
              </button>
            ))}
          </nav>
        </div>
      </section>
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
