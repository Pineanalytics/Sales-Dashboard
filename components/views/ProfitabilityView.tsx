"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatPercent, marginTier, tierBarColor } from "@/lib/format";
import { principalsByMtdRevDesc } from "@/lib/selectors";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const MARGIN_LABEL = { good: "Healthy", warn: "Moderate", bad: "Thin", neutral: "N/A" } as const;

export function ProfitabilityView({ dataset, principal }: ViewProps) {
  const principals = principalsByMtdRevDesc(dataset);

  const withMargin = dataset.principals.filter((p) => p.grossMarginPct !== null);
  const highest = [...withMargin].sort((a, b) => (b.grossMarginPct ?? 0) - (a.grossMarginPct ?? 0))[0];
  const lowest = [...withMargin].sort((a, b) => (a.grossMarginPct ?? 0) - (b.grossMarginPct ?? 0))[0];
  const portfolioAvgMargin = dataset.totals.grossMarginPct;

  const tier = marginTier(principal ? principal.grossMarginPct : dataset.totals.grossMarginPct);

  const chartData = principal
    ? [
        { name: principal.name.split("-")[0], value: principal.grossMarginPct ?? 0, fill: tierBarColor[marginTier(principal.grossMarginPct)] },
        { name: "Portfolio Avg", value: portfolioAvgMargin ?? 0, fill: "var(--accent-grey)" },
      ]
    : principals.map((p) => ({ name: p.name.split("-")[0], value: p.grossMarginPct ?? 0, fill: tierBarColor[marginTier(p.grossMarginPct)] }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        {principal ? (
          <>
            <KpiCard accent="revenue" label="Gross Profit" value={<AnimatedValue value={principal.grossProfit} format={formatCompact} />} />
            <KpiCard
              accent="quarter"
              label="Gross Margin %"
              value={principal.grossMarginPct !== null ? <AnimatedValue value={principal.grossMarginPct} format={formatPercent} /> : "N/A"}
            />
            <KpiCard accent="revenue" label="YTD Revenue" value={<AnimatedValue value={principal.ytdRev} format={formatCompact} />} />
            <KpiCard accent="quarter" size="md" label="Margin Tier" value={MARGIN_LABEL[tier]} />
            <KpiCard
              accent="growth"
              label="Vs Portfolio Avg"
              value={portfolioAvgMargin !== null && principal.grossMarginPct !== null ? `${(principal.grossMarginPct - portfolioAvgMargin).toFixed(1)}pp` : "—"}
            />
          </>
        ) : (
          <>
            <KpiCard accent="revenue" label="Gross Profit" value={<AnimatedValue value={dataset.totals.grossProfit} format={formatCompact} />} />
            <KpiCard
              accent="quarter"
              label="Gross Margin %"
              value={dataset.totals.grossMarginPct !== null ? <AnimatedValue value={dataset.totals.grossMarginPct} format={formatPercent} /> : "N/A"}
            />
            <KpiCard accent="revenue" label="YTD Revenue" value={<AnimatedValue value={dataset.totals.ytdRev} format={formatCompact} />} />
            <KpiCard accent="quarter" size="md" label="Margin Tier" value={MARGIN_LABEL[tier]} />
            <KpiCard
              accent="quarter"
              size="md"
              label="Highest Margin"
              value={highest?.name.split("-")[0] ?? "—"}
              sublabel={highest?.grossMarginPct !== undefined ? `${highest?.grossMarginPct?.toFixed(1)}%` : undefined}
            />
            <KpiCard
              accent="growth"
              size="md"
              label="Lowest Margin"
              value={lowest?.name.split("-")[0] ?? "—"}
              sublabel={lowest?.grossMarginPct !== undefined ? `${lowest?.grossMarginPct?.toFixed(1)}%` : undefined}
            />
          </>
        )}
      </KpiGrid>

      <SectionCard title={principal ? `${principal.name} vs Portfolio Average Margin` : "Gross Margin % by Principal"}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => `${v}%`} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <ReferenceLine y={15} stroke="var(--accent-green)" strokeDasharray="4 4" strokeOpacity={0.5} />
            <ReferenceLine y={8} stroke="var(--accent-amber)" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="Profitability">
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="center">Margin %</Th>
            <Th align="right">YTD Revenue</Th>
            <Th align="right">Avg Monthly Sales</Th>
          </Thead>
          <tbody>
            {(principal ? [principal] : principals).map((p) => (
              <tr key={p.name} className={principal?.name === p.name ? "bg-accent-blue-soft" : ""}>
                <Td>{p.name}</Td>
                <Td align="right">{formatCompact(p.grossProfit)}</Td>
                <Td align="center">
                  <Badge tier={marginTier(p.grossMarginPct)}>{p.grossMarginPct !== null ? `${p.grossMarginPct.toFixed(1)}%` : "N/A"}</Badge>
                </Td>
                <Td align="right">{formatCompact(p.ytdRev)}</Td>
                <Td align="right">{formatCompact(p.avgSales)}</Td>
              </tr>
            ))}
            {!principal ? (
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatCompact(dataset.totals.grossProfit)}</Td>
                <Td align="center">
                  <Badge tier={marginTier(dataset.totals.grossMarginPct)}>
                    {dataset.totals.grossMarginPct !== null ? `${dataset.totals.grossMarginPct.toFixed(1)}%` : "N/A"}
                  </Badge>
                </Td>
                <Td align="right">{formatCompact(dataset.totals.ytdRev)}</Td>
                <Td align="right">{formatCompact(dataset.totals.avgSales)}</Td>
              </TotalRow>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
