"use client";

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
 *  sales side. */
export function MustSellListTab({ dataset }: { dataset: Dataset }) {
  const rollups = aggregateStockByPrincipal(dataset);
  const rows = TOP_5_STOCK_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rollup = rollups.find((r) => r.key === key) ?? null;
    return { label, rollup, recommendation: getStockRecommendation(rollup) };
  });

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
          </Thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <Td>{r.label}</Td>
                <Td align="right">{r.rollup ? formatCompact(r.rollup.value) : "—"}</Td>
                <Td align="right">{r.rollup ? formatNumber(r.rollup.volume) : "—"}</Td>
                <Td align="center">{r.rollup ? <StockStatusPill action={r.rollup.action} /> : <StockStatusPill action={null} />}</Td>
                <Td>{r.recommendation}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
