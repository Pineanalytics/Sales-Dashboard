"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { normalizePrincipalKey } from "@/lib/normalize";
import { formatCompact, formatNumber } from "@/lib/format";
import { aggregateStockByPrincipal, classifyDormantPrincipals } from "@/lib/stock";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { StockStatusPill } from "@/components/ui/StockPill";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullPageSpinner } from "@/components/ui/Spinner";

interface DormantStockItem {
  id: string;
  principal: string;
  item: string;
  itemCode: string;
  openingPcs: number;
  openingValue: number;
  lastSaleDate: string | null;
}

export default function DormantStockPage() {
  const dataset = useDashboardStore((state) => state.dataset);
  const selectedPrincipalKey = useDashboardStore((state) => state.selectedPrincipalKey);
  const [items, setItems] = useState<DormantStockItem[]>([]);
  const [sourceDate, setSourceDate] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dormant-stock", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!cancelled) {
          setItems(body.items);
          setSourceDate(body.sourceDate);
          setStatus("ready");
        }
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  const scopedItems = useMemo(
    () => selectedPrincipalKey ? items.filter((item) => normalizePrincipalKey(item.principal) === selectedPrincipalKey) : items,
    [items, selectedPrincipalKey]
  );
  const totalValue = scopedItems.reduce((total, item) => total + item.openingValue, 0);
  const neverSold = scopedItems.filter((item) => !item.lastSaleDate).length;
  const byPrincipal = useMemo(() => {
    const groups = new Map<string, { principal: string; items: number; value: number; neverSold: number }>();
    for (const item of scopedItems) {
      const group = groups.get(item.principal) ?? { principal: item.principal, items: 0, value: 0, neverSold: 0 };
      group.items++;
      group.value += item.openingValue;
      if (!item.lastSaleDate) group.neverSold++;
      groups.set(item.principal, group);
    }
    return Array.from(groups.values()).sort((a, b) => b.items - a.items || a.principal.localeCompare(b.principal));
  }, [scopedItems]);

  // A different, principal-level notion of "dormant" from the SKU-level list
  // above: a whole principal with no Sales revenue in the last three months
  // (see classifyDormantPrincipals's own doc comment for the shared
  // three-month convention and the emerging-principal exemptions), computed
  // from the same dataset Stock Balance itself reads, not the SAP-direct
  // dormant-SKU feed this page's other section uses.
  const dormantPrincipals = useMemo(() => {
    if (!dataset) return [];
    const rollups = aggregateStockByPrincipal(dataset);
    const { dormantKeys } = classifyDormantPrincipals(dataset, rollups.map((r) => r.key));
    return rollups.filter((r) => dormantKeys.has(r.key)).sort((a, b) => b.value - a.value);
  }, [dataset]);
  const scopedDormantPrincipals = selectedPrincipalKey
    ? dormantPrincipals.filter((r) => r.key === selectedPrincipalKey)
    : dormantPrincipals;

  if (status === "loading") return <FullPageSpinner label="Loading dormant stock…" />;
  if (status === "error") return <EmptyState icon={<Archive20Regular className="h-10 w-10" />} title="Couldn't load dormant stock" description="Try again shortly. The direct SAP stock sync may still be running." />;
  if (items.length === 0 && scopedDormantPrincipals.length === 0) {
    return <EmptyState icon={<Archive20Regular className="h-10 w-10" />} title="Nothing dormant right now" description="Items appear here when their physical stock is zero with no invoice activity in three months, or when a whole principal has had no Sales revenue in three months." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {scopedDormantPrincipals.length > 0 && (
        <SectionCard title="Dormant Principals (No Active Sales)">
          <p className="p-1 text-sm text-muted">No Sales revenue in the last three months. Their stock is excluded from operational Stock Balance and shown here instead.</p>
          <TableWrap><Thead><Th>Principal</Th><Th align="right">Stock Value</Th><Th align="right">Items</Th><Th align="right">Cover Days</Th><Th align="center">Status</Th></Thead><tbody>
            {scopedDormantPrincipals.map((r) => <tr key={r.key}><Td>{r.name}</Td><Td align="right">{formatCompact(r.value)}</Td><Td align="right">{formatNumber(r.itemCount)}</Td><Td align="right">{r.daysStock.toFixed(1)}</Td><Td align="center"><StockStatusPill action={r.action} /></Td></tr>)}
          </tbody></TableWrap>
        </SectionCard>
      )}
      {items.length > 0 && (
        <>
          <SectionCard title="Dormant Out-of-Stock Items">
            <p className="p-1 text-sm text-muted">Zero-piece SKUs with no invoice activity in the preceding three months. They are excluded from operational Stock Balance while kept here for review. {sourceDate ? `SAP stock as at ${new Date(sourceDate).toLocaleDateString()}.` : ""}</p>
          </SectionCard>
          <KpiGrid>
            <KpiCard accent="quarter" label="Dormant SKUs" value={formatNumber(scopedItems.length)} />
            <KpiCard accent="growth" label="Never sold" value={formatNumber(neverSold)} />
            <KpiCard accent="revenue" label="Residual stock value" value={formatCompact(totalValue)} />
          </KpiGrid>
          <SectionCard title="Dormant Exposure by Principal">
            <TableWrap><Thead><Th>Principal</Th><Th align="right">Dormant SKUs</Th><Th align="right">Never Sold</Th><Th align="right">Residual Value</Th></Thead><tbody>
              {byPrincipal.map((row) => <tr key={row.principal}><Td>{row.principal}</Td><Td align="right">{formatNumber(row.items)}</Td><Td align="right">{formatNumber(row.neverSold)}</Td><Td align="right">{formatCompact(row.value)}</Td></tr>)}
            </tbody></TableWrap>
          </SectionCard>
          <SectionCard title={`Dormant SKU Detail (${formatNumber(scopedItems.length)})`}>
            <TableWrap><Thead><Th>Principal</Th><Th>Item</Th><Th>Item Code</Th><Th align="right">Stock Pcs</Th><Th>Last Invoice</Th></Thead><tbody>
              {scopedItems.map((item) => <tr key={item.id}><Td>{item.principal}</Td><Td>{item.item}</Td><Td>{item.itemCode}</Td><Td align="right">{formatNumber(item.openingPcs)}</Td><Td>{item.lastSaleDate ? new Date(item.lastSaleDate).toLocaleDateString() : "No invoice history"}</Td></tr>)}
            </tbody></TableWrap>
          </SectionCard>
        </>
      )}
    </div>
  );
}
