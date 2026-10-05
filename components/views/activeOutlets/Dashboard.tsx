"use client";

import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartGrid, KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber } from "@/lib/format";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import type { BreakdownRow, OutletFilters, OutletUniverseSummary } from "@/lib/outletUniverse/query";
import { BreakdownChart } from "./BreakdownChart";

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

function BreakdownTable({ title, rows, onPick }: { title: string; rows: BreakdownRow[]; onPick?: (name: string) => void }) {
  return (
    <TableWrap>
      <Thead>
        <Th>{title}</Th>
        <Th align="right">Active</Th>
        <Th align="right">Known</Th>
        <Th align="right">Active %</Th>
      </Thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <Td>
              {onPick ? (
                <button onClick={() => onPick(row.name)} className="text-left font-medium text-primary-blue hover:underline">
                  {row.name}
                </button>
              ) : (
                row.name
              )}
            </Td>
            <Td align="right">{formatNumber(row.active)}</Td>
            <Td align="right">{formatNumber(row.total)}</Td>
            <Td align="right">{pct(row.active, row.total)}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export function Dashboard({ summary, filters, onFilter }: { summary: OutletUniverseSummary; filters: OutletFilters; onFilter: (patch: Partial<OutletFilters>) => void }) {
  const { totals } = summary;
  const knownAll = summary.bySource.reduce((sum, row) => sum + row.total, 0);
  const activeAll = summary.bySource.reduce((sum, row) => sum + row.active, 0);
  const principalTotals = summary.byPrincipal.reduce((acc, row) => ({ active: acc.active + row.active, total: acc.total + row.total, sales: acc.sales + row.sales }), { active: 0, total: 0, sales: 0 });
  const generalView = filters.view === "general";

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard
          accent="coverage"
          label={generalView ? `Active Outlets – distinct (≤ ${summary.activeWindowDays} days)` : `Active Outlets (≤ ${summary.activeWindowDays} days)`}
          value={<AnimatedValue value={activeAll} format={formatNumber} />}
        />
        <KpiCard accent="growth" label={generalView ? "Known Outlets – distinct" : "Known Outlet-Principal Pairs"} value={<AnimatedValue value={knownAll} format={formatNumber} />} />
        <KpiCard accent="quarter" label="Active Rate" value={pct(activeAll, knownAll)} />
        <KpiCard accent="revenue" label="Sales YTD (shown outlets)" value={<AnimatedValue value={totals.sales} format={formatCompact} />} />
        <KpiCard accent="coverage" label="Outlets With GPS" value={pct(totals.withCoordinates, totals.total)} />
      </KpiGrid>

      <SectionCard title="Active Outlets by Principal">
        <p className="mb-3 text-xs text-muted">Click a bar to filter to that principal. An outlet that buys several principals is counted under each of them here, even in the General view.</p>
        <BreakdownChart rows={summary.byPrincipal.map((row) => ({ name: row.name, active: row.active, total: row.total }))} status={filters.status} layout="horizontal" onPick={(name) => onFilter({ principal: name })} />
        <div className="mt-4">
          <TableWrap>
            <Thead>
              <Th>Principal</Th>
              <Th>Source</Th>
              <Th align="right">Active</Th>
              <Th align="right">Known</Th>
              <Th align="right">Active %</Th>
              <Th align="right">Sales YTD</Th>
            </Thead>
            <tbody>
              {summary.byPrincipal.map((row) => (
                <tr key={`${row.source}|${row.name}`}>
                  <Td>
                    <button onClick={() => onFilter({ principal: row.name })} className="text-left font-medium text-primary-blue hover:underline">
                      {row.name}
                    </button>
                  </Td>
                  <Td>{OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source}</Td>
                  <Td align="right">{formatNumber(row.active)}</Td>
                  <Td align="right">{formatNumber(row.total)}</Td>
                  <Td align="right">{pct(row.active, row.total)}</Td>
                  <Td align="right">{formatCompact(row.sales)}</Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total (principal pairs)</Td>
                <Td>—</Td>
                <Td align="right">{formatNumber(principalTotals.active)}</Td>
                <Td align="right">{formatNumber(principalTotals.total)}</Td>
                <Td align="right">{pct(principalTotals.active, principalTotals.total)}</Td>
                <Td align="right">{formatCompact(principalTotals.sales)}</Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </div>
      </SectionCard>

      <ChartGrid>
        <SectionCard title="By Region">
          <BreakdownChart rows={summary.byRegion} status={filters.status} layout="vertical" onPick={(name) => onFilter({ region: name })} />
        </SectionCard>
        <SectionCard title="By Source System">
          <BreakdownTable
            title="Source"
            rows={summary.bySource.map((row) => ({ ...row, name: OUTLET_SOURCE_LABELS[row.name as OutletSource] ?? row.name }))}
            onPick={(label) => {
              const source = (Object.keys(OUTLET_SOURCE_LABELS) as OutletSource[]).find((key) => OUTLET_SOURCE_LABELS[key] === label);
              if (source) onFilter({ source });
            }}
          />
        </SectionCard>
      </ChartGrid>

      <SectionCard title="By Territory (top 25 by active outlets)">
        <BreakdownChart rows={summary.byTerritory} status={filters.status} layout="horizontal" onPick={(name) => onFilter({ territory: name })} />
      </SectionCard>

      <ChartGrid>
        <SectionCard title="By Channel">
          <BreakdownChart rows={summary.byChannel} status={filters.status} layout="vertical" onPick={(name) => onFilter({ channel: name })} />
        </SectionCard>
        <SectionCard title="By Segment / Type">
          <BreakdownChart rows={summary.bySegment} status={filters.status} layout="horizontal" onPick={(name) => onFilter({ segment: name })} />
        </SectionCard>
      </ChartGrid>

      <SectionCard title="By Rep (top 25 by active outlets)">
        <BreakdownTable title="Rep" rows={summary.byRep} onPick={(name) => onFilter({ rep: name })} />
      </SectionCard>
    </div>
  );
}
