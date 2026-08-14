"use client";

import { useState } from "react";
import { ArrowTrending20Regular, Board20Regular, ChartMultiple20Regular, DataLine20Regular, PersonCircle20Regular } from "@fluentui/react-icons";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { AchievementBadge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { formatCompact } from "@/lib/format";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { CANONICAL_MONTHS, getAvailableMonths, summarizeSalesForPeriod } from "@/lib/timeIntelligence";
import { WeeklyRevenueKpi } from "@/components/dashboard/WeeklyRevenueKpi";
import { CHART_COLORS, CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { useCurrentUser } from "@/components/dashboard/UserContext";
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
  const [active, setActive] = useState<SalesSection>("cockpit");
  const user = useCurrentUser();
  const availableSections = SALES_SECTIONS.filter((section) => user?.role === "ADMIN" || (user?.allowedPages ?? []).includes(section.pageKey));
  const current = availableSections.some((section) => section.id === active) ? active : availableSections[0]?.id;
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-blue">Commercial analysis</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Sales Performance</h1><p className="mt-1 text-sm text-muted">One workspace for leadership, trends, reps and customers. Your global period and principal filters apply throughout.</p></div>
          <p className="text-xs text-muted">One active view at a time · less scrolling</p>
        </div>
        <nav aria-label="Sales analysis sections" className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          {availableSections.map(({ id, label, description, Icon }) => <button key={id} type="button" onClick={() => setActive(id)} className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-3 text-left transition ${current === id ? "border-primary-blue bg-accent-blue-soft shadow-sm" : "border-border bg-surface hover:border-secondary-blue/50 hover:bg-accent-blue-soft/40"}`}><span className={`rounded-lg p-2 ${current === id ? "bg-primary-blue text-white" : "bg-accent-blue-soft text-secondary-blue"}`}><Icon /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-foreground">{label}</span><span className="block truncate text-[11px] text-muted">{description}</span></span></button>)}
        </nav>
      </section>
      {current === "cockpit" ? <SalesCockpit /> : null}
      {current === "executive" ? <DashboardPage /> : null}
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
        <WeeklyRevenueKpi dataset={dataset} principalKey={selectedPrincipalKey} />
      </KpiGrid>

      <GrowthComparison dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />

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
