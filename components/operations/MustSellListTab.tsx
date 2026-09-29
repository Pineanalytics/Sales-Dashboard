"use client";

import { useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { formatCompact, formatNumber } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import { aggregateStockByPrincipal } from "@/lib/stock";
import { TOP_5_STOCK_PRINCIPALS, getStockRecommendation } from "@/lib/operationsStock";
import type { Dataset } from "@/lib/types";

/** Must-Sell List: the same fixed top-5 principal set used across the
 *  dashboard's other "top 5" reporting (Finance's Sales Performance tab),
 *  here read as opening balance + risk status + a plain-language stocking
 *  recommendation — stock rollups are already keyed by normalized brand
 *  (StockItem.key), so no location-split re-grouping is needed like on the
 *  sales side. Selecting a principal drills into its own items, same
 *  click-to-expand convention as ReceivablesView's Customer Credit
 *  Exposure "Drill down" button. */
export function MustSellListTab({ dataset }: { dataset: Dataset }) {
  const rollups = aggregateStockByPrincipal(dataset);
  const rows = TOP_5_STOCK_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rollup = rollups.find((r) => r.key === key) ?? null;
    return { label, key, rollup, recommendation: getStockRecommendation(rollup) };
  });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = rows.find((r) => r.key === selectedKey) ?? null;
  const selectedItems = selected
    ? [...dataset.stockItems.filter((i) => i.key === selected.key)].sort((a, b) => b.openingValue - a.openingValue)
    : [];

  return (
    <div id="must-sell-list" className="@container flex flex-col gap-4">
      <SectionCard title="Must-Sell List — Top 5 Principals" accent="purple" action={<span className="text-xs text-muted">Mars, Suntory, Upfield, Eabl, Weetabix</span>}>
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Opening Value</Th>
            <Th align="right">Opening Volume</Th>
            <Th align="center">Risk Status</Th>
            <Th>Recommendation</Th>
            <Th align="right">Detail</Th>
          </Thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={selectedKey === r.key ? "bg-accent-blue-soft" : ""}>
                <Td>{r.label}</Td>
                <Td align="right">{r.rollup ? formatCompact(r.rollup.value) : "—"}</Td>
                <Td align="right">{r.rollup ? formatNumber(r.rollup.volume) : "—"}</Td>
                <Td align="center">{r.rollup ? <StockStatusPill action={r.rollup.action} /> : <StockStatusPill action={null} />}</Td>
                <Td>{r.recommendation}</Td>
                <Td align="right">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(selectedKey === r.key ? null : r.key)}
                    className="text-xs font-semibold text-secondary-blue hover:text-primary-blue"
                    disabled={!r.rollup}
                  >
                    {selectedKey === r.key ? "Hide items" : r.rollup ? "View items →" : "No items"}
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      {selected ? (
        <SectionCard title={`${selected.label} — Item Detail (top ${Math.min(80, selectedItems.length)} of ${selectedItems.length})`} accent="navy">
          <TableWrap>
            <Thead>
              <Th>Item</Th>
              <Th>Brand</Th>
              <Th align="right">Stock Value</Th>
              <Th align="right">Volume</Th>
              <Th align="right">Days Cover</Th>
              <Th align="center">Status</Th>
            </Thead>
            <tbody>
              {selectedItems.slice(0, 80).map((i, idx) => (
                <tr key={`${i.item}-${idx}`}>
                  <Td className="max-w-[220px] truncate" title={i.item}>{i.item}</Td>
                  <Td>{i.brand?.trim() || "Unspecified"}</Td>
                  <Td align="right">{formatCompact(i.openingValue)}</Td>
                  <Td align="right">{formatNumber(i.openingVolume)}</Td>
                  <Td align="right">{i.daysCover.toFixed(1)}</Td>
                  <Td align="center"><StockStatusPill action={i.action} /></Td>
                </tr>
              ))}
              {selectedItems.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No items for this principal.</td></tr> : null}
            </tbody>
          </TableWrap>
        </SectionCard>
      ) : null}
    </div>
  );
}
