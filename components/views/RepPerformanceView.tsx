"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, formatPercent, productivityTier, marginTier, tierBarColor } from "@/lib/format";
import { summarizeCoverageByRep, summarizeBrandCustomerByRep } from "@/lib/timeIntelligence";

export function RepPerformanceView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const coverageByRep = summarizeCoverageByRep(dataset, period, selectedPrincipalKey);
  const revenueByRep = summarizeBrandCustomerByRep(dataset, period, selectedPrincipalKey);

  const revenueMap = new Map(revenueByRep.map((r) => [r.salesEmployee, r]));
  const merged = coverageByRep
    .map((c) => {
      const rev = revenueMap.get(c.employeeName);
      return {
        employeeName: c.employeeName,
        salesRole: c.salesRole,
        coverage: c.coverage,
        productiveCalls: c.productiveCalls,
        productivityPct: c.productivityPct,
        revenue: rev?.revenue ?? 0,
        grossProfit: rev?.grossProfit ?? 0,
        grossMarginPct: rev?.grossMarginPct ?? null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = merged.reduce((s, r) => s + r.revenue, 0);
  const totalCoverage = merged.reduce((s, r) => s + r.coverage, 0);
  const totalProductive = merged.reduce((s, r) => s + r.productiveCalls, 0);
  const portfolioProductivity = totalCoverage > 0 ? Math.round((totalProductive / totalCoverage) * 1000) / 10 : 0;

  const topRevenueRep = merged[0] ?? null;
  const topProductivityRep = [...merged].sort((a, b) => b.productivityPct - a.productivityPct)[0] ?? null;

  const revenueChartData = merged.slice(0, 10).map((r) => ({ name: r.employeeName, value: r.revenue }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="revenue" label={`${period.kind} Rep Revenue`} value={<AnimatedValue value={totalRevenue} format={formatCompact} />} />
        <KpiCard accent="coverage" label="Reps Tracked" value={<AnimatedValue value={merged.length} format={formatNumber} />} />
        <KpiCard accent="coverage" label="Portfolio Productivity" value={<AnimatedValue value={portfolioProductivity} format={formatPercent} />} />
        <KpiCard
          accent="growth"
          size="md"
          label="Top Rep by Revenue"
          value={topRevenueRep?.employeeName ?? "—"}
          sublabel={topRevenueRep ? formatCompact(topRevenueRep.revenue) : undefined}
        />
        <KpiCard
          accent="quarter"
          size="md"
          label="Top Rep by Productivity"
          value={topProductivityRep?.employeeName ?? "—"}
          sublabel={topProductivityRep ? `${topProductivityRep.productivityPct.toFixed(1)}%` : undefined}
        />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title="Top 10 Reps by Revenue">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={revenueChartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e8ef" />
              <XAxis type="number" tickFormatter={(v) => formatCompact(v)} fontSize={11} />
              <YAxis type="category" dataKey="name" width={120} fontSize={11} />
              <Tooltip formatter={(v) => formatCompact(Number(v))} />
              <Bar dataKey="value" fill="var(--accent-blue)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Productivity % by Rep">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart
              data={merged.map((r) => ({ name: r.employeeName, value: r.productivityPct }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 32 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8ef" vertical={false} />
              <XAxis dataKey="name" fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {merged.map((r, i) => (
                  <Cell key={i} fill={tierBarColor[productivityTier(r.productivityPct)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Rep Leaderboard">
        <TableWrap>
          <Thead>
            <Th>Employee</Th>
            <Th>Role</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="right">Margin</Th>
            <Th align="right">Coverage</Th>
            <Th align="center">Productivity</Th>
          </Thead>
          <tbody>
            {merged.map((r) => (
              <tr key={r.employeeName}>
                <Td>{r.employeeName}</Td>
                <Td>{r.salesRole}</Td>
                <Td align="right">{formatCompact(r.revenue)}</Td>
                <Td align="right">{formatCompact(r.grossProfit)}</Td>
                <Td align="right">
                  <Badge tier={marginTier(r.grossMarginPct)}>{formatPercent(r.grossMarginPct)}</Badge>
                </Td>
                <Td align="right">{formatNumber(r.coverage)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.productivityPct)}>{r.productivityPct.toFixed(1)}%</Badge>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">{formatCompact(totalRevenue)}</Td>
              <Td align="right">{formatCompact(merged.reduce((s, r) => s + r.grossProfit, 0))}</Td>
              <Td align="right">—</Td>
              <Td align="right">{formatNumber(totalCoverage)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(portfolioProductivity)}>{portfolioProductivity.toFixed(1)}%</Badge>
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
