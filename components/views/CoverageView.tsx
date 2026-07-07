"use client";

import { useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber, formatPercent, productivityTier, tierBarColor } from "@/lib/format";
import {
  CANONICAL_MONTHS,
  getAvailableMonths,
  resolvePeriodMonths,
  summarizeCoverageForPeriod,
  summarizeCoverageByRep,
  summarizeCoverageByRepAcrossPrincipals,
} from "@/lib/timeIntelligence";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const TOP_N_REPS = 12;

export function CoverageView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const [selectedRep, setSelectedRep] = useState<string | null>(null);

  const currentSummary = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey, "primary");
  const reps = summarizeCoverageByRep(dataset, period, selectedPrincipalKey, "primary").sort((a, b) => b.coverage - a.coverage);

  const secondarySummary = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey, "secondary");
  const secondaryReps = summarizeCoverageByRep(dataset, period, selectedPrincipalKey, "secondary")
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, 10);

  const monthsThisYear = getAvailableMonths(dataset, period.year);
  const monthlyTrend = CANONICAL_MONTHS.filter((m) => monthsThisYear.includes(m)).map((month) => {
    const s = summarizeCoverageForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey, "primary");
    return { month, coverage: s.coverage, productive: s.productiveCalls, productivityPct: s.productivityPct };
  });

  const avgCoverage = monthlyTrend.length ? Math.round(monthlyTrend.reduce((s, r) => s + r.coverage, 0) / monthlyTrend.length) : 0;
  const avgProductivity = monthlyTrend.length
    ? Math.round((monthlyTrend.reduce((s, r) => s + r.productivityPct, 0) / monthlyTrend.length) * 10) / 10
    : 0;

  const months = resolvePeriodMonths(period);
  const monthKeys = new Set(months.map((m) => `${m.year}|${m.monthIndex}`));
  const rowsInPeriod = dataset.monthlyCoverage.filter(
    (r) =>
      monthKeys.has(`${r.year}|${r.monthIndex}`) &&
      (!selectedPrincipalKey || r.principalKey === selectedPrincipalKey) &&
      r.salesRole.toLowerCase().includes("primary")
  );
  const byPrincipal = new Map<string, { name: string; coverage: number; productiveCalls: number }>();
  for (const r of rowsInPeriod) {
    const existing = byPrincipal.get(r.principalKey);
    if (existing) {
      existing.coverage += r.coverage;
      existing.productiveCalls += r.productiveCalls;
    } else {
      byPrincipal.set(r.principalKey, { name: r.principal.split("-")[0], coverage: r.coverage, productiveCalls: r.productiveCalls });
    }
  }
  const principalBars = Array.from(byPrincipal.values()).sort((a, b) => b.coverage - a.coverage);

  const repByPrincipal = selectedRep ? summarizeCoverageByRepAcrossPrincipals(dataset, period, selectedRep) : [];

  const productivityChartData = selectedRep
    ? repByPrincipal.map((p) => ({ name: p.principal.split("-")[0], value: p.productivityPct, fill: tierBarColor[productivityTier(p.productivityPct)] }))
    : selectedPrincipalKey
      ? reps.slice(0, TOP_N_REPS).map((r) => ({ name: r.employeeName, value: r.productivityPct, fill: tierBarColor[productivityTier(r.productivityPct)] }))
      : principalBars.map((p) => ({
          name: p.name,
          value: p.coverage > 0 ? Math.round((p.productiveCalls / p.coverage) * 1000) / 10 : 0,
          fill: tierBarColor[productivityTier(p.coverage > 0 ? (p.productiveCalls / p.coverage) * 100 : 0)],
        }));

  const chartTitle = selectedRep
    ? `${selectedRep} — Productivity by Principal`
    : selectedPrincipalKey
      ? `Productivity % by Rep (top ${Math.min(TOP_N_REPS, reps.length)})`
      : "Productivity % by Principal";

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="coverage" label={`${period.kind} Coverage (Primary)`} value={<AnimatedValue value={currentSummary.coverage} format={formatNumber} />} />
        <KpiCard accent="coverage" label={`${period.kind} Productive (Primary)`} value={<AnimatedValue value={currentSummary.productiveCalls} format={formatNumber} />} />
        <KpiCard
          accent="coverage"
          label={`${period.kind} Productivity (Primary)`}
          value={<AnimatedValue value={currentSummary.productivityPct} format={formatPercent} />}
        />
        <KpiCard accent="coverage" label={`${period.year} Monthly Avg Coverage`} value={<AnimatedValue value={avgCoverage} format={formatNumber} />} />
        <KpiCard accent="coverage" label={`${period.year} Monthly Avg Productivity`} value={<AnimatedValue value={avgProductivity} format={formatPercent} />} />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title={`${period.year} Coverage vs Productive Outlets (Primary)`}>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthlyTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(0, 3)} stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="coverage" name="Coverage" stroke="var(--accent-blue)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="productive" name="Productive" stroke="var(--accent-green)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard
          title={chartTitle}
          action={
            selectedRep ? (
              <button
                onClick={() => setSelectedRep(null)}
                className="text-xs font-semibold text-accent-blue hover:underline"
              >
                Clear rep
              </button>
            ) : null
          }
        >
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

      <SectionCard
        title={`Rep Drill-Down (Primary) — ${period.kind} ${period.year}`}
        action={<span className="text-xs text-muted">Click a row to see that rep across every principal they serve</span>}
      >
        <TableWrap>
          <Thead>
            <Th>Employee</Th>
            <Th>Role</Th>
            <Th align="right">Outlets Covered</Th>
            <Th align="right">Productive Outlets</Th>
            <Th align="center">Productivity %</Th>
          </Thead>
          <tbody>
            {reps.map((r) => (
              <tr
                key={r.employeeName}
                onClick={() => setSelectedRep(selectedRep === r.employeeName ? null : r.employeeName)}
                className={`cursor-pointer transition-colors duration-150 hover:bg-accent-blue-soft ${
                  selectedRep === r.employeeName ? "bg-accent-blue-soft" : ""
                }`}
              >
                <Td>{r.employeeName}</Td>
                <Td>{r.salesRole}</Td>
                <Td align="right">{formatNumber(r.coverage)}</Td>
                <Td align="right">{formatNumber(r.productiveCalls)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.productivityPct)}>{r.productivityPct.toFixed(1)}%</Badge>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">{formatNumber(currentSummary.coverage)}</Td>
              <Td align="right">{formatNumber(currentSummary.productiveCalls)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(currentSummary.productivityPct)}>{currentSummary.productivityPct.toFixed(1)}%</Badge>
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Secondary Sales — Additional Outlook">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 min-[560px]:grid-cols-3 gap-4">
            <KpiCard
              accent="quarter"
              size="md"
              label={`${period.kind} Coverage (Secondary)`}
              value={<AnimatedValue value={secondarySummary.coverage} format={formatNumber} />}
            />
            <KpiCard
              accent="quarter"
              size="md"
              label={`${period.kind} Productive (Secondary)`}
              value={<AnimatedValue value={secondarySummary.productiveCalls} format={formatNumber} />}
            />
            <KpiCard
              accent="quarter"
              size="md"
              label={`${period.kind} Productivity (Secondary)`}
              value={<AnimatedValue value={secondarySummary.productivityPct} format={formatPercent} />}
            />
          </div>
          {secondaryReps.length > 0 ? (
            <TableWrap>
              <Thead>
                <Th>Employee</Th>
                <Th align="right">Outlets Covered</Th>
                <Th align="right">Productive Outlets</Th>
                <Th align="center">Productivity %</Th>
              </Thead>
              <tbody>
                {secondaryReps.map((r) => (
                  <tr key={r.employeeName}>
                    <Td>{r.employeeName}</Td>
                    <Td align="right">{formatNumber(r.coverage)}</Td>
                    <Td align="right">{formatNumber(r.productiveCalls)}</Td>
                    <Td align="center">
                      <Badge tier={productivityTier(r.productivityPct)}>{r.productivityPct.toFixed(1)}%</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <p className="text-xs text-muted">No secondary sales activity for this period.</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
