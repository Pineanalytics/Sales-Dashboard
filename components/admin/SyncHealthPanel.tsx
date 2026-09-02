import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { TriggerSalesReturnsButton } from "@/components/admin/TriggerSalesReturnsButton";
import { SalesReturnsControlButton } from "@/components/admin/SalesReturnsControlButton";
import { TriggerEablSalesExportButton } from "@/components/admin/TriggerEablSalesExportButton";
import { TriggerUpfieldDataEdgeButton } from "@/components/admin/TriggerUpfieldDataEdgeButton";
import type { SyncHealthRow } from "@/lib/syncHealth";
import type { DeploymentInfo } from "@/lib/deployment";

function formatLastUpdated(date: Date | null): string {
  if (!date) return "Never";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Server-rendered — computed once per page load from lib/syncHealth.ts, no
 *  client fetch needed. Lives on /admin/dataset since that's the operational
 *  home for "is the data behind this app actually current." */
export function SyncHealthPanel({ rows, deployment }: { rows: SyncHealthRow[]; deployment: DeploymentInfo }) {
  const anyStale = rows.some((r) => r.isStale);

  return (
    <SectionCard
      title="Sync Health"
      action={
        anyStale ? (
          <Badge tier="bad">Attention needed</Badge>
        ) : (
          <Badge tier="good">All syncs current</Badge>
        )
      }
    >
      <div className="mb-4 grid gap-2 rounded-xl border border-border bg-background-elevated p-3 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="font-semibold text-foreground">Commit</span><br />{deployment.shortCommit}</div>
        <div><span className="font-semibold text-foreground">Branch</span><br />{deployment.branch}</div>
        <div><span className="font-semibold text-foreground">Built</span><br />{deployment.builtAt ? new Date(deployment.builtAt).toLocaleString() : "Local / unknown"}</div>
        <div><span className="font-semibold text-foreground">Schema</span><br />{deployment.schemaFingerprint.slice(0, 12)}</div>
      </div>
      <TableWrap>
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[17%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[25%]" />
          </colgroup>
          <Thead>
            <Th className="!whitespace-normal !px-2 !py-2">Source</Th>
            <Th className="!whitespace-normal !px-2 !py-2">Cadence</Th>
            <Th className="!whitespace-normal !px-2 !py-2">Last updated</Th>
            <Th className="!whitespace-normal !px-2 !py-2">Expected by</Th>
            <Th align="center" className="!whitespace-normal !px-2 !py-2">Status</Th>
            <Th className="!whitespace-normal !px-2 !py-2">Manual run</Th>
          </Thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <Td className="!whitespace-normal !px-2 !py-2 leading-tight">{r.label}</Td>
                <Td className="!whitespace-normal !px-2 !py-2 leading-tight">{r.cadenceLabel}</Td>
                <Td className="!whitespace-normal !px-2 !py-2 leading-tight" title={r.lastUpdated?.toLocaleString()}>{formatLastUpdated(r.lastUpdated)}</Td>
                <Td className="!whitespace-normal !px-2 !py-2 leading-tight" title={r.expectedBy?.toLocaleString()}>{formatLastUpdated(r.expectedBy)}</Td>
                <Td align="center" className="!whitespace-normal !px-2 !py-2">
                  <Badge tier={r.isStale ? "bad" : "good"}>{r.isStale ? "Stale" : "Fresh"}</Badge>
                </Td>
                <Td className="!whitespace-normal !px-2 !py-2">
                  {r.triggerDistributor ? (
                    <div className="flex flex-wrap items-start gap-1.5">
                      <TriggerSalesReturnsButton distributor={r.triggerDistributor} label={r.label} />
                      <SalesReturnsControlButton distributor={r.triggerDistributor} control={r.salesReturnsControl} />
                    </div>
                  ) : r.triggerEablSalesExport ? <TriggerEablSalesExportButton /> : r.triggerUpfieldDataEdge ? <TriggerUpfieldDataEdgeButton /> : null}
                  {r.eablSalesExport && <div className="mt-1 text-[10px] leading-tight text-muted">Available: {formatLastUpdated(r.eablSalesExport.latestAvailableReportDate)} · File: {r.eablSalesExport.lastDeliveredFile ?? "—"} {r.eablSalesExport.deliveredLocation ? `(${r.eablSalesExport.deliveredLocation})` : ""}{r.eablSalesExport.lastError ? ` · Error: ${r.eablSalesExport.lastError}` : ""}</div>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </SectionCard>
  );
}
