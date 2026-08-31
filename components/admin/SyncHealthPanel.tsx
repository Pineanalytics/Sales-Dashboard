import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { TriggerSalesReturnsButton } from "@/components/admin/TriggerSalesReturnsButton";
import { SalesReturnsControlButton } from "@/components/admin/SalesReturnsControlButton";
import type { SyncHealthRow } from "@/lib/syncHealth";
import type { DeploymentInfo } from "@/lib/deployment";

function formatLastUpdated(date: Date | null): string {
  if (!date) return "Never";
  return date.toLocaleString();
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
        <Thead>
          <Th>Source</Th>
          <Th>Cadence</Th>
          <Th>Last Updated</Th>
          <Th>Expected By</Th>
          <Th align="center">Status</Th>
          <Th>Manual run</Th>
        </Thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <Td>{r.label}</Td>
              <Td>{r.cadenceLabel}</Td>
              <Td>{formatLastUpdated(r.lastUpdated)}</Td>
              <Td>{formatLastUpdated(r.expectedBy)}</Td>
              <Td align="center">
                <Badge tier={r.isStale ? "bad" : "good"}>{r.isStale ? "Stale" : "Fresh"}</Badge>
              </Td>
              <Td>
                {r.triggerDistributor ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <TriggerSalesReturnsButton distributor={r.triggerDistributor} label={r.label} />
                    <SalesReturnsControlButton distributor={r.triggerDistributor} control={r.salesReturnsControl} />
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </SectionCard>
  );
}
