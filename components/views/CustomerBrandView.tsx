"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, formatPercent, marginTier } from "@/lib/format";
import {
  summarizeBrandCustomerByCustomer,
  summarizeBrandCustomerByPrincipal,
} from "@/lib/timeIntelligence";
import {
  CHART_COLORS,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  tooltipContentStyle,
  tooltipLabelStyle,
} from "@/components/charts/theme";

export function CustomerBrandView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const customers = summarizeBrandCustomerByCustomer(dataset, period, selectedPrincipalKey).sort((a, b) => b.revenue - a.revenue);
  const principalShare = summarizeBrandCustomerByPrincipal(dataset, period).sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = customers.reduce((s, c) => s + c.revenue, 0);
  const totalVolume = customers.reduce((s, c) => s + c.volume, 0);
  const totalGP = customers.reduce((s, c) => s + c.grossProfit, 0);
  const overallMarginPct = totalRevenue > 0 ? Math.round((totalGP / totalRevenue) * 1000) / 10 : null;

  const topCustomer = customers[0] ?? null;
  const topBrand = principalShare[0] ?? null;

  const doughnutData = selectedPrincipalKey
    ? [
        ...customers.slice(0, 7).map((c) => ({ name: c.customerName, value: c.revenue })),
        {
          name: "Others",
          value: Math.max(0, totalRevenue - customers.slice(0, 7).reduce((s, c) => s + c.revenue, 0)),
        },
      ]
    : principalShare.map((p) => ({ name: p.principal.split("-")[0], value: p.revenue }));

  const topCustomersChart = customers.slice(0, 10).map((c) => ({ name: c.customerName, value: c.revenue }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={<AnimatedValue value={totalRevenue} format={formatCompact} />} />
        <KpiCard accent="revenue" label={`${period.kind} Volume`} value={<AnimatedValue value={totalVolume} format={formatNumber} />} />
        <KpiCard accent="quarter" label="Gross Margin" value={formatPercent(overallMarginPct)} size="md" />
        <KpiCard
          accent="growth"
          size="md"
          label="Top Customer"
          value={topCustomer?.customerName ?? "—"}
          sublabel={topCustomer ? formatCompact(topCustomer.revenue) : undefined}
        />
        {!selectedPrincipalKey ? (
          <KpiCard
            accent="mission"
            size="md"
            label="Top Brand"
            value={topBrand?.principal ?? "—"}
            sublabel={topBrand ? formatCompact(topBrand.revenue) : undefined}
          />
        ) : (
          <KpiCard accent="coverage" label="Customers Tracked" value={<AnimatedValue value={customers.length} format={formatNumber} />} />
        )}
      </KpiGrid>

      <ChartGrid>
        <SectionCard title={selectedPrincipalKey ? "Customer Revenue Share" : "Brand / Principal Revenue Share"}>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={doughnutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={105} paddingAngle={2}>
                {doughnutData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-strong)" }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Top 10 Customers by Revenue">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={topCustomersChart} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={70} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              <Bar dataKey="value" fill="var(--primary-blue)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Customer Scorecard">
        <TableWrap>
          <Thead>
            <Th>Customer</Th>
            <Th align="right">Volume</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Gross Profit</Th>
            <Th align="center">Margin</Th>
          </Thead>
          <tbody>
            {customers.slice(0, 30).map((c) => (
              <tr key={c.customerName}>
                <Td>{c.customerName}</Td>
                <Td align="right">{formatNumber(c.volume)}</Td>
                <Td align="right">{formatCompact(c.revenue)}</Td>
                <Td align="right">{formatCompact(c.grossProfit)}</Td>
                <Td align="center">
                  <Badge tier={marginTier(c.grossMarginPct)}>{formatPercent(c.grossMarginPct)}</Badge>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">{formatNumber(totalVolume)}</Td>
              <Td align="right">{formatCompact(totalRevenue)}</Td>
              <Td align="right">{formatCompact(totalGP)}</Td>
              <Td align="center">
                <Badge tier={marginTier(overallMarginPct)}>{formatPercent(overallMarginPct)}</Badge>
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
