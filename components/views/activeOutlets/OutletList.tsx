"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatCompact, formatNumber } from "@/lib/format";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import type { OutletListRow } from "@/lib/outletUniverse/query";

export function OutletList({
  list,
  exportHref,
  onPage,
}: {
  list: { rows: OutletListRow[]; total: number; page: number; pageCount: number };
  exportHref: string;
  onPage: (page: number) => void;
}) {
  const pageButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft";
  const pageDisabled = "rounded-full border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted/60";
  return (
    <SectionCard
      title="Outlet Listing"
      action={
        <a href={exportHref} className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow" download>
          Download CSV ({formatNumber(list.total)})
        </a>
      }
    >
      <TableWrap>
        <Thead>
          <Th>Outlet</Th>
          <Th>Source</Th>
          <Th>Principal(s)</Th>
          <Th>Channel</Th>
          <Th>Segment / Type</Th>
          <Th>Region</Th>
          <Th>Territory</Th>
          <Th>Route</Th>
          <Th>Rep</Th>
          <Th>Last Purchase</Th>
          <Th>Status</Th>
          <Th align="right">Sales YTD</Th>
        </Thead>
        <tbody>
          {list.rows.map((row) => (
            <tr key={`${row.source}|${row.outletKey}|${row.principals}`}>
              <Td title={`${row.outletName} (${row.outletKey})`}>{row.outletName}</Td>
              <Td>{OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source}</Td>
              <Td title={row.principals}>{row.principals}</Td>
              <Td>{row.channel}</Td>
              <Td>{row.segment}</Td>
              <Td>{row.region}</Td>
              <Td>{row.territory}</Td>
              <Td>{row.route ?? "—"}</Td>
              <Td>{row.repName ?? "—"}</Td>
              <Td>{row.lastPurchaseDate ?? "—"}</Td>
              <Td>
                <span className={row.active ? "font-semibold text-accent-green" : "text-muted"}>{row.active ? "Active" : "Inactive"}</span>
              </Td>
              <Td align="right">{formatCompact(row.sales)}</Td>
            </tr>
          ))}
          {list.rows.length === 0 ? (
            <tr>
              <td colSpan={12} className="px-3 py-8 text-center text-muted">
                No outlets match these filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </TableWrap>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>
          {formatNumber(list.total)} outlet{list.total === 1 ? "" : "s"} · page {list.page} of {list.pageCount}
        </span>
        <div className="flex items-center gap-2">
          {list.page > 1 ? (
            <button onClick={() => onPage(list.page - 1)} className={pageButton}>
              ← Previous
            </button>
          ) : (
            <span className={pageDisabled}>← Previous</span>
          )}
          {list.page < list.pageCount ? (
            <button onClick={() => onPage(list.page + 1)} className={pageButton}>
              Next →
            </button>
          ) : (
            <span className={pageDisabled}>Next →</span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
