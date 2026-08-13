import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import type { DirectStockSyncStatus } from "@/lib/stockSync";

function count(value: number | null): string { return value === null ? "—" : value.toLocaleString(); }
function currency(value: number | null): string { return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

/** Shows the live SAP feed's freshness and the residual Excel reconciliation
 * so admins retain the migration audit trail after the switch-over. */
export function DirectStockSyncPanel({ status }: { status: DirectStockSyncStatus | null }) {
  return (
    <SectionCard title="Direct SAP Stock Verification" action={<Badge tier="good">SAP is live</Badge>}>
      {!status ? (
        <p className="px-4 py-5 text-sm text-muted">No direct SAP stock snapshot has completed yet.</p>
      ) : (
        <div className="space-y-4 p-1">
          <p className="text-xs text-muted">Last SAP snapshot: {status.completedAt.toLocaleString()} · Stock as at {status.sourceDate.toLocaleDateString()}</p>
          <TableWrap>
            <Thead><Th>Measure</Th><Th align="right">SAP Direct</Th><Th align="right">Excel Snapshot</Th><Th align="right">Difference</Th></Thead>
            <tbody>
              <tr><Td>Dashboard stock rows</Td><Td align="right">{count(status.rowCount)}</Td><Td align="right">{count(status.excelRowCount)}</Td><Td align="right">{status.matchedExcelRows === null ? "—" : `${count(status.matchedExcelRows)} matched`}</Td></tr>
              <tr><Td>Stock value</Td><Td align="right">{currency(status.directStockValue)}</Td><Td align="right">{currency(status.excelStockValue)}</Td><Td align="right">{status.stockValueVariancePct === null ? "—" : `${status.stockValueVariancePct >= 0 ? "+" : ""}${status.stockValueVariancePct.toFixed(2)}%`}</Td></tr>
              <tr><Td>Unmatched items</Td><Td align="right">{count(status.onlySapRows)} SAP only</Td><Td align="right">{count(status.onlyExcelRows)} Excel only</Td><Td align="right">{status.matchedDemandRows.toLocaleString()} with demand</Td></tr>
              <tr><Td>Dormant out of stock</Td><Td align="right">{status.dormantOutOfStockRows.toLocaleString()} excluded</Td><Td align="right">—</Td><Td align="right">See Dormant OOS module</Td></tr>
            </tbody>
          </TableWrap>
          <p className="text-xs text-muted">Source rows: {status.physicalSourceRows.toLocaleString()} physical-balance rows and {status.demandSourceRows.toLocaleString()} demand rows. SAP is the operational Stock Balance source; this comparison remains as an audit trail for the legacy Excel snapshot.</p>
        </div>
      )}
    </SectionCard>
  );
}
