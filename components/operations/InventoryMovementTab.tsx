"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber } from "@/lib/format";
import { aggregateStockByPrincipal, classifyDormantPrincipals, sumStockRollups } from "@/lib/stock";
import type { Dataset } from "@/lib/types";

/** Company-wide + per-principal roll-up of the same opening-balance/run-rate/
 *  days-cover figures Stock Balance already computes per item — "inventory
 *  movement" here means this period's live position (opening value/volume,
 *  weekly run rate, days cover), not a historical trend: the stock feed is a
 *  point-in-time snapshot with no stored month-over-month movement to chart. */
export function InventoryMovementTab({ dataset }: { dataset: Dataset }) {
  const allRollups = aggregateStockByPrincipal(dataset);
  const { dormantKeys } = classifyDormantPrincipals(dataset, allRollups.map((r) => r.key));
  const rollups = allRollups.filter((r) => !dormantKeys.has(r.key)).sort((a, b) => b.value - a.value);
  const total = sumStockRollups(rollups);

  return (
    <div id="inventory-movement" className="@container flex flex-col gap-4">
      <SectionCard title="Inventory movement summary" accent="blue">
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
          <KpiCard accent="revenue" label="Opening Stock Value" value={formatCompact(total.value)} />
          <KpiCard accent="coverage" label="Opening Stock Volume" value={formatCompact(total.volume)} sublabel="Cases" />
          <KpiCard accent="growth" label="Run Rate (weekly)" value={formatCompact(total.rrWeekValue)} />
          <KpiCard accent="mission" label="Days Cover" value={total.daysStock.toFixed(1)} sublabel="Vs 14/60-day thresholds" />
        </div>
      </SectionCard>

      <SectionCard title="By principal" accent="navy" action={<span className="text-xs text-muted">Dormant principals excluded — see Dormant Stock</span>}>
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
            {rollups.map((r) => (
              <tr key={r.key}>
                <Td>{r.name}</Td>
                <Td align="right">{formatCompact(r.value)}</Td>
                <Td align="right">{formatNumber(r.volume)}</Td>
                <Td align="right">{formatCompact(r.rrWeekValue)}</Td>
                <Td align="right">{r.daysStock.toFixed(1)}</Td>
                <Td align="center"><StockStatusPill action={r.action} /></Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">{formatCompact(total.value)}</Td>
              <Td align="right">{formatNumber(total.volume)}</Td>
              <Td align="right">{formatCompact(total.rrWeekValue)}</Td>
              <Td align="right">{total.daysStock.toFixed(1)}</Td>
              <Td align="center">—</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
