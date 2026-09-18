"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { formatCompact, formatNumber } from "@/lib/format";
import { aggregateStockByPrincipal, classifyDormantPrincipals, sumStockRollups } from "@/lib/stock";
import { normalizePrincipalKey } from "@/lib/normalize";
import { computeOverstock, computeOverstockByPrincipal, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/executiveSummary";
import type { Dataset } from "@/lib/types";

const WORST_PRINCIPALS_LIMIT = 5;

export function StockRiskPanel({ dataset, selectedPrincipalKey }: { dataset: Dataset; selectedPrincipalKey: string | null }) {
  // Stock has no period dimension (it's a point-in-time snapshot, not a
  // monthly time series like Sales), and its rows key by normalized brand,
  // not the raw Principal/location label the global filter carries — same
  // normalization StockView.tsx applies before any Stock lookup.
  const normalizedKey = selectedPrincipalKey ? normalizePrincipalKey(selectedPrincipalKey) : null;

  const allRollups = aggregateStockByPrincipal(dataset);
  const { dormantKeys } = classifyDormantPrincipals(dataset, allRollups.map((r) => r.key));
  const activeRollups = allRollups.filter((r) => !dormantKeys.has(r.key));

  const scopedRollups = normalizedKey ? activeRollups.filter((r) => r.key === normalizedKey) : activeRollups;
  const total = sumStockRollups(scopedRollups);
  const overstock = computeOverstock(dataset, normalizedKey);

  const worstPrincipals = [...activeRollups]
    .filter((r) => r.outOfStockCount + r.runningOutCount > 0)
    .sort((a, b) => b.outOfStockCount + b.runningOutCount - (a.outOfStockCount + a.runningOutCount))
    .slice(0, WORST_PRINCIPALS_LIMIT);
  const overstockByPrincipal = computeOverstockByPrincipal(dataset).slice(0, WORST_PRINCIPALS_LIMIT);

  return (
    <SectionCard title="Stock Risk" accent="amber">
      <div className="flex flex-col gap-4">
        <KpiGrid>
          <KpiCard accent="revenue" label="Stock Value" value={formatCompact(total.value)} />
          <KpiCard accent="growth" label="Out of Stock" value={formatNumber(total.outOfStockCount)} />
          <KpiCard accent="growth" label="Running Out" value={formatNumber(total.runningOutCount)} />
          <KpiCard
            accent="quarter"
            label="Overstocked"
            value={formatNumber(overstock.itemCount)}
            sublabel={`${formatCompact(overstock.value)} tied up · cover > ${OVERSTOCK_DAYS_THRESHOLD}d`}
          />
        </KpiGrid>

        {!normalizedKey && (worstPrincipals.length > 0 || overstockByPrincipal.length > 0) ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {worstPrincipals.length > 0 ? (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Most at risk</h4>
                <TableWrap>
                  <Thead>
                    <Th>Principal</Th>
                    <Th align="right">Out of Stock</Th>
                    <Th align="right">Running Out</Th>
                  </Thead>
                  <tbody>
                    {worstPrincipals.map((r) => (
                      <tr key={r.key}>
                        <Td>{r.name}</Td>
                        <Td align="right">{formatNumber(r.outOfStockCount)}</Td>
                        <Td align="right">{formatNumber(r.runningOutCount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            ) : null}
            {overstockByPrincipal.length > 0 ? (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Most overstocked</h4>
                <TableWrap>
                  <Thead>
                    <Th>Principal</Th>
                    <Th align="right">Items</Th>
                    <Th align="right">Value</Th>
                  </Thead>
                  <tbody>
                    {overstockByPrincipal.map((r) => (
                      <tr key={r.key}>
                        <Td>{r.name}</Td>
                        <Td align="right">{formatNumber(r.itemCount)}</Td>
                        <Td align="right">{formatCompact(r.value)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
