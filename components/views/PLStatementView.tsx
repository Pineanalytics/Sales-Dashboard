"use client";

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatPercent } from "@/lib/format";
import { CANONICAL_MONTHS, summarizePLForPeriod, summarizePLByAccount } from "@/lib/timeIntelligence";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const LINE_TYPE_LABEL = { REVENUE: "Revenue", COGS: "COGS", EXPENSE: "Expense", OTHER_INCOME: "Other Income" } as const;

export function PLStatementView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const summary = summarizePLForPeriod(dataset, period, selectedPrincipalKey);
  const accounts = summarizePLByAccount(dataset, period, selectedPrincipalKey).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const rows = selectedPrincipalKey
    ? dataset.monthlyPL.filter((r) => r.principal === selectedPrincipalKey)
    : dataset.monthlyPL;
  const monthsThisYear = CANONICAL_MONTHS.filter((m) =>
    rows.some((r) => r.year === period.year && r.month === m)
  );

  const chartData = monthsThisYear.map((month) => {
    const s = summarizePLForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey);
    return {
      name: month.slice(0, 3),
      "Total Income": s.totalIncome,
      Expenses: s.expenses,
      "Net Profit": s.netProfit,
    };
  });

  if (dataset.monthlyPL.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <SectionCard title="P&L Statement">
          <p className="text-sm text-muted py-8 text-center">
            No P&amp;L data yet — run <code>npm run pl:sync</code> to pull the latest figures from SAP.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={<AnimatedValue value={summary.revenue} format={formatCompact} />} />
        <KpiCard accent="revenue" label="COGS" value={<AnimatedValue value={summary.cogs} format={formatCompact} />} />
        <KpiCard accent="quarter" label="Gross Profit" value={<AnimatedValue value={summary.grossProfit} format={formatCompact} />} />
        <KpiCard accent="quarter" size="md" label="Other Income" value={<AnimatedValue value={summary.otherIncome} format={formatCompact} />} />
        <KpiCard accent="mission" label="Total Income" value={<AnimatedValue value={summary.totalIncome} format={formatCompact} />} />
        <KpiCard accent="mission" size="md" label="Expenses" value={<AnimatedValue value={summary.expenses} format={formatCompact} />} />
        <KpiCard accent="growth" label="Net Profit" value={<AnimatedValue value={summary.netProfit} format={formatCompact} />} />
        <KpiCard
          accent="growth"
          size="md"
          label="Net Margin %"
          value={summary.netMarginPct !== null ? <AnimatedValue value={summary.netMarginPct} format={formatPercent} /> : "N/A"}
        />
      </KpiGrid>

      <SectionCard title={`Monthly P&L Trend — ${period.year}`}>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Total Income" fill="var(--primary-blue)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="Expenses" fill="var(--accent-red)" radius={[6, 6, 0, 0]} />
            <Line type="monotone" dataKey="Net Profit" stroke="var(--accent-green)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="Account Breakdown">
        <TableWrap>
          <Thead>
            <Th>Account</Th>
            <Th>Type</Th>
            <Th align="right">Amount</Th>
          </Thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={`${a.accountCode}|${a.lineType}`}>
                <Td>
                  {a.accountCode} {a.accountName ? `— ${a.accountName}` : ""}
                </Td>
                <Td>{LINE_TYPE_LABEL[a.lineType]}</Td>
                <Td align="right">{formatCompact(a.amount)}</Td>
              </tr>
            ))}
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted">
                  No P&amp;L rows for this period.
                </td>
              </tr>
            ) : (
              <TotalRow>
                <Td>Net Profit</Td>
                <Td>—</Td>
                <Td align="right">{formatCompact(summary.netProfit)}</Td>
              </TotalRow>
            )}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
