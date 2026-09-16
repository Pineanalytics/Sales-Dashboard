"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, stockActionTier, tierBarColor } from "@/lib/format";
import { aggregateStockByPrincipal, aggregateStockByBrand, classifyDormantPrincipals, sumStockRollups } from "@/lib/stock";
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

  const allRollups = aggregateStockByPrincipal(dataset);
  // Principals with no Sales revenue in the most recent three months move to
  // Dormant Stock instead of cluttering operational Stock Balance — except a
  // handful of newly onboarded/"emerging" principals (see
  // classifyDormantPrincipals's own doc comment).
  const { dormantKeys } = classifyDormantPrincipals(dataset, allRollups.map((r) => r.key));
  const rollups = allRollups.filter((r) => !dormantKeys.has(r.key));
  const dormantRollups = allRollups.filter((r) => dormantKeys.has(r.key));
  // The portfolio ("all principals") baseline must exclude dormant stock too —
  // dataset.stockTotal is a raw, unfiltered dataset-wide fact used elsewhere
  // (e.g. Overview) and must keep its own meaning, so this page recomputes
  // its own active-only total instead of reusing it directly.
  const activeStockTotal = sumStockRollups(rollups);

  // selectedPrincipalKey is the raw Principal string (e.g. "EABL-Nyeri") — Stock has no
  // location split in its source sheet, so it always rolls up by normalized brand key.
  const normalizedSelectedKey = selectedPrincipalKey ? normalizePrincipalKey(selectedPrincipalKey) : null;
  const selectedRollup = normalizedSelectedKey ? rollups.find((r) => r.key === normalizedSelectedKey) ?? null : null;
  const selectedIsDormant = normalizedSelectedKey !== null && dormantKeys.has(normalizedSelectedKey);
  const selectedDormantRollup = selectedIsDormant ? dormantRollups.find((r) => r.key === normalizedSelectedKey) ?? null : null;

  const stockValue = selectedRollup ? selectedRollup.value : activeStockTotal.value;
  const daysStock = selectedRollup ? selectedRollup.daysStock : activeStockTotal.daysStock;
  const outOfStockCount = selectedRollup ? selectedRollup.outOfStockCount : activeStockTotal.outOfStockCount;
  const runningOutCount = selectedRollup ? selectedRollup.runningOutCount : activeStockTotal.runningOutCount;
  const noDataCount = selectedRollup ? selectedRollup.noDataCount : activeStockTotal.noDataCount;
  const action = selectedRollup ? selectedRollup.action : activeStockTotal.action;

  const principalItemsAll = selectedRollup
    ? [...dataset.stockItems.filter((i) => i.key === selectedRollup.key)].sort((a, b) => b.openingValue - a.openingValue)
    : [];
  const principalItems = principalItemsAll.filter((i) => matchesStatus(i.action, statusFilter));

  const filteredRollups = rollups.filter((r) => matchesStatus(r.action, statusFilter));

  const brandRollups = [...aggregateStockByBrand(dataset, selectedRollup?.key ?? null)]
    .filter((b) => !dormantKeys.has(b.principalKey))
    .sort((a, b) => b.value - a.value);

  // "Item Count" reflects the active tab's filtered rows — every other KPI stays a
  // portfolio/selected-principal fact from activeStockTotal / selectedRollup, never
  // recomputed from a filtered subset.
  const itemCount =
    statusFilter === "all"
      ? selectedRollup
        ? selectedRollup.itemCount
        : activeStockTotal.itemCount
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

  if (selectedIsDormant) {
    return (
      <div className="flex flex-col gap-6">
        <SectionCard title={`${selectedDormantRollup?.name ?? "This principal"} has no active sales`}>
          <p className="p-1 text-sm text-muted">
            No Sales revenue in the last three months, so its stock has moved out of operational Stock Balance.
            {selectedDormantRollup ? ` ${formatNumber(selectedDormantRollup.itemCount)} item(s) worth ${formatCompact(selectedDormantRollup.value)} remain on hand.` : ""}
            {" "}<Link href="/dormant-stock" className="font-semibold text-primary-blue hover:underline">View it in Dormant Stock →</Link>
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {dataset.stockSource?.kind === "sap-direct" && (
        <SectionCard title="Live SAP Stock" action={<span className="text-xs font-semibold text-emerald-700">Direct feed</span>}>
          <p className="p-1 text-sm text-muted">Operational stock from SAP as at {new Date(dataset.stockSource.sourceDate).toLocaleDateString()}. {formatNumber(dataset.stockSource.itemCount)} active items are shown; dormant zero-piece items with no sales in three months are in the Dormant OOS module.</p>
        </SectionCard>
      )}
      {!selectedRollup && dormantRollups.length > 0 && (
        <SectionCard title="Dormant principals excluded" action={<Link href="/dormant-stock" className="text-xs font-semibold text-primary-blue hover:underline">Open Dormant Stock →</Link>}>
          <p className="p-1 text-sm text-muted">
            {dormantRollups.length} principal{dormantRollups.length === 1 ? "" : "s"} with no Sales revenue in the last three months (
            {dormantRollups.map((r) => r.name).sort().join(", ")}) are excluded from the figures below and shown in Dormant Stock instead.
          </p>
        </SectionCard>
      )}
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

      <SectionCard
        title={selectedRollup ? `${selectedRollup.name} — Stock by Brand` : "Stock by Brand (all principals)"}
        action={<span className="text-xs text-muted">{brandRollups.length} brand{brandRollups.length === 1 ? "" : "s"} · Product Master&apos;s Series field</span>}
      >
        <TableWrap>
          <Thead>
            {!selectedRollup && <Th>Principal</Th>}
            <Th>Brand</Th>
            <Th align="right">Stock Value</Th>
            <Th align="right">Volume</Th>
            <Th align="right">Pcs</Th>
            <Th align="right">Items</Th>
            <Th align="right">Cover Days</Th>
            <Th align="center">Status</Th>
          </Thead>
          <tbody>
            {brandRollups.slice(0, 60).map((b) => (
              <tr key={`${b.principalKey}-${b.brand}`}>
                {!selectedRollup && <Td>{b.principalName}</Td>}
                <Td>{b.brand}</Td>
                <Td align="right">{formatCompact(b.value)}</Td>
                <Td align="right">{formatNumber(b.volume)}</Td>
                <Td align="right">{formatNumber(b.pcs)}</Td>
                <Td align="right">{formatNumber(b.itemCount)}</Td>
                <Td align="right">{b.daysStock.toFixed(1)}</Td>
                <Td align="center"><StockStatusPill action={b.action} /></Td>
              </tr>
            ))}
            {brandRollups.length === 0 && (
              <tr><td colSpan={selectedRollup ? 6 : 7} className="px-3 py-6 text-center text-muted">No stock items in this scope.</td></tr>
            )}
          </tbody>
        </TableWrap>
      </SectionCard>

      {selectedRollup ? (
        <SectionCard title={`${selectedRollup.name} — Item Detail (top ${Math.min(80, principalItems.length)} of ${principalItems.length})`}>
          <TableWrap>
            <Thead>
              <Th>Item</Th>
              <Th>Brand</Th>
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
                  <Td>{i.brand?.trim() || "Unspecified"}</Td>
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
                <Td>{null}</Td>
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
                <Td align="right">{formatCompact(principalTotal ? principalTotal.value : activeStockTotal.value)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.volume : activeStockTotal.volume)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.pcs : activeStockTotal.pcs)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.itemCount : activeStockTotal.itemCount)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.outOfStockCount : activeStockTotal.outOfStockCount)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.runningOutCount : activeStockTotal.runningOutCount)}</Td>
                <Td align="right">{formatNumber(principalTotal ? principalTotal.noDataCount : activeStockTotal.noDataCount)}</Td>
                <Td align="right">{principalTotal ? "—" : activeStockTotal.daysStock.toFixed(1)}</Td>
                <Td align="right">{principalTotal ? "—" : formatCompact(activeStockTotal.rrWeekValue)}</Td>
                <Td align="center">{principalTotal ? "—" : <StockStatusPill action={activeStockTotal.action} />}</Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </SectionCard>
      )}
    </div>
  );
}
