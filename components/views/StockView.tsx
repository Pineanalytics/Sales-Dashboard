"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, stockActionTier, tierBarColor } from "@/lib/format";
import { aggregateStockByPrincipal } from "@/lib/stock";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

export function StockView({ dataset, selectedPrincipalKey }: ViewProps) {
  const rollups = aggregateStockByPrincipal(dataset);
  const selectedRollup = selectedPrincipalKey ? rollups.find((r) => r.key === selectedPrincipalKey) ?? null : null;

  const stockValue = selectedRollup ? selectedRollup.value : dataset.stockTotal.value;
  const itemCount = selectedRollup ? selectedRollup.itemCount : dataset.stockTotal.itemCount;
  const daysStock = selectedRollup ? selectedRollup.daysStock : dataset.stockTotal.daysStock;
  const outOfStockCount = selectedRollup ? selectedRollup.outOfStockCount : dataset.stockTotal.outOfStockCount;
  const runningOutCount = selectedRollup ? selectedRollup.runningOutCount : dataset.stockTotal.runningOutCount;
  const noDataCount = selectedRollup ? selectedRollup.noDataCount : dataset.stockTotal.noDataCount;
  const action = selectedRollup ? selectedRollup.action : dataset.stockTotal.action;

  const principalItems = selectedRollup
    ? [...dataset.stockItems.filter((i) => i.key === selectedRollup.key)].sort((a, b) => b.openingValue - a.openingValue)
    : [];

  const chartData = selectedRollup
    ? principalItems.slice(0, 15).map((i) => ({ name: i.item.slice(0, 18), value: i.openingValue, fill: tierBarColor[stockActionTier(i.action).tier] }))
    : [...rollups]
        .sort((a, b) => b.value - a.value)
        .slice(0, 18)
        .map((r) => ({ name: r.name, value: r.value, fill: tierBarColor[stockActionTier(r.action).tier] }));

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard accent="revenue" label="Stock Value" value={<AnimatedValue value={stockValue} format={formatCompact} />} />
        <KpiCard accent="quarter" label="Item Count" value={<AnimatedValue value={itemCount} format={formatNumber} />} />
        <KpiCard accent="quarter" label="Days Cover" value={<AnimatedValue value={daysStock} format={(n) => n.toFixed(1)} />} />
        <KpiCard accent="growth" label="Out of Stock" value={<AnimatedValue value={outOfStockCount} format={formatNumber} />} />
        <KpiCard accent="growth" label="Running Out" value={<AnimatedValue value={runningOutCount} format={formatNumber} />} />
        <KpiCard accent="quarter" label="No Sales Data" value={<AnimatedValue value={noDataCount} format={formatNumber} />} />
        <KpiCard accent="growth" size="md" label="Status" value={stockActionTier(action).label} />
      </KpiGrid>

      <SectionCard title={selectedRollup ? `${selectedRollup.name} — Top Items by Stock Value` : "Stock Value by Principal (Top 18)"}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 44 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} interval={0} angle={-40} textAnchor="end" height={80} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {selectedRollup ? (
        <SectionCard title={`${selectedRollup.name} — Item Detail (top ${Math.min(80, principalItems.length)} of ${principalItems.length})`}>
          <TableWrap>
            <Thead>
              <Th>Item</Th>
              <Th align="right">Stock Value</Th>
              <Th align="right">Volume</Th>
              <Th align="right">Pcs</Th>
              <Th align="right">Days Cover</Th>
              <Th align="right">RR/Week</Th>
              <Th align="center">Status</Th>
            </Thead>
            <tbody>
              {principalItems.slice(0, 80).map((i, idx) => (
                <tr key={`${i.item}-${idx}`}>
                  <Td className="max-w-[220px] truncate" title={i.item}>
                    {i.item}
                  </Td>
                  <Td align="right">{formatCompact(i.openingValue)}</Td>
                  <Td align="right">{formatNumber(i.openingVolume)}</Td>
                  <Td align="right">{formatNumber(i.openingPcs)}</Td>
                  <Td align="right">{i.daysCover.toFixed(1)}</Td>
                  <Td align="right">{formatCompact(i.rrWeekValue)}</Td>
                  <Td align="center">
                    <StockStatusPill action={i.action} />
                  </Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total ({principalItems.length} items)</Td>
                <Td align="right">{formatCompact(selectedRollup.value)}</Td>
                <Td align="right">{formatNumber(selectedRollup.volume)}</Td>
                <Td align="right">{formatNumber(selectedRollup.pcs)}</Td>
                <Td align="right">{selectedRollup.daysStock.toFixed(1)}</Td>
                <Td align="right">{formatCompact(selectedRollup.rrWeekValue)}</Td>
                <Td align="center">
                  <StockStatusPill action={selectedRollup.action} />
                </Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </SectionCard>
      ) : (
        <SectionCard title="Stock by Principal">
          <TableWrap>
            <Thead>
              <Th>Principal</Th>
              <Th align="right">Stock Value</Th>
              <Th align="right">Volume</Th>
              <Th align="right">Pcs</Th>
              <Th align="right">Items</Th>
              <Th align="right">Out of Stock</Th>
              <Th align="right">Running Out</Th>
              <Th align="right">No Data</Th>
              <Th align="right">Cover Days</Th>
              <Th align="right">RR/Week</Th>
              <Th align="center">Status</Th>
            </Thead>
            <tbody>
              {[...rollups]
                .sort((a, b) => b.value - a.value)
                .map((r) => (
                  <tr key={r.key}>
                    <Td>{r.name}</Td>
                    <Td align="right">{formatCompact(r.value)}</Td>
                    <Td align="right">{formatNumber(r.volume)}</Td>
                    <Td align="right">{formatNumber(r.pcs)}</Td>
                    <Td align="right">{formatNumber(r.itemCount)}</Td>
                    <Td align="right">{formatNumber(r.outOfStockCount)}</Td>
                    <Td align="right">{formatNumber(r.runningOutCount)}</Td>
                    <Td align="right">{formatNumber(r.noDataCount)}</Td>
                    <Td align="right">{r.daysStock.toFixed(1)}</Td>
                    <Td align="right">{formatCompact(r.rrWeekValue)}</Td>
                    <Td align="center">
                      <StockStatusPill action={r.action} />
                    </Td>
                  </tr>
                ))}
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatCompact(dataset.stockTotal.value)}</Td>
                <Td align="right">{formatNumber(dataset.stockTotal.volume)}</Td>
                <Td align="right">{formatNumber(dataset.stockTotal.pcs)}</Td>
                <Td align="right">{formatNumber(dataset.stockTotal.itemCount)}</Td>
                <Td align="right">{formatNumber(dataset.stockTotal.outOfStockCount)}</Td>
                <Td align="right">{formatNumber(dataset.stockTotal.runningOutCount)}</Td>
                <Td align="right">{formatNumber(dataset.stockTotal.noDataCount)}</Td>
                <Td align="right">{dataset.stockTotal.daysStock.toFixed(1)}</Td>
                <Td align="right">{formatCompact(dataset.stockTotal.rrWeekValue)}</Td>
                <Td align="center">
                  <StockStatusPill action={dataset.stockTotal.action} />
                </Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </SectionCard>
      )}
    </div>
  );
}
