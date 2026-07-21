import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import type { SyncHealthRow } from "@/lib/syncHealth";

function formatLastUpdated(date: Date | null): string {
  if (!date) return "Never";
  return date.toLocaleString();
}

/** Server-rendered — computed once per page load from lib/syncHealth.ts, no
 *  client fetch needed. Lives on /admin/dataset since that's the operational
 *  home for "is the data behind this app actually current." */
export function SyncHealthPanel({ rows }: { rows: SyncHealthRow[] }) {
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
      <TableWrap>
        <Thead>
          <Th>Source</Th>
          <Th>Cadence</Th>
          <Th>Last Updated</Th>
          <Th align="center">Status</Th>
        </Thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <Td>{r.label}</Td>
              <Td>{r.cadenceLabel}</Td>
              <Td>{formatLastUpdated(r.lastUpdated)}</Td>
              <Td align="center">
                <Badge tier={r.isStale ? "bad" : "good"}>{r.isStale ? "Stale" : "Fresh"}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </SectionCard>
  );
}
