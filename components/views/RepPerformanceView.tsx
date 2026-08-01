"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, formatPercent, productivityTier, marginTier, achievementTier, tierBarColor } from "@/lib/format";
import { resolvePeriodMonths } from "@/lib/timeIntelligence";
import { buildRepPerformanceRows, type RepPerformanceEmployee, type RepMonthCoverage, type PrincipalMonthTarget, type SapRepActualInput } from "@/lib/repPerformance";
import { CHART_GRID_COLOR } from "@/components/charts/theme";

type SalesRoleFilter = "Primary Sales" | "Secondary Sales";

export function RepPerformanceView({ selectedPrincipalKey, period }: ViewProps) {
  const [sapRows, setSapRows] = useState<SapRepActualInput[]>([]);
  const [employees, setEmployees] = useState<RepPerformanceEmployee[]>([]);
  const [coverageByRepMonth, setCoverageByRepMonth] = useState<RepMonthCoverage[]>([]);
  const [targets, setTargets] = useState<PrincipalMonthTarget[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [teamLeaderFilter, setTeamLeaderFilter] = useState<string | null>(null);
  const [salesRoleFilter, setSalesRoleFilter] = useState<SalesRoleFilter | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    Promise.all([
      fetch(`/api/sales/rep-actuals?year=${encodeURIComponent(period.year)}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/dashboard/rep-performance?year=${encodeURIComponent(period.year)}`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([sap, perf]) => {
        if (cancelled) return;
        if (sap.error) throw new Error(sap.error);
        if (perf.error) throw new Error(perf.error);
        setSapRows(sap.rows ?? []);
        setEmployees(perf.employees ?? []);
        setCoverageByRepMonth(perf.coverageByRepMonth ?? []);
        setTargets(perf.targets ?? []);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [period.year]);

  const months = useMemo(() => resolvePeriodMonths(period), [period]);

  const teamLeaderOptions = useMemo(
    () => Array.from(new Set(employees.map((e) => e.teamLeader).filter((name): name is string => !!name))).sort(),
    [employees]
  );

  const merged = useMemo(
    () =>
      buildRepPerformanceRows({
        employees,
        coverageByRepMonth,
        targets,
        sapRows,
        months,
        principalKey: selectedPrincipalKey,
        teamLeaderFilter,
        salesRoleFilter,
      }),
    [employees, coverageByRepMonth, targets, sapRows, months, selectedPrincipalKey, teamLeaderFilter, salesRoleFilter]
  );

  const totalRevenue = merged.reduce((sum, row) => sum + row.revenue, 0);
  const totalVolume = merged.reduce((sum, row) => sum + row.volume, 0);
  const totalCoverage = merged.reduce((sum, row) => sum + (row.coverage ?? 0), 0);
  const totalProductive = merged.reduce((sum, row) => sum + (row.productiveCalls ?? 0), 0);
  const portfolioProductivity = totalCoverage > 0 ? Math.round((totalProductive / totalCoverage) * 1000) / 10 : 0;
  const primaryWithTarget = merged.filter((row) => row.target != null && row.target > 0);
  const totalTarget = primaryWithTarget.reduce((sum, row) => sum + (row.target ?? 0), 0);
  const targetRevenue = primaryWithTarget.reduce((sum, row) => sum + row.revenue, 0);
  const portfolioAchievement = totalTarget > 0 ? Math.round((targetRevenue / totalTarget) * 1000) / 10 : null;
  const topRevenueRep = merged[0] ?? null;
  const topProductivityRep = [...merged].sort((a, b) => (b.productivityPct ?? -1) - (a.productivityPct ?? -1))[0] ?? null;
  const revenueChartData = merged.slice(0, 10).map((row) => ({ name: row.employeeName, value: row.revenue }));
  const topProductivityReps = [...merged].filter((row) => row.productivityPct != null).sort((a, b) => (b.productivityPct ?? 0) - (a.productivityPct ?? 0)).slice(0, 15);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Team Leader</span>
          <div className="flex items-center rounded-full border border-border bg-background-elevated px-3 py-1.5">
            <select
              aria-label="Team Leader"
              value={teamLeaderFilter ?? ""}
              onChange={(event) => setTeamLeaderFilter(event.target.value || null)}
              className="max-w-[180px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
            >
              <option value="">All Team Leaders</option>
              {teamLeaderOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Sales Role</span>
          <div className="flex items-center rounded-full border border-border bg-background-elevated px-3 py-1.5">
            <select
              aria-label="Sales Role"
              value={salesRoleFilter ?? ""}
              onChange={(event) => setSalesRoleFilter((event.target.value || null) as SalesRoleFilter | null)}
              className="max-w-[160px] bg-transparent text-xs font-semibold text-muted-strong outline-none"
            >
              <option value="">All Roles</option>
              <option value="Primary Sales">Primary Sales</option>
              <option value="Secondary Sales">Secondary Sales</option>
            </select>
          </div>
        </div>
      </div>

      <KpiGrid>
        <KpiCard accent="revenue" label={`${period.kind} SAP Rep Value`} value={<AnimatedValue value={totalRevenue} format={formatCompact} />} />
        <KpiCard accent="mission" label={`${period.kind} SAP Rep Volume`} value={<AnimatedValue value={totalVolume} format={formatCompact} />} />
        <KpiCard accent="coverage" label="Reps Tracked" value={<AnimatedValue value={merged.length} format={formatNumber} />} />
        <KpiCard accent="coverage" label="Portfolio Productivity" value={<AnimatedValue value={portfolioProductivity} format={formatPercent} />} />
        <KpiCard
          accent="growth"
          label="Target Achievement"
          value={portfolioAchievement != null ? <AnimatedValue value={portfolioAchievement} format={formatPercent} /> : "—"}
          sublabel="Primary sales only"
        />
        <KpiCard
          accent="growth"
          size="md"
          label="Top Rep by SAP Value"
          value={topRevenueRep?.employeeName ?? "—"}
          sublabel={topRevenueRep ? formatCompact(topRevenueRep.revenue) : undefined}
        />
        <KpiCard
          accent="quarter"
          size="md"
          label="Top Rep by Productivity"
          value={topProductivityRep?.employeeName ?? "—"}
          sublabel={topProductivityRep?.productivityPct != null ? `${topProductivityRep.productivityPct.toFixed(1)}%` : undefined}
        />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title="Top 10 Reps by SAP Value" action={<span className="text-xs text-muted">{status === "ready" ? "SAP transaction actuals" : status === "error" ? "Data unavailable" : "Loading…"}</span>}>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={revenueChartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID_COLOR} />
              <XAxis type="number" tickFormatter={(value) => formatCompact(value)} fontSize={11} />
              <YAxis type="category" dataKey="name" width={120} fontSize={11} />
              <Tooltip formatter={(value) => formatCompact(Number(value))} />
              <Bar dataKey="value" fill="var(--primary-blue)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title={`Productivity % by Rep (top ${topProductivityReps.length})`}>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={topProductivityReps.map((row) => ({ name: row.employeeName, value: row.productivityPct ?? 0 }))} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {topProductivityReps.map((row, index) => (
                  <Cell key={index} fill={tierBarColor[productivityTier(row.productivityPct ?? 0)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Rep Leaderboard" action={<span className="text-xs text-muted">SAP: value/volume · Pine (RepCall): coverage/productivity · Target: contribution % × Principal target, Primary only</span>}>
        <TableWrap>
          <Thead>
            <Th>Employee</Th>
            <Th>Team Leader</Th>
            <Th>Role</Th>
            <Th align="right">SAP Value</Th>
            <Th align="right">SAP Volume</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="right">Margin</Th>
            <Th align="right">Coverage</Th>
            <Th align="center">Productivity</Th>
            <Th align="right">Target</Th>
            <Th align="center">Achievement</Th>
          </Thead>
          <tbody>
            {merged.map((row) => (
              <tr key={row.employeeCode ?? row.employeeName}>
                <Td>{row.employeeName}</Td>
                <Td>{row.teamLeader ?? "—"}</Td>
                <Td>{row.salesRole}</Td>
                <Td align="right">{formatCompact(row.revenue)}</Td>
                <Td align="right">{formatCompact(row.volume)}</Td>
                <Td align="right">{formatCompact(row.grossProfit)}</Td>
                <Td align="right"><Badge tier={marginTier(row.grossMarginPct)}>{formatPercent(row.grossMarginPct)}</Badge></Td>
                <Td align="right">{row.coverage != null ? formatNumber(row.coverage) : "—"}</Td>
                <Td align="center">{row.productivityPct != null ? <Badge tier={productivityTier(row.productivityPct)}>{row.productivityPct.toFixed(1)}%</Badge> : "—"}</Td>
                <Td align="right">{row.target != null ? formatCompact(row.target) : "—"}</Td>
                <Td align="center">{row.achievementPct != null ? <Badge tier={achievementTier(row.achievementPct)}>{row.achievementPct.toFixed(1)}%</Badge> : "—"}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td>—</Td>
              <Td align="right">{formatCompact(totalRevenue)}</Td>
              <Td align="right">{formatCompact(totalVolume)}</Td>
              <Td align="right">{formatCompact(merged.reduce((sum, row) => sum + row.grossProfit, 0))}</Td>
              <Td align="right">—</Td>
              <Td align="right">{formatNumber(totalCoverage)}</Td>
              <Td align="center"><Badge tier={productivityTier(portfolioProductivity)}>{portfolioProductivity.toFixed(1)}%</Badge></Td>
              <Td align="right">{formatCompact(totalTarget)}</Td>
              <Td align="center">{portfolioAchievement != null ? <Badge tier={achievementTier(portfolioAchievement)}>{portfolioAchievement.toFixed(1)}%</Badge> : "—"}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
