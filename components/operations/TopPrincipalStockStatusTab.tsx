"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { formatCompact, formatNumber } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import { aggregateStockByPrincipal, isOverstocked, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/stock";
import { TOP_5_STOCK_PRINCIPALS } from "@/lib/operationsStock";
import type { Dataset } from "@/lib/types";

const ITEM_LIST_LIMIT = 40;

export function TopPrincipalStockStatusTab({ dataset }: { dataset: Dataset }) {
  const rollups = aggregateStockByPrincipal(dataset);
  const top5Keys = new Set(TOP_5_STOCK_PRINCIPALS.map(normalizePrincipalKey));
  const rows = TOP_5_STOCK_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    return { label, rollup: rollups.find((r) => r.key === key) ?? null };
  });

  const top5Items = dataset.stockItems.filter((i) => top5Keys.has(i.key));
  const overstocked = top5Items.filter((i) => isOverstocked(i, OVERSTOCK_DAYS_THRESHOLD)).sort((a, b) => b.daysCover - a.daysCover);
  const runningOut = top5Items.filter((i) => i.action.includes("🟡")).sort((a, b) => b.openingValue - a.openingValue);
  const outOfStock = top5Items.filter((i) => i.action.includes("🔴")).sort((a, b) => b.openingValue - a.openingValue);

  return (
    <div id="top-principal-stock-status" className="@container flex flex-col gap-4">
      <SectionCard title="Top 5 principal stock status" accent="purple" action={<span className="text-xs text-muted">Mars, Suntory, Upfield, Eabl, Weetabix</span>}>
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Opening Value</Th>
            <Th align="right">Opening Volume</Th>
            <Th align="right">Run Rate (weekly)</Th>
            <Th align="right">Days Cover</Th>
            <Th align="center">Status</Th>
          </Thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <Td>{r.label}</Td>
                <Td align="right">{r.rollup ? formatCompact(r.rollup.value) : "—"}</Td>
                <Td align="right">{r.rollup ? formatNumber(r.rollup.volume) : "—"}</Td>
                <Td align="right">{r.rollup ? formatCompact(r.rollup.rrWeekValue) : "—"}</Td>
                <Td align="right">{r.rollup ? r.rollup.daysStock.toFixed(1) : "—"}</Td>
                <Td align="center">{r.rollup ? <StockStatusPill action={r.rollup.action} /> : <StockStatusPill action={null} />}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Overstocked items" accent="amber" action={<span className="text-xs text-muted">Over {OVERSTOCK_DAYS_THRESHOLD} days cover · {overstocked.length} item(s)</span>}>
        <TableWrap>
          <Thead><Th>Item</Th><Th>Principal</Th><Th align="right">Stock Value</Th><Th align="right">Days Cover</Th></Thead>
          <tbody>
            {overstocked.slice(0, ITEM_LIST_LIMIT).map((i, idx) => (
              <tr key={`${i.key}-${i.item}-${idx}`}>
                <Td className="max-w-[220px] truncate" title={i.item}>{i.item}</Td>
                <Td>{i.principal}</Td>
                <Td align="right">{formatCompact(i.openingValue)}</Td>
                <Td align="right">{i.daysCover.toFixed(1)}</Td>
              </tr>
            ))}
            {overstocked.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">No overstocked items among these principals.</td></tr> : null}
          </tbody>
        </TableWrap>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Running out" accent="red" action={<span className="text-xs text-muted">{runningOut.length} item(s)</span>}>
          <TableWrap>
            <Thead><Th>Item</Th><Th>Principal</Th><Th align="right">Days Cover</Th></Thead>
            <tbody>
              {runningOut.slice(0, ITEM_LIST_LIMIT).map((i, idx) => (
                <tr key={`${i.key}-${i.item}-${idx}`}>
                  <Td className="max-w-[180px] truncate" title={i.item}>{i.item}</Td>
                  <Td>{i.principal}</Td>
                  <Td align="right">{i.daysCover.toFixed(1)}</Td>
                </tr>
              ))}
              {runningOut.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">None running out.</td></tr> : null}
            </tbody>
          </TableWrap>
        </SectionCard>

        <SectionCard title="Out of stock" accent="red" action={<span className="text-xs text-muted">{outOfStock.length} item(s)</span>}>
          <TableWrap>
            <Thead><Th>Item</Th><Th>Principal</Th><Th align="right">Stock Value</Th></Thead>
            <tbody>
              {outOfStock.slice(0, ITEM_LIST_LIMIT).map((i, idx) => (
                <tr key={`${i.key}-${i.item}-${idx}`}>
                  <Td className="max-w-[180px] truncate" title={i.item}>{i.item}</Td>
                  <Td>{i.principal}</Td>
                  <Td align="right">{formatCompact(i.openingValue)}</Td>
                </tr>
              ))}
              {outOfStock.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">None out of stock.</td></tr> : null}
            </tbody>
          </TableWrap>
        </SectionCard>
      </div>
    </div>
  );
}
