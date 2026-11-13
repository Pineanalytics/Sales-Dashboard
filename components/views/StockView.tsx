"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, stockActionTier, tierBarColor } from "@/lib/format";
import { aggregateStockByPrincipal, classifyDormantPrincipals, isOverstocked, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/stock";
import {
  STOCK_STATUS_TABS,
  isStockStatusFilter,
  matchesStockStatus,
  searchStockItems,
  stockStatusCounts,
  summarizeStockItems,
  summarizeStockItemsByPrincipal,
  type StockStatusFilter,
} from "@/lib/stockItemView";
import { normalizePrincipalKey } from "@/lib/normalize";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const ITEM_PAGE_SIZE = 100;

const STATUS_DESCRIPTIONS: Record<StockStatusFilter, string> = {
  all: "every active SKU",
  runningOut: "SKUs with less cover than their reorder days",
  outOfStock: "SKUs with no stock, or under 2 days of cover",
  overstocked: `SKUs with more cover than their overstock days (default ${OVERSTOCK_DAYS_THRESHOLD})`,
  noData: "SKUs with no sales to work out cover from",
};

/** Stock Balance, at SKU level. The status chips (and ?status= deep links from
 *  the Executive Summary) filter the SKUs themselves, and every figure, the
 *  chart and both tables describe exactly the SKUs listed, for the selected
 *  principal(s) or all active principals. Brands are not used: SAP's brand
 *  field is mostly the manufacturer, so a brand rollup was misleading. */
export function StockView({ dataset, selectedPrincipalKey }: ViewProps) {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status");
  const [statusFilter, setStatusFilter] = useState<StockStatusFilter>(isStockStatusFilter(initialStatus) ? initialStatus : "all");
  const [query, setQuery] = useState("");
  const [itemLimit, setItemLimit] = useState(ITEM_PAGE_SIZE);

  const allRollups = aggregateStockByPrincipal(dataset);
  // Principals with no Sales revenue in the most recent three months move to
  // Dormant Stock instead of cluttering operational Stock Balance — except a
  // handful of newly onboarded/"emerging" principals (see
  // classifyDormantPrincipals's own doc comment).
  const { dormantKeys, flaggedKeys, noticeKeys } = classifyDormantPrincipals(dataset, allRollups.map((r) => r.key));
  const rollups = allRollups.filter((r) => !dormantKeys.has(r.key));
  const dormantRollups = allRollups.filter((r) => dormantKeys.has(r.key));
  const noticeRollups = rollups.filter((r) => noticeKeys.has(r.key));

  // selectedPrincipalKey is the raw Principal string (e.g. "EABL-Nyeri"); stock keys by normalized brand key.
  const normalizedSelectedKey = selectedPrincipalKey ? normalizePrincipalKey(selectedPrincipalKey) : null;
  const selectedRollup = normalizedSelectedKey ? rollups.find((r) => r.key === normalizedSelectedKey) ?? null : null;
  const selectedIsDormant = normalizedSelectedKey !== null && dormantKeys.has(normalizedSelectedKey);
  const selectedDormantRollup = selectedIsDormant ? dormantRollups.find((r) => r.key === normalizedSelectedKey) ?? null : null;

  // The SKUs in scope: the selected principal's, else every active principal's (the dataset is already narrowed to a multi-principal selection).
  const scopeItems = dataset.stockItems.filter((item) => !dormantKeys.has(item.key) && (!normalizedSelectedKey || item.key === normalizedSelectedKey));
  const counts = stockStatusCounts(scopeItems);
  const statusItems = scopeItems.filter((item) => matchesStockStatus(item, statusFilter)).sort((a, b) => b.openingValue - a.openingValue);
  const listedItems = searchStockItems(statusItems, query);
  const summary = summarizeStockItems(listedItems);
  const principalRows = selectedRollup ? [] : summarizeStockItemsByPrincipal(listedItems);
  const scopeLabel = selectedRollup ? selectedRollup.name : "all active principals";
  const statusLabel = STOCK_STATUS_TABS.find((tab) => tab.key === statusFilter)?.label ?? "All Stock";

  const chartData = listedItems.slice(0, 18).map((item) => ({
    name: item.item.length > 22 ? `${item.item.slice(0, 21)}…` : item.item,
    value: item.openingValue,
    fill: tierBarColor[stockActionTier(item.action).tier],
  }));

  function chooseStatus(next: StockStatusFilter) {
    setStatusFilter(next);
    setItemLimit(ITEM_PAGE_SIZE);
  }

  if (selectedIsDormant) {
    return (
      <div className="flex flex-col gap-6">
        <SectionCard title={`${selectedDormantRollup?.name ?? "This principal"} is a dormant principal`}>
          <p className="p-1 text-sm text-muted">
            {normalizedSelectedKey !== null && flaggedKeys.has(normalizedSelectedKey) ? "It is marked as a stopped principal still holding stock" : "It has had no Sales revenue in the last three months"}, so its stock has moved out of operational Stock Balance.
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
          <p className="p-1 text-sm text-muted">Operational stock from SAP as at {new Date(dataset.stockSource.sourceDate).toLocaleDateString()}. {formatNumber(dataset.stockSource.itemCount)} active items are shown; dormant zero-piece items with no sales in three months are in the Dormant OOS module. Stock with no movement in three months is dormant too. Cover and status are worked out per SKU from the standard run rate (the median of the 4-week, 13-week and year-to-date run rates), so a one-off spike or slump does not mark sufficient stock as out or running out.
          {(dataset.emptiesStockItems?.length ?? 0) > 0 && (
            <> Returnable empties ({formatNumber(dataset.emptiesStockItems?.length ?? 0)} SKUs, {formatCompact((dataset.emptiesStockItems ?? []).reduce((sum, item) => sum + item.openingValue, 0))}) are packaging, not product, and are excluded from these figures.</>
          )}
        </p>
        </SectionCard>
      )}
      {noticeRollups.length > 0 && (!selectedRollup || noticeKeys.has(selectedRollup.key)) && (
        <SectionCard title="Active principals with no recent sales">
          <p className="p-1 text-sm text-muted">
            {(selectedRollup ? [selectedRollup] : noticeRollups).map((r) => r.name).sort().join(", ")} {(selectedRollup ? 1 : noticeRollups.length) === 1 ? "is" : "are"} on the Active principals list but{" "}
            {(selectedRollup ? 1 : noticeRollups.length) === 1 ? "has" : "have"} had no Sales revenue in the last three months, so {(selectedRollup ? 1 : noticeRollups.length) === 1 ? "its" : "their"} stock is not moving. {(selectedRollup ? 1 : noticeRollups.length) === 1 ? "It stays" : "They stay"} in the Stock Balance as active
            principals, but with no recent sales the cover and status shown for {(selectedRollup ? 1 : noticeRollups.length) === 1 ? "it" : "them"} should be read with that in mind.
          </p>
        </SectionCard>
      )}
      {!selectedRollup && dormantRollups.length > 0 && (
        <SectionCard title="Dormant principals excluded" action={<Link href="/dormant-stock" className="text-xs font-semibold text-primary-blue hover:underline">Open Dormant Stock →</Link>}>
          <p className="p-1 text-sm text-muted">
            {dormantRollups.length} dormant principal{dormantRollups.length === 1 ? "" : "s"}, either marked as stopped principals still holding stock or with no Sales revenue in the last three months (
            {dormantRollups.map((r) => r.name).sort().join(", ")}), {dormantRollups.length === 1 ? "is" : "are"} excluded from the figures below and shown in Dormant Stock instead.
          </p>
        </SectionCard>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-fit flex-wrap rounded-full bg-background-elevated p-0.5" role="tablist" aria-label="Stock status">
          {STOCK_STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={statusFilter === tab.key}
              onClick={() => chooseStatus(tab.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-300 ${
                statusFilter === tab.key ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"
              }`}
            >
              {tab.label} <span className={statusFilter === tab.key ? "text-white/80" : "text-muted"}>({formatNumber(counts[tab.key])})</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">
          {statusLabel}: {STATUS_DESCRIPTIONS[statusFilter]} · {scopeLabel}
        </span>
      </div>

      <KpiGrid>
        <KpiCard accent="revenue" label="Stock Value" value={<AnimatedValue value={summary.value} format={formatCompact} />} />
        <KpiCard accent="quarter" label="SKUs" value={<AnimatedValue value={summary.itemCount} format={formatNumber} />} />
        <KpiCard accent="quarter" label="Days Cover" value={<AnimatedValue value={summary.daysCover} format={(n) => n.toFixed(1)} />} />
        <KpiCard accent="revenue" label="Standard Stock" value={<AnimatedValue value={summary.standardValue} format={formatCompact} />} />
        <KpiCard accent="growth" label="vs Standard" value={summary.vsStandardPct === null ? "—" : `${summary.vsStandardPct.toFixed(0)}%`} />
        <KpiCard accent="growth" label="Weekly Run Rate" value={<AnimatedValue value={summary.rrWeekValue} format={formatCompact} />} />
        <KpiCard accent="growth" size="md" label="Status" value={statusFilter === "overstocked" && summary.itemCount > 0 ? "Overstocked" : stockActionTier(summary.action).label} />
      </KpiGrid>

      <SectionCard title={`Top SKUs by Stock Value — ${statusLabel}, ${scopeLabel}`}>
        {chartData.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted">No SKUs match this status{query ? " and search" : ""}.</p>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 44 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={10} interval={0} angle={-40} textAnchor="end" height={90} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(v) => formatCompact(v)} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatCompact(Number(v))} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <SectionCard
        title={`Stock by Item — ${statusLabel} (${formatNumber(listedItems.length)} SKU${listedItems.length === 1 ? "" : "s"}, ${scopeLabel})`}
        action={
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setItemLimit(ITEM_PAGE_SIZE);
              }}
              placeholder="Search item, code or principal"
              aria-label="Search items"
              className="w-56 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
            />
          </div>
        }
      >
        <TableWrap>
          <Thead>
            <Th>Item</Th>
            {!selectedRollup && <Th>Principal</Th>}
            <Th align="right">Stock Value</Th>
            <Th align="right">Pcs</Th>
            <Th align="right">RR/Week</Th>
            <Th align="right">Days Cover</Th>
            <Th align="right">Cover Days (R · T · O)</Th>
            <Th align="right">Standard Stock</Th>
            <Th align="center">Status</Th>
          </Thead>
          <tbody>
            {listedItems.slice(0, itemLimit).map((item, idx) => (
              <tr key={`${item.key}-${item.itemCode ?? item.item}-${idx}`}>
                <Td className="max-w-[300px]" title={item.item}>
                  <span className="block truncate font-medium text-brand-navy">{item.item}</span>
                  {item.itemCode ? <span className="block text-[11px] text-muted">{item.itemCode}</span> : null}
                </Td>
                {!selectedRollup && <Td>{item.principal}</Td>}
                <Td align="right">{formatCompact(item.openingValue)}</Td>
                <Td align="right">{formatNumber(item.openingPcs)}</Td>
                <Td align="right">{formatCompact(item.rrWeekValue)}</Td>
                <Td align="right">{item.rrWeekValue > 0 ? item.daysCover.toFixed(1) : "—"}</Td>
                <Td align="right" className="whitespace-nowrap text-muted-strong" title="Reorder · Target · Overstock days in force for this SKU">
                  {item.reorderDays ?? "—"} · {item.targetDays ?? "—"} · {item.overstockDays ?? OVERSTOCK_DAYS_THRESHOLD}
                </Td>
                <Td align="right">{item.standardValue !== undefined ? formatCompact(item.standardValue) : "—"}</Td>
                <Td align="center">
                  {/* Overstock is excess cover, a separate axis from the shortage action, so it replaces a plain "OK". */}
                  {isOverstocked(item, OVERSTOCK_DAYS_THRESHOLD) && !item.action.includes("🔴") && !item.action.includes("🟡") ? <Badge tier="warn">Overstocked</Badge> : <StockStatusPill action={item.action} />}
                </Td>
              </tr>
            ))}
            {listedItems.length === 0 ? (
              <tr>
                <td colSpan={selectedRollup ? 8 : 9} className="px-3 py-8 text-center text-muted">
                  No SKUs match this status{query ? " and search" : ""} for {scopeLabel}.
                </td>
              </tr>
            ) : (
              <TotalRow>
                <Td>Total ({formatNumber(listedItems.length)} SKUs)</Td>
                {!selectedRollup && <Td>{null}</Td>}
                <Td align="right">{formatCompact(summary.value)}</Td>
                <Td align="right">{formatNumber(summary.pcs)}</Td>
                <Td align="right">{formatCompact(summary.rrWeekValue)}</Td>
                <Td align="right">{summary.daysCover.toFixed(1)}</Td>
                <Td align="right">—</Td>
                <Td align="right">{formatCompact(summary.standardValue)}</Td>
                <Td align="center"><StockStatusPill action={summary.action} /></Td>
              </TotalRow>
            )}
          </tbody>
        </TableWrap>
        {listedItems.length > itemLimit ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>Showing {formatNumber(itemLimit)} of {formatNumber(listedItems.length)} SKUs, largest stock value first.</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => setItemLimit((n) => n + ITEM_PAGE_SIZE)} className="rounded-full border border-border px-3 py-1.5 font-semibold text-primary-blue hover:bg-accent-blue-soft">
                Show {formatNumber(Math.min(ITEM_PAGE_SIZE, listedItems.length - itemLimit))} more
              </button>
              <button type="button" onClick={() => setItemLimit(listedItems.length)} className="rounded-full border border-border px-3 py-1.5 font-semibold text-primary-blue hover:bg-accent-blue-soft">
                Show all
              </button>
            </span>
          </div>
        ) : null}
      </SectionCard>

      {!selectedRollup && principalRows.length > 0 ? (
        <SectionCard title={`Stock by Principal — ${statusLabel}`} action={<span className="text-xs text-muted">Summed from the SKUs listed above</span>}>
          <TableWrap>
            <Thead>
              <Th>Principal</Th>
              <Th align="right">SKUs</Th>
              <Th align="right">Stock Value</Th>
              <Th align="right">Days Cover</Th>
              <Th align="right">Standard Stock</Th>
              <Th align="right">vs Standard</Th>
              <Th align="right">Out of Stock</Th>
              <Th align="right">Running Out</Th>
              <Th align="right">Overstocked</Th>
              <Th align="right">No Sales Data</Th>
              <Th align="center">Status</Th>
            </Thead>
            <tbody>
              {principalRows.map((row) => (
                <tr key={row.key}>
                  <Td className="font-medium">{row.principal}</Td>
                  <Td align="right">{formatNumber(row.itemCount)}</Td>
                  <Td align="right">{formatCompact(row.value)}</Td>
                  <Td align="right">{row.daysCover.toFixed(1)}</Td>
                  <Td align="right">{formatCompact(row.standardValue)}</Td>
                  <Td align="right">{row.vsStandardPct === null ? "—" : `${row.vsStandardPct.toFixed(0)}%`}</Td>
                  <Td align="right">{formatNumber(row.outOfStockCount)}</Td>
                  <Td align="right">{formatNumber(row.runningOutCount)}</Td>
                  <Td align="right">{formatNumber(row.overstockedCount)}</Td>
                  <Td align="right">{formatNumber(row.noDataCount)}</Td>
                  <Td align="center"><StockStatusPill action={row.action} /></Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatNumber(summary.itemCount)}</Td>
                <Td align="right">{formatCompact(summary.value)}</Td>
                <Td align="right">{summary.daysCover.toFixed(1)}</Td>
                <Td align="right">{formatCompact(summary.standardValue)}</Td>
                <Td align="right">{summary.vsStandardPct === null ? "—" : `${summary.vsStandardPct.toFixed(0)}%`}</Td>
                <Td align="right">{formatNumber(summary.outOfStockCount)}</Td>
                <Td align="right">{formatNumber(summary.runningOutCount)}</Td>
                <Td align="right">{formatNumber(summary.overstockedCount)}</Td>
                <Td align="right">{formatNumber(summary.noDataCount)}</Td>
                <Td align="center"><StockStatusPill action={summary.action} /></Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </SectionCard>
      ) : null}
    </div>
  );
}
