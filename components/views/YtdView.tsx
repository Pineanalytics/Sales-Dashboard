"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import type { ViewProps } from "./types";
import type { Principal } from "@/lib/types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AchievementBadge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { SignedCompact } from "@/components/ui/TrendValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, trendTier } from "@/lib/format";
import { principalsByMtdRevDesc } from "@/lib/selectors";
import {
  CHART_COLORS,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  tooltipContentStyle,
  tooltipLabelStyle,
} from "@/components/charts/theme";

function ytdTarget(p: { ytdRev: number; ytdVariance: number }): number {
  return p.ytdRev - p.ytdVariance;
}

export function YtdView({ dataset, principal }: ViewProps) {
  const principals = principalsByMtdRevDesc(dataset);

  const doughnutData = principal
    ? [
        { name: principal.name, value: principal.ytdRev },
        { name: "Others", value: Math.max(0, dataset.totals.ytdRev - principal.ytdRev) },
      ]
    : [...dataset.principals]
        .sort((a, b) => b.ytdRev - a.ytdRev)
        .map((p) => ({ name: p.name.split("-")[0], value: p.ytdRev }));

  const barData: { name: string; value?: number; target?: number; revenue?: number }[] = principal
    ? [
        { name: "YTD Revenue", value: principal.ytdRev },
        { name: "H1 Sales", value: principal.h1Sales },
        { name: "Full Target", value: principal.fullTarget },
      ]
    : [...dataset.principals]
        .sort((a, b) => ytdTarget(b) - ytdTarget(a))
        .slice(0, 12)
        .map((p) => ({ name: p.name.split("-")[0], target: ytdTarget(p), revenue: p.ytdRev }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        {principal ? (
          <>
            <KpiCard accent="revenue" label="YTD Revenue" value={<AnimatedValue value={principal.ytdRev} format={formatCompact} />} />
            <KpiCard accent="mission" label="YTD Target" value={<AnimatedValue value={ytdTarget(principal)} format={formatCompact} />} />
            <KpiCard accent="revenue" label="H1 Sales" value={<AnimatedValue value={principal.h1Sales} format={formatCompact} />} />
            <KpiCard
              accent="growth"
              label="H1 Variance"
              value={<AnimatedValue value={principal.h1Variance} format={formatCompact} />}
              sublabel={<SignedCompact value={principal.h1Variance} />}
            />
            <KpiCard
              accent="growth"
              label="YTD Gap to Full Target"
              value={<AnimatedValue value={principal.fullTarget - principal.ytdRev} format={formatCompact} />}
            />
            <KpiCard accent="revenue" label="Avg Monthly Sales" value={<AnimatedValue value={principal.avgSales} format={formatCompact} />} />
            <KpiCard accent="quarter" label="Next Month Forecast" value={<AnimatedValue value={principal.nextMonthForecast} format={formatCompact} />} />
            <KpiCard accent="quarter" label="Next Quarter Forecast" value={<AnimatedValue value={principal.nextQuarterForecast} format={formatCompact} />} />
          </>
        ) : (
          <>
            <KpiCard accent="revenue" label="YTD Revenue" value={<AnimatedValue value={dataset.totals.ytdRev} format={formatCompact} />} />
            <KpiCard accent="mission" label="YTD Target" value={<AnimatedValue value={ytdTarget(dataset.totals)} format={formatCompact} />} />
            <KpiCard accent="revenue" label="H1 Sales" value={<AnimatedValue value={dataset.totals.h1Sales} format={formatCompact} />} />
            <KpiCard
              accent="growth"
              label="H1 Variance"
              value={<AnimatedValue value={dataset.totals.h1Variance} format={formatCompact} />}
              sublabel={<SignedCompact value={dataset.totals.h1Variance} />}
            />
            <KpiCard
              accent="growth"
              label="YTD Gap to Full Target"
              value={<AnimatedValue value={dataset.totals.fullTarget - dataset.totals.ytdRev} format={formatCompact} />}
            />
            <KpiCard accent="revenue" label="Avg Monthly Sales" value={<AnimatedValue value={dataset.totals.avgSales} format={formatCompact} />} />
            <KpiCard accent="quarter" label="Next Month Forecast" value={<AnimatedValue value={dataset.totals.nextMonthForecast} format={formatCompact} />} />
            <KpiCard accent="quarter" label="Next Quarter Forecast" value={<AnimatedValue value={dataset.totals.nextQuarterForecast} format={formatCompact} />} />
            <KpiCard
              accent="mission"
              label="H2 Required"
              value={<AnimatedValue value={Math.max(0, dataset.totals.fullTarget - dataset.totals.ytdRev)} format={formatCompact} />}
            />
          </>
        )}
      </KpiGrid>

      <ChartGrid>
        <SectionCard title={principal ? `${principal.name} vs Portfolio` : "YTD Revenue Contribution Share"}>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={doughnutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={105} paddingAngle={2}>
                {doughnutData.map((_, i) => (
                  <Cell key={i} fill={principal && i === 1 ? "var(--accent-grey)" : CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-strong)" }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title={principal ? `${principal.name} — YTD Rev / H1 Sales / Full Target` : "YTD Target vs YTD Revenue (Top 12)"}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              {principal ? (
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {barData.map((_, i) => (
                    <Cell key={i} fill={["var(--accent-blue)", "var(--accent-green)", "var(--accent-purple)"][i]} />
                  ))}
                </Bar>
              ) : (
                <>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="target" name="YTD Target" fill="var(--accent-grey)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="revenue" name="YTD Revenue" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="YTD Scorecard">
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">YTD Revenue</Th>
            <Th align="right">YTD Target</Th>
            <Th align="right">H1 Sales</Th>
            <Th align="right">H1 Mission</Th>
            <Th align="center">H1 Achievement</Th>
            <Th align="right">H1 Variance</Th>
            <Th align="right">Next Month FC</Th>
            <Th align="right">Next Qtr FC</Th>
          </Thead>
          <tbody>
            {(principal ? [principal] : principals).map((p: Principal) => (
              <tr key={p.name} className={principal?.name === p.name ? "bg-accent-blue-soft" : ""}>
                <Td>{p.name}</Td>
                <Td align="right">{formatCompact(p.ytdRev)}</Td>
                <Td align="right">{formatCompact(ytdTarget(p))}</Td>
                <Td align="right">{formatCompact(p.h1Sales)}</Td>
                <Td align="right">{formatCompact(p.h1Mission)}</Td>
                <Td align="center">
                  <AchievementBadge pct={p.h1Achieved} />
                </Td>
                <Td align="right">
                  <span className={trendTier(p.h1Variance) === "bad" ? "text-accent-red" : "text-accent-green"}>
                    {formatCompact(p.h1Variance)}
                  </span>
                </Td>
                <Td align="right">{formatCompact(p.nextMonthForecast)}</Td>
                <Td align="right">{formatCompact(p.nextQuarterForecast)}</Td>
              </tr>
            ))}
            {!principal ? (
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatCompact(dataset.totals.ytdRev)}</Td>
                <Td align="right">{formatCompact(ytdTarget(dataset.totals))}</Td>
                <Td align="right">{formatCompact(dataset.totals.h1Sales)}</Td>
                <Td align="right">{formatCompact(dataset.totals.h1Mission)}</Td>
                <Td align="center">
                  <AchievementBadge pct={dataset.totals.h1Achieved} />
                </Td>
                <Td align="right">{formatCompact(dataset.totals.h1Variance)}</Td>
                <Td align="right">{formatCompact(dataset.totals.nextMonthForecast)}</Td>
                <Td align="right">{formatCompact(dataset.totals.nextQuarterForecast)}</Td>
              </TotalRow>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
