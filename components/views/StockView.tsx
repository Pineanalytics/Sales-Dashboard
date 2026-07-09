"use client";

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, stockActionTier, tierBarColor } from "@/lib/format";
import { aggregateStockByPrincipal } from "@/lib/stock";
import { normalizePrincipalKey } from "@/lib/normalize";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

type StatusFilter = "all" | "runningOut" | "outOfStock" | "noData";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All Stock" },
  { key: "runningOut", label: "Running Out" },
  { key: "outOfStock", label: "Out of Stock" },
  { key: "noData", label: "No Sales Data" },
];

// Same emoji-marker convention lib/format.ts's stockActionTier already uses —
// filters which already-computed rows are displayed, never recomputes them.
function matchesStatus(action: string, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "runningOut") return action.includes("🟡");
  if (filter === "outOfStock") return action.includes("🔴");
  // "noData": neither Out of Stock, Running Out, nor OK
  return !action.includes("🔴") && !action.includes("🟡") && !action.includes("🟢");
}

export function StockView({ dataset, selectedPrincipalKey }: ViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const rollups = aggregateStockByPrincipal(dataset);
  // selectedPrincipalKey is the raw Principal string (e.g. "EABL-Nyeri") — Stock has no
  // location split in its source sheet, so it always rolls up by normalized brand key.
  const selectedRollup = selectedPrincipalKey ? rollups.find((r) => r.key === normalizePrincipalKey(selectedPrincipalKey)) ?? null : null;

  const stockValue = selectedRollup ? selectedRollup.value : dataset.stockTotal.value;
  const daysStock = selectedRollup ? selectedRollup.daysStock : dataset.stockTotal.daysStock;
  const outOfStockCount = selectedRollup ? selectedRollup.outOfStockCount : dataset.stockTotal.outOfStockCount;
  const runningOutCount = selectedRollup ? selectedRollup.runningOutCount : dataset.stockTotal.runningOutCount;
  const noDataCount = selectedRollup ? selectedRollup.noDataCount : dataset.stockTotal.noDataCount;
  const action = selectedRollup ? selectedRollup.action : dataset.stockTotal.action;

  const principalItemsAll = selectedRollup
    ? [...dataset.stockItems.filter((i) => i.key === selectedRollup.key)].sort((a, b) => b.openingValue - a.openingValue)
    : [];
  const principalItems = principalItemsAll.filter((i) => matchesStatus(i.action, statusFilter));

  const filteredRollups = rollups.filter((r) => matchesStatus(r.action, statusFilter));

  // "Item Count" reflects the active tab's filtered rows — every other KPI stays a
  // portfolio/selected-principal fact from dataset.stockTotal / selectedRollup, never
  // recomputed from a filtered subset.
  const itemCount =
    statusFilter === "all"
      ? selectedRollup
        ? selectedRollup.itemCount
        : dataset.stockTotal.itemCount
      : selectedRollup
        ? principalItems.length
        : filteredRollups.reduce((sum, r) => sum + r.itemCount, 0);

  const chartData = selectedRollup
    ? principalItems.slice(0, 15).map((i) => ({ name: i.item.slice(0, 18), value: i.openingValue, fill: tierBarColor[stockActionTier(i.action).tier] }))
    : [...filteredRollups]
        .sort((a, b) => b.value - a.value)
        .slice(0, 18)
        .map((r) => ({ name: r.name, value: r.value, fill: tierBarColor[stockActionTier(r.action).tier] }));

  // A table's own total row should sum only the rows it's actually showing — unlike
  // the KPI cards above (legitimately portfolio-wide facts), a filtered tab's table
  // total must match what's visible in that same table, not the unfiltered whole.
  const itemTotal =
    statusFilter === "all"
      ? null
      : principalItems.reduce(
          (acc, i) => ({
            value: acc.value + i.openingValue,
            volume: acc.volume + i.openingVolume,
            pcs: acc.pcs + i.openingPcs,
          }),
          { value: 0, volume: 0, pcs: 0 }
        );
  const principalTotal =
    statusFilter === "all"
      ? null
      : filteredRollups.reduce(
          (acc, r) => ({
            value: acc.value + r.value,
            volume: acc.volume + r.volume,
            pcs: acc.pcs + r.pcs,
            itemCount: acc.itemCount + r.itemCount,
            outOfStockCount: acc.outOfStockCount + r.outOfStockCount,
            runningOutCount: acc.runningOutCount + r.runningOutCount,
            noDataCount: acc.noDataCount + r.noDataCount,
          }),
          { value: 0, volume: 0, pcs: 0, itemCount: 0, outOfStockCount: 0, runningOutCount: 0, noDataCount: 0 }
        );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap rounded-full bg-background-elevated p-0.5 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-300 ${
              statusFilter === tab.key
                ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                : "text-muted-strong hover:text-primary-blue"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
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
                <Td align="right">{formatCompact(itemTotal ? itemTotal.value : selectedRollup.value)}</Td>
                <Td align="right">{formatNumber(itemTotal ? itemTotal.volume : selectedRollup.volume)}</Td>
                <Td align="right">{formatNumber(itemTotal ? itemTotal.pcs : selectedRollup.pcs)}</Td>
                <Td align="right">{itemTotal ? "—" : selectedRollup.daysStock.toFixed(1)}</Td>
                <Td align="right">{itemTotal ? "—" : formatCompact(selectedRollup.rrWeekValue)}</Td>
                <Td align="center">{itemTotal ? "—" : <StockStatusPill action={selectedRollup.action} />}</Td>
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
              {[...filteredRollups]
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
                <Td align="right">{formatCompact(principalTotal ? principalTotal.value : dataset.stockTotal.value)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.volume : dataset.stockTotal.volume)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.pcs : dataset.stockTotal.pcs)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.itemCount : dataset.stockTotal.itemCount)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.outOfStockCount : dataset.stockTotal.outOfStockCount)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.runningOutCount : dataset.stockTotal.runningOutCount)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.noDataCount : dataset.stockTotal.noDataCount)}</Td>
                <Td align="right">{principalTotal ? "—" : dataset.stockTotal.daysStock.toFixed(1)}</Td>
                <Td align="right">{principalTotal ? "—" : formatCompact(dataset.stockTotal.rrWeekValue)}</Td>
                <Td align="center">{principalTotal ? "—" : <StockStatusPill action={dataset.stockTotal.action} />}</Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </SectionCard>
      )}
    </div>
  );
}
