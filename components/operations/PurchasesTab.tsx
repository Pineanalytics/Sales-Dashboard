"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { TOP_5_STOCK_PRINCIPALS } from "@/lib/operationsStock";

/** No Purchase Order / Goods Receipt / supplier data exists anywhere in this
 *  app's SAP integration today — confirmed by direct search of the schema
 *  and every scripts/db-bridge/ query: the system tracks stock on-hand and
 *  outbound sales demand, never inbound supply. This tab is a placeholder
 *  shell, ready to wire up once a real purchases data source exists. */
export function PurchasesTab() {
  return (
    <div id="purchases" className="@container flex flex-col gap-4">
      <SectionCard title="Purchases per principal" accent="navy">
        <p className="text-sm text-muted">
          Purchases data (Purchase Orders / Goods Receipts / supplier deliveries) is not yet integrated from SAP —
          the current feed only carries stock on-hand and outbound sales demand. This tab is ready to populate once
          that data source is built.
        </p>
      </SectionCard>
      <SectionCard title="By principal" accent="navy">
        <TableWrap>
          <Thead><Th>Principal</Th><Th align="right">Purchases (value)</Th><Th align="right">Purchases (volume)</Th></Thead>
          <tbody>
            {TOP_5_STOCK_PRINCIPALS.map((principal) => (
              <tr key={principal}>
                <Td>{principal}</Td>
                <Td align="right">—</Td>
                <Td align="right">—</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
