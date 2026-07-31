"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, formatPercent, productivityTier, marginTier, tierBarColor } from "@/lib/format";
import { resolvePeriodMonths, summarizeCoverageByRep } from "@/lib/timeIntelligence";
import { CHART_GRID_COLOR } from "@/components/charts/theme";

interface SapRepActualRow {
  year: string;
  monthIndex: number;
  principal: string;
  sapName: string;
  employeeCode: string | null;
  employeeName: string | null;
  salesRole: string | null;
  volume: number;
  revenue: number;
  grossProfit: number;
}

function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function RepPerformanceView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const [sapRows, setSapRows] = useState<SapRepActualRow[]>([]);
  const [sapStatus, setSapStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setSapStatus("loading");
    fetch(`/api/sales/rep-actuals?year=${encodeURIComponent(period.year)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load SAP actuals.");
        if (!cancelled) {
          setSapRows(body.rows ?? []);
          setSapStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setSapStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [period.year]);

  const coverageByRep = summarizeCoverageByRep(dataset, period, selectedPrincipalKey);
  const selectedMonthKeys = useMemo(
    () => new Set(resolvePeriodMonths(period).map((month) => `${month.year}|${month.monthIndex}`)),
    [period]
  );

  const merged = useMemo(() => {
    const byRep = new Map<
      string,
      {
        employeeName: string;
        salesRole: string;
        coverage: number;
        productiveCalls: number;
        productivityPct: number;
        volume: number;
        revenue: number;
        grossProfit: number;
        grossMarginPct: number | null;
      }
    >();

    for (const coverage of coverageByRep) {
      const key = nameKey(coverage.employeeName);
      byRep.set(key, {
        employeeName: coverage.employeeName,
        salesRole: coverage.salesRole,
        coverage: coverage.coverage,
        productiveCalls: coverage.productiveCalls,
        productivityPct: coverage.productivityPct,
        volume: 0,
        revenue: 0,
        grossProfit: 0,
        grossMarginPct: null,
      });
    }

    for (const row of sapRows) {
      if (!selectedMonthKeys.has(`${row.year}|${row.monthIndex}`)) continue;
      if (selectedPrincipalKey && row.principal !== selectedPrincipalKey) continue;
      const label = row.employeeName || row.sapName;
      const key = nameKey(label);
      const existing = byRep.get(key) ?? {
        employeeName: label,
        salesRole: row.salesRole ?? "Unassigned",
        coverage: 0,
        productiveCalls: 0,
        productivityPct: 0,
        volume: 0,
        revenue: 0,
        grossProfit: 0,
        grossMarginPct: null,
      };
      existing.volume += row.volume;
      existing.revenue += row.revenue;
      existing.grossProfit += row.grossProfit;
      if (row.salesRole) existing.salesRole = row.salesRole;
      existing.grossMarginPct = existing.revenue > 0 ? (existing.grossProfit / existing.revenue) * 100 : null;
      byRep.set(key, existing);
    }

    return Array.from(byRep.values()).sort((a, b) => b.revenue - a.revenue);
  }, [coverageByRep, sapRows, selectedMonthKeys, selectedPrincipalKey]);

  const totalRevenue = merged.reduce((sum, row) => sum + row.revenue, 0);
  const totalVolume = merged.reduce((sum, row) => sum + row.volume, 0);
  const totalCoverage = merged.reduce((sum, row) => sum + row.coverage, 0);
  const totalProductive = merged.reduce((sum, row) => sum + row.productiveCalls, 0);
  const portfolioProductivity = totalCoverage > 0 ? Math.round((totalProductive / totalCoverage) * 1000) / 10 : 0;
  const topRevenueRep = merged[0] ?? null;
  const topProductivityRep = [...merged].sort((a, b) => b.productivityPct - a.productivityPct)[0] ?? null;
  const revenueChartData = merged.slice(0, 10).map((row) => ({ name: row.employeeName, value: row.revenue }));
  const topProductivityReps = [...merged].sort((a, b) => b.productivityPct - a.productivityPct).slice(0, 15);

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="revenue" label={`${period.kind} SAP Rep Value`} value={<AnimatedValue value={totalRevenue} format={formatCompact} />} />
        <KpiCard accent="mission" label={`${period.kind} SAP Rep Volume`} value={<AnimatedValue value={totalVolume} format={formatCompact} />} />
        <KpiCard accent="coverage" label="Reps Tracked" value={<AnimatedValue value={merged.length} format={formatNumber} />} />
        <KpiCard accent="coverage" label="Portfolio Productivity" value={<AnimatedValue value={portfolioProductivity} format={formatPercent} />} />
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
          sublabel={topProductivityRep ? `${topProductivityRep.productivityPct.toFixed(1)}%` : undefined}
        />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title="Top 10 Reps by SAP Value" action={<span className="text-xs text-muted">{sapStatus === "ready" ? "SAP transaction actuals" : sapStatus === "error" ? "SAP actuals unavailable" : "Loading SAP actuals…"}</span>}>
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
            <BarChart data={topProductivityReps.map((row) => ({ name: row.employeeName, value: row.productivityPct }))} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {topProductivityReps.map((row, index) => (
                  <Cell key={index} fill={tierBarColor[productivityTier(row.productivityPct)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Rep Leaderboard" action={<span className="text-xs text-muted">Sales value and volume: SAP only · Coverage and productivity: Pine</span>}>
        <TableWrap>
          <Thead>
            <Th>Employee</Th>
            <Th>Role</Th>
            <Th align="right">SAP Value</Th>
            <Th align="right">SAP Volume</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="right">Margin</Th>
            <Th align="right">Coverage</Th>
            <Th align="center">Productivity</Th>
          </Thead>
          <tbody>
            {merged.map((row) => (
              <tr key={row.employeeName}>
                <Td>{row.employeeName}</Td>
                <Td>{row.salesRole}</Td>
                <Td align="right">{formatCompact(row.revenue)}</Td>
                <Td align="right">{formatCompact(row.volume)}</Td>
                <Td align="right">{formatCompact(row.grossProfit)}</Td>
                <Td align="right"><Badge tier={marginTier(row.grossMarginPct)}>{formatPercent(row.grossMarginPct)}</Badge></Td>
                <Td align="right">{formatNumber(row.coverage)}</Td>
                <Td align="center"><Badge tier={productivityTier(row.productivityPct)}>{row.productivityPct.toFixed(1)}%</Badge></Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">{formatCompact(totalRevenue)}</Td>
              <Td align="right">{formatCompact(totalVolume)}</Td>
              <Td align="right">{formatCompact(merged.reduce((sum, row) => sum + row.grossProfit, 0))}</Td>
              <Td align="right">—</Td>
              <Td align="right">{formatNumber(totalCoverage)}</Td>
              <Td align="center"><Badge tier={productivityTier(portfolioProductivity)}>{portfolioProductivity.toFixed(1)}%</Badge></Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
