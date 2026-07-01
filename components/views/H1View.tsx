"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AchievementBadge } from "@/components/ui/Badge";
import { AchievementGauge } from "@/components/ui/AchievementGauge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { SignedCompact } from "@/components/ui/TrendValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact } from "@/lib/format";
import { principalsByMtdRevDesc } from "@/lib/selectors";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

export function H1View({ dataset, principal }: ViewProps) {
  const principals = principalsByMtdRevDesc(dataset);

  const surplusTotal = dataset.principals.filter((p) => p.balMonth > 0).reduce((s, p) => s + p.balMonth, 0);
  const shortfallTotal = dataset.principals.filter((p) => p.balMonth < 0).reduce((s, p) => s + Math.abs(p.balMonth), 0);
  const h1GapToMission = dataset.totals.h1Mission - dataset.totals.h1Sales;
  const h2Required = Math.max(0, dataset.totals.fullTarget - dataset.totals.ytdRev);

  const chartData = principal
    ? [{ name: principal.name.split("-")[0], value: principal.balMonth }]
    : principals.map((p) => ({ name: p.name.split("-")[0], value: p.balMonth }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        {principal ? (
          <>
            <KpiCard
              accent="growth"
              label="Balance of Month"
              value={<AnimatedValue value={principal.balMonth} format={formatCompact} />}
              sublabel={<SignedCompact value={principal.balMonth} />}
            />
            <KpiCard
              accent="growth"
              label="H1 Variance"
              value={<AnimatedValue value={principal.h1Variance} format={formatCompact} />}
              sublabel={<SignedCompact value={principal.h1Variance} />}
            />
            <KpiCard accent="mission" label="MTD Achievement" value={<AchievementGauge pct={principal.achMTD} />} />
            <KpiCard
              accent="growth"
              label="YTD Gap"
              value={<AnimatedValue value={principal.fullTarget - principal.ytdRev} format={formatCompact} />}
            />
          </>
        ) : (
          <>
            <KpiCard accent="mission" label="H1 Gap to Mission" value={<AnimatedValue value={h1GapToMission} format={formatCompact} />} />
            <KpiCard
              accent="growth"
              label="Total MTD Balance"
              value={<AnimatedValue value={dataset.totals.balMonth} format={formatCompact} />}
              sublabel={<SignedCompact value={dataset.totals.balMonth} />}
            />
            <KpiCard accent="growth" label="MTD Surpluses Total" value={<AnimatedValue value={surplusTotal} format={formatCompact} />} />
            <KpiCard accent="growth" label="MTD Shortfalls Total" value={<AnimatedValue value={shortfallTotal} format={formatCompact} />} />
            <KpiCard accent="mission" label="H2 Required" value={<AnimatedValue value={h2Required} format={formatCompact} />} />
            <KpiCard accent="mission" label="H1 Achievement %" value={<AchievementGauge pct={dataset.totals.h1Achieved} />} />
          </>
        )}
      </KpiGrid>

      <SectionCard title={principal ? `${principal.name} — Balance of Month` : "Balance of Month by Principal"}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
            <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 4" />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.value >= 0 ? "var(--accent-green)" : "var(--accent-red)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="H1 Balances">
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">MTD Rev</Th>
            <Th align="right">MTD Target</Th>
            <Th align="center">MTD Achievement</Th>
            <Th align="right">Balance</Th>
            <Th align="right">H1 Sales</Th>
            <Th align="right">H1 Mission</Th>
            <Th align="center">H1 Achievement</Th>
            <Th align="right">H1 Variance</Th>
          </Thead>
          <tbody>
            {(principal ? [principal] : principals).map((p) => (
              <tr key={p.name} className={principal?.name === p.name ? "bg-accent-blue-soft" : ""}>
                <Td>{p.name}</Td>
                <Td align="right">{formatCompact(p.mtdRev)}</Td>
                <Td align="right">{formatCompact(p.mtdTarget)}</Td>
                <Td align="center">
                  <AchievementBadge pct={p.achMTD} />
                </Td>
                <Td align="right">
                  <SignedCompact value={p.balMonth} />
                </Td>
                <Td align="right">{formatCompact(p.h1Sales)}</Td>
                <Td align="right">{formatCompact(p.h1Mission)}</Td>
                <Td align="center">
                  <AchievementBadge pct={p.h1Achieved} />
                </Td>
                <Td align="right">
                  <SignedCompact value={p.h1Variance} />
                </Td>
              </tr>
            ))}
            {!principal ? (
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatCompact(dataset.totals.mtdRev)}</Td>
                <Td align="right">{formatCompact(dataset.totals.mtdTarget)}</Td>
                <Td align="center">
                  <AchievementBadge pct={dataset.totals.achMTD} />
                </Td>
                <Td align="right">
                  <SignedCompact value={dataset.totals.balMonth} />
                </Td>
                <Td align="right">{formatCompact(dataset.totals.h1Sales)}</Td>
                <Td align="right">{formatCompact(dataset.totals.h1Mission)}</Td>
                <Td align="center">
                  <AchievementBadge pct={dataset.totals.h1Achieved} />
                </Td>
                <Td align="right">
                  <SignedCompact value={dataset.totals.h1Variance} />
                </Td>
              </TotalRow>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
