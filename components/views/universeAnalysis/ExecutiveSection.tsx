"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import type { Insight } from "@/lib/universeAnalysis/insights";
import type { SummaryRow, UniverseSummary } from "@/lib/universeAnalysis/metrics";
import { Note, SectionState, Tile, TileGrid, count, kes, millions, ratioPct, useSection, type AnalysisMeta } from "./shared";

interface OverviewData {
  meta: AnalysisMeta;
  universe: UniverseSummary;
  total: SummaryRow;
  direct: SummaryRow;
  distributor: SummaryRow;
  opportunities: {
    distributorToDirect: { pool: number; annualValue: number };
    crossSell: { pool: number; annualValue: number };
    frequency: { pool: number; annualValue: number };
    lapsing: { pool: number; annualValue: number };
    unproductiveCalls: { pool: number; value: number; recoverable: number; note: string };
    routeOverlap: { outletsMultiRep: number; duplicateAssignments: number; repRoutesFreed: number };
    totalNewRevenue: number;
  };
  insights: Insight[];
  dedup: { records: number; merged: number; groups: number; toReview: number };
}

export function ExecutiveSection({ query }: { query: string }) {
  const { data, status } = useSection<OverviewData>("overview", query);
  return <SectionState status={status}>{data ? <Body data={data} /> : null}</SectionState>;
}

function Body({ data }: { data: OverviewData }) {
  const { universe: u, total, direct, opportunities: o, meta } = data;
  const directShare = total.sales ? direct.sales / total.sales : null;
  return (
    <div className="flex flex-col gap-6">
      <TileGrid>
        <Tile label="Active outlet universe" value={count(u.uniqueOutlets)} sub={`unique outlets (${count(data.dedup.records)} IDs; ${count(data.dedup.merged)} duplicates merged)`} />
        <Tile label="Direct reach" value={ratioPct(u.directReach)} sub={`${count(u.directOutlets)} outlets served by Pinefrost reps`} />
        <Tile label="Distributor-only outlets" value={count(u.distributorOnly)} sub="buy only via distributor reps" />
        <Tile label="YTD sales" value={kes(total.sales)} sub={`${ratioPct(directShare, 0)} direct`} />
        <Tile label={`Strike rate · ${meta.month.label}`} value={ratioPct(total.strikeRate)} sub="active outlets, productive ÷ calls this month" />
        <Tile label="Unproductive calls" value={count(total.unproductiveCalls)} sub={`calls in ${meta.month.label} with no order`} />
        <Tile label="Value of unproductive calls" value={kes(total.unproductiveValue)} sub="at each outlet's usual invoice" />
        <Tile label="Direct pairs lapsing" value={count(o.lapsing.pool)} sub="no purchase for 30–89 days" />
        <Tile label="Sized new revenue / yr" value={kes(o.totalNewRevenue)} sub="items 1–3 below; editable on Opportunities" />
        <Tile label="Overlapping rep routes" value={count(o.routeOverlap.outletsMultiRep)} sub="direct outlets with more than one rep" />
      </TileGrid>

      <SectionCard title="What the data says">
        <ol className="flex flex-col gap-4">
          {data.insights.map((insight, i) => (
            <li key={insight.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-blue-soft text-xs font-semibold text-primary-blue">{i + 1}</span>
              <div>
                <div className="text-sm font-semibold text-foreground">{insight.title}</div>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{insight.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Where the money is">
        <TableWrap>
          <Thead>
            <Th>Opportunity</Th>
            <Th align="right">Pool</Th>
            <Th align="right">Value (KES M)</Th>
            <Th>Type</Th>
          </Thead>
          <tbody>
            <tr><Td>1. Convert distributor-only outlets to direct</Td><Td align="right">{count(o.distributorToDirect.pool)}</Td><Td align="right">{millions(o.distributorToDirect.annualValue)}</Td><Td>New revenue / yr</Td></tr>
            <tr><Td>2. Cross-sell inside the direct base</Td><Td align="right">{count(o.crossSell.pool)}</Td><Td align="right">{millions(o.crossSell.annualValue)}</Td><Td>New revenue / yr</Td></tr>
            <tr><Td>3. Lift ordering frequency</Td><Td align="right">{count(o.frequency.pool)}</Td><Td align="right">{millions(o.frequency.annualValue)}</Td><Td>Existing outlets / yr</Td></tr>
            <tr><Td>4. Win back lapsing outlets (protect)</Td><Td align="right">{count(o.lapsing.pool)}</Td><Td align="right">{millions(o.lapsing.annualValue)}</Td><Td>Revenue at risk / yr</Td></tr>
            <tr><Td>5. Convert more unproductive calls</Td><Td align="right">{count(o.unproductiveCalls.pool)}</Td><Td align="right">{millions(o.unproductiveCalls.recoverable)}</Td><Td>This month only</Td></tr>
            <tr><Td>6. Merge overlapping routes (rep-routes freed)</Td><Td align="right">{count(o.routeOverlap.duplicateAssignments)}</Td><Td align="right">{o.routeOverlap.repRoutesFreed.toFixed(1)}</Td><Td>Capacity</Td></tr>
          </tbody>
        </TableWrap>
        <div className="mt-3">
          <Note>Values apply editable capture rates (Opportunities tab). Items 1–3 are new or incremental revenue; item 4 is revenue protected; item 6 shows rep-route equivalents, not KES.</Note>
        </div>
      </SectionCard>
    </div>
  );
}
