"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatPercent, marginTier, tierBarColor } from "@/lib/format";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { summarizeSalesForPeriod } from "@/lib/timeIntelligence";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const MARGIN_LABEL = { good: "Healthy", warn: "Moderate", bad: "Thin", neutral: "N/A" } as const;

export function ProfitabilityView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const principals = principalsByRevenueDesc(dataset, period);
  const selected = principals.find((p) => p.principalKey === selectedPrincipalKey) ?? null;
  const portfolio = summarizeSalesForPeriod(dataset, period, null);

  const withMargin = principals.filter((p) => p.grossMarginPct !== null);
  const highest = [...withMargin].sort((a, b) => (b.grossMarginPct ?? 0) - (a.grossMarginPct ?? 0))[0];
  const lowest = [...withMargin].sort((a, b) => (a.grossMarginPct ?? 0) - (b.grossMarginPct ?? 0))[0];

  const tier = marginTier(selected ? selected.grossMarginPct : portfolio.grossMarginPct);

  const chartData = selected
    ? [
        { name: selected.principal.split("-")[0], value: selected.grossMarginPct ?? 0, fill: tierBarColor[marginTier(selected.grossMarginPct)] },
        { name: "Portfolio Avg", value: portfolio.grossMarginPct ?? 0, fill: "var(--accent-grey)" },
      ]
    : principals.map((p) => ({ name: p.principal.split("-")[0], value: p.grossMarginPct ?? 0, fill: tierBarColor[marginTier(p.grossMarginPct)] }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        {selected ? (
          <>
            <KpiCard accent="revenue" label="Gross Profit" value={<AnimatedValue value={selected.grossProfit} format={formatCompact} />} />
            <KpiCard
              accent="quarter"
              label="Gross Margin %"
              value={selected.grossMarginPct !== null ? <AnimatedValue value={selected.grossMarginPct} format={formatPercent} /> : "N/A"}
            />
            <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={<AnimatedValue value={selected.revenue} format={formatCompact} />} />
            <KpiCard accent="quarter" size="md" label="Margin Tier" value={MARGIN_LABEL[tier]} />
            <KpiCard
              accent="growth"
              label="Vs Portfolio Avg"
              value={
                portfolio.grossMarginPct !== null && selected.grossMarginPct !== null
                  ? `${(selected.grossMarginPct - portfolio.grossMarginPct).toFixed(1)}pp`
                  : "—"
              }
            />
          </>
        ) : (
          <>
            <KpiCard accent="revenue" label="Gross Profit" value={<AnimatedValue value={portfolio.grossProfit} format={formatCompact} />} />
            <KpiCard
              accent="quarter"
              label="Gross Margin %"
              value={portfolio.grossMarginPct !== null ? <AnimatedValue value={portfolio.grossMarginPct} format={formatPercent} /> : "N/A"}
            />
            <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={<AnimatedValue value={portfolio.revenue} format={formatCompact} />} />
            <KpiCard accent="quarter" size="md" label="Margin Tier" value={MARGIN_LABEL[tier]} />
            <KpiCard
              accent="quarter"
              size="md"
              label="Highest Margin"
              value={highest?.principal.split("-")[0] ?? "—"}
              sublabel={highest?.grossMarginPct !== undefined ? `${highest?.grossMarginPct?.toFixed(1)}%` : undefined}
            />
            <KpiCard
              accent="growth"
              size="md"
              label="Lowest Margin"
              value={lowest?.principal.split("-")[0] ?? "—"}
              sublabel={lowest?.grossMarginPct !== undefined ? `${lowest?.grossMarginPct?.toFixed(1)}%` : undefined}
            />
          </>
        )}
      </KpiGrid>

      <SectionCard title={selected ? `${selected.principal} vs Portfolio Average Margin` : "Gross Margin % by Principal"}>
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
            <Th align="right">Revenue</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="center">Margin %</Th>
          </Thead>
          <tbody>
            {(selected ? [selected] : principals).map((p) => (
              <tr key={p.principalKey} className={selectedPrincipalKey === p.principalKey ? "bg-accent-blue-soft" : ""}>
                <Td>{p.principal}</Td>
                <Td align="right">{formatCompact(p.revenue)}</Td>
                <Td align="right">{formatCompact(p.grossProfit)}</Td>
                <Td align="center">
                  <Badge tier={marginTier(p.grossMarginPct)}>{p.grossMarginPct !== null ? `${p.grossMarginPct.toFixed(1)}%` : "N/A"}</Badge>
                </Td>
              </tr>
            ))}
            {!selected ? (
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatCompact(portfolio.revenue)}</Td>
                <Td align="right">{formatCompact(portfolio.grossProfit)}</Td>
                <Td align="center">
                  <Badge tier={marginTier(portfolio.grossMarginPct)}>
                    {portfolio.grossMarginPct !== null ? `${portfolio.grossMarginPct.toFixed(1)}%` : "N/A"}
                  </Badge>
                </Td>
              </TotalRow>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
