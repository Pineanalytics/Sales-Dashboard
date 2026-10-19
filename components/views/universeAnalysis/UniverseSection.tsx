"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead, TotalRow } from "@/components/ui/Table";
import type { CoverageDetailRow, UniverseSummary } from "@/lib/universeAnalysis/metrics";
import { Note, SectionState, count, kes, millions, ratioPct, useSection, type AnalysisMeta } from "./shared";

interface HealthRow {
  value: string | null;
  routeType: "Direct" | "Distributor";
  pairs: number;
  monthlyRunRate: number;
  strikeRate: number | null;
}

interface ConcentrationRow {
  topShareOfOutlets: number;
  outlets: number;
  shareOfSales: number;
}

interface UniverseData {
  meta: AnalysisMeta;
  summary: UniverseSummary;
  bySegment: CoverageDetailRow[];
  byRegion: CoverageDetailRow[];
  healthRecency: HealthRow[];
  healthTenure: HealthRow[];
  healthConsistency: HealthRow[];
  concentration: ConcentrationRow[];
  concentrationWholesale: ConcentrationRow[];
  crossBuy: { principals: string[]; matrix: number[][] };
}

export function UniverseSection({ query }: { query: string }) {
  const { data, status } = useSection<UniverseData>("universe", query);
  return <SectionState status={status}>{data ? <Body data={data} /> : null}</SectionState>;
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <SectionCard title={title}>
      {note ? (
        <div className="mb-3">
          <Note>{note}</Note>
        </div>
      ) : null}
      {children}
    </SectionCard>
  );
}

const statusTier = (s: CoverageDetailRow["status"]) => (s === "Strong" ? "good" : s === "Partial" ? "warn" : "bad");

function CoverageTable({ rows, label }: { rows: CoverageDetailRow[]; label: string }) {
  return (
    <TableWrap>
      <Thead>
        <Th>{label}</Th>
        <Th align="right">Universe (outlets)</Th>
        <Th align="right">Direct reach (outlets)</Th>
        <Th align="right">Direct reach %</Th>
        <Th align="right">Also via distributor</Th>
        <Th align="right">Distributor-only</Th>
        <Th align="right">Direct sales (KES M)</Th>
        <Th align="right">Distributor sales (KES M)</Th>
        <Th align="right">Avg direct invoice (KES)</Th>
        <Th align="right">Median direct monthly / outlet (KES)</Th>
        <Th align="right">Direct reps</Th>
        <Th align="right">Universe per direct rep</Th>
        <Th>Reach</Th>
      </Thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.value)}>
            <Td>{r.value ?? "Unassigned"}</Td>
            <Td align="right">{count(r.universe)}</Td>
            <Td align="right">{count(r.direct)}</Td>
            <Td align="right">{ratioPct(r.directReach, 0)}</Td>
            <Td align="right">{count(r.alsoViaDistributor)}</Td>
            <Td align="right">{count(r.distributorOnly)}</Td>
            <Td align="right">{millions(r.directSales)}</Td>
            <Td align="right">{millions(r.distributorSales)}</Td>
            <Td align="right">{count(r.avgDirectInvoice)}</Td>
            <Td align="right">{count(r.medianDirectMonthly)}</Td>
            <Td align="right">{count(r.directReps)}</Td>
            <Td align="right">{r.universePerDirectRep === null ? "–" : count(r.universePerDirectRep)}</Td>
            <Td><Badge tier={statusTier(r.status)}>{r.status}</Badge></Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function HealthTable({ rows, label }: { rows: HealthRow[]; label: string }) {
  const values = [...new Set(rows.map((r) => r.value))];
  const find = (value: string | null, routeType: HealthRow["routeType"]) => rows.find((r) => r.value === value && r.routeType === routeType);
  return (
    <TableWrap>
      <Thead>
        <Th>{label}</Th>
        <Th align="right">Direct pairs</Th>
        <Th align="right">Direct run-rate (KES M / month)</Th>
        <Th align="right">Direct strike</Th>
        <Th align="right">Distributor pairs</Th>
        <Th align="right">Distributor run-rate (KES M / month)</Th>
        <Th align="right">Distributor strike</Th>
      </Thead>
      <tbody>
        {values.map((v) => {
          const d = find(v, "Direct");
          const s = find(v, "Distributor");
          return (
            <tr key={String(v)}>
              <Td>{v ?? "Unknown"}</Td>
              <Td align="right">{count(d?.pairs ?? 0)}</Td>
              <Td align="right">{millions(d?.monthlyRunRate ?? 0)}</Td>
              <Td align="right">{ratioPct(d?.strikeRate)}</Td>
              <Td align="right">{count(s?.pairs ?? 0)}</Td>
              <Td align="right">{millions(s?.monthlyRunRate ?? 0)}</Td>
              <Td align="right">{ratioPct(s?.strikeRate)}</Td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

function ConcentrationTable({ rows }: { rows: ConcentrationRow[] }) {
  return (
    <TableWrap>
      <Thead>
        <Th>Top share of outlets</Th>
        <Th align="right">Outlets</Th>
        <Th align="right">Share of YTD sales</Th>
      </Thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.topShareOfOutlets}>
            <Td>Top {(r.topShareOfOutlets * 100).toFixed(0)}%</Td>
            <Td align="right">{count(r.outlets)}</Td>
            <Td align="right">{ratioPct(r.shareOfSales, 0)}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function Body({ data }: { data: UniverseData }) {
  const { summary } = data;
  const routeSales = (route: string) => summary.coverage.find((c) => c.route === route);
  return (
    <div className="flex flex-col gap-6">
      <Block title="A. How the universe is reached" note="Direct = Primary Sales (Pinefrost reps invoice the outlet). Distributor = Secondary Sales (the outlet buys through a distributor rep). An outlet buying both ways counts once, in the middle row.">
        <TableWrap>
          <Thead>
            <Th>Coverage route</Th>
            <Th align="right">Outlets</Th>
            <Th align="right">% of universe</Th>
            <Th align="right">YTD sales (KES M)</Th>
            <Th align="right">% of sales</Th>
            <Th align="right">Monthly run-rate (KES M)</Th>
            <Th align="right">Median monthly per outlet (KES)</Th>
          </Thead>
          <tbody>
            {summary.coverage.map((c) => (
              <tr key={c.route}>
                <Td>{c.route}</Td>
                <Td align="right">{count(c.outlets)}</Td>
                <Td align="right">{ratioPct(summary.uniqueOutlets ? c.outlets / summary.uniqueOutlets : null, 1)}</Td>
                <Td align="right">{millions(c.sales)}</Td>
                <Td align="right">{ratioPct(summary.sales ? c.sales / summary.sales : null, 1)}</Td>
                <Td align="right">{millions(c.monthlyRunRate)}</Td>
                <Td align="right">{count(c.medianMonthly)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total unique active outlets</Td>
              <Td align="right">{count(summary.uniqueOutlets)}</Td>
              <Td align="right">100%</Td>
              <Td align="right">{millions(summary.sales)}</Td>
              <Td align="right">100%</Td>
              <Td align="right">{millions(summary.coverage.reduce((s, c) => s + c.monthlyRunRate, 0))}</Td>
              <Td align="right">–</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
        <div className="mt-3">
          <Note>
            Direct reach {ratioPct(summary.directReach)}: {count(summary.directOutlets)} of {count(summary.uniqueOutlets)} outlets. Direct-only sales {kes(routeSales("Direct only")?.sales)}; distributor-only sales {kes(routeSales("Distributor only")?.sales)}.
          </Note>
        </div>
      </Block>
      <Block title="B. Universe by outlet segment: where Pinefrost is and is not">
        <CoverageTable rows={data.bySegment} label="Segment" />
      </Block>
      <Block title="C. Universe by region (regions cleaned from GPS)">
        <CoverageTable rows={data.byRegion} label="Region" />
      </Block>
      <Block title="D1. Outlet health: recency (days since last purchase)" note="Counted at outlet × principal pairs, direct vs distributor. Strike is for the analysed month.">
        <HealthTable rows={data.healthRecency} label="Recency" />
      </Block>
      <Block title="D2. Outlet health: buying tenure">
        <HealthTable rows={data.healthTenure} label="Buying tenure" />
      </Block>
      <Block title="D3. Outlet health: ordering consistency (periods bought of the last 3)">
        <HealthTable rows={data.healthConsistency} label="Periods bought" />
      </Block>
      <Block title="E. Concentration of value" note="How much of year-to-date sales sits in the top slice of unique outlets.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-semibold text-foreground">All outlets</div>
            <ConcentrationTable rows={data.concentration} />
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-foreground">Wholesale outlets</div>
            <ConcentrationTable rows={data.concentrationWholesale} />
          </div>
        </div>
      </Block>
      <Block title="F. Cross-buying: direct outlets" note="Of the direct outlets buying the row principal, the share that also buy the column principal directly.">
        <TableWrap>
          <Thead>
            <Th>Row principal buys →</Th>
            {data.crossBuy.principals.map((p) => (
              <Th key={p} align="right">{p.replace("-Nairobi", "")}</Th>
            ))}
          </Thead>
          <tbody>
            {data.crossBuy.principals.map((row, i) => (
              <tr key={row}>
                <Td>{row}</Td>
                {data.crossBuy.matrix[i].map((v, j) => (
                  <Td key={j} align="right" className={i === j ? "text-muted" : ""}>
                    <span style={i === j ? undefined : { background: `rgba(14, 116, 144, ${Math.min(0.55, v * 0.9)})`, borderRadius: 6, padding: "2px 6px" }}>{(v * 100).toFixed(0)}%</span>
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Block>
    </div>
  );
}
