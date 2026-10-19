"use client";

import { useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead, TotalRow } from "@/components/ui/Table";
import type { Assumptions } from "@/lib/universeAnalysis/config";
import type { Opportunities } from "@/lib/universeAnalysis/opportunities";
import { Note, SectionState, Tile, TileGrid, count, kes, millions, useSection, type AnalysisMeta } from "./shared";

interface OpportunityData {
  meta: AnalysisMeta;
  assumptions: Assumptions;
  opportunities: Opportunities;
}

type RateKey = "distributorToDirect" | "crossSell" | "frequencyRecovery" | "lapsingWinback" | "unproductiveCallConversion";

const RATES: { key: RateKey; label: string; basis: string }[] = [
  { key: "distributorToDirect", label: "Distributor-only → direct conversion rate", basis: "Share of distributor-only outlets converted to a direct account in 12 months." },
  { key: "crossSell", label: "Cross-sell conversion rate", basis: "Share of the white-space pool (outlets already buying another principal) that starts buying the target principal." },
  { key: "frequencyRecovery", label: "Frequency recovery rate", basis: "Share of the value lost to missed 30-day periods that is recovered among active direct outlets." },
  { key: "lapsingWinback", label: "Lapsing win-back rate", basis: "Share of run-rate retained among direct outlets with no purchase for 30–89 days." },
  { key: "unproductiveCallConversion", label: "Unproductive-call conversion", basis: "Share of this month's calls with no order that could be turned into orders." },
];

export function OpportunitiesSection({ query }: { query: string }) {
  const [rates, setRates] = useState<Record<RateKey, number | null>>({ distributorToDirect: null, crossSell: null, frequencyRecovery: null, lapsingWinback: null, unproductiveCallConversion: null });
  const extra = RATES.filter((r) => rates[r.key] !== null).map((r) => `${r.key}=${(rates[r.key] as number) / 100}`).join("&");
  const { data, status } = useSection<OpportunityData>("opportunities", extra ? `${query}&${extra}` : query);
  return (
    <SectionState status={status}>
      {data ? (
        <Body
          data={data}
          rates={rates}
          onRate={(key, value) => setRates((current) => ({ ...current, [key]: value }))}
          onReset={() => setRates({ distributorToDirect: null, crossSell: null, frequencyRecovery: null, lapsingWinback: null, unproductiveCallConversion: null })}
        />
      ) : null}
    </SectionState>
  );
}

function Body({ data, rates, onRate, onReset }: { data: OpportunityData; rates: Record<RateKey, number | null>; onRate: (key: RateKey, value: number | null) => void; onReset: () => void }) {
  const o = data.opportunities;
  const a = data.assumptions;
  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Assumptions (what-if)" action={<button onClick={onReset} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Reset to defaults</button>}>
        <div className="mb-3">
          <Note>Estimates, not forecasts. Pools are counted from the data; the capture rates below are editable what-ifs for your own view and never change the defaults for anyone else.</Note>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {RATES.map((r) => (
            <label key={r.key} className="flex flex-col gap-1 rounded-xl border border-border p-3">
              <span className="text-sm font-semibold text-foreground">{r.label}</span>
              <span className="text-xs text-muted">{r.basis}</span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={rates[r.key] ?? Math.round((a[r.key] as number) * 100)}
                  onChange={(e) => onRate(r.key, e.target.value === "" ? null : Math.min(100, Math.max(0, Number(e.target.value))))}
                  className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-sm"
                />
                <span className="text-sm text-muted">%</span>
              </span>
            </label>
          ))}
        </div>
      </SectionCard>

      <TileGrid>
        <Tile label="Sized new revenue / yr" value={kes(o.totalNewRevenue)} sub="items 1–3" />
        <Tile label="Revenue protected / yr" value={kes(o.lapsing.annualValue)} sub="item 4, lapsing win-back" />
        <Tile label="Unproductive calls (month)" value={count(o.unproductiveCalls.pool)} sub={`recoverable ≈ ${kes(o.unproductiveCalls.recoverable)}`} />
        <Tile label="Rep routes freed" value={o.routeOverlap.repRoutesFreed.toFixed(1)} sub="by merging overlapping routes" />
      </TileGrid>

      <SectionCard title="Summary">
        <TableWrap>
          <Thead>
            <Th>Opportunity</Th>
            <Th align="right">Pool (outlets / pairs)</Th>
            <Th align="right">Pool value, monthly (KES M)</Th>
            <Th align="right">Capture rate</Th>
            <Th align="right">Annual value (KES M)</Th>
            <Th>Type</Th>
          </Thead>
          <tbody>
            <tr><Td>1. Distributor-only → direct</Td><Td align="right">{count(o.distributorToDirect.pool)}</Td><Td align="right">{millions(o.distributorToDirect.bySegment.reduce((s, p) => s + p.poolMonthly, 0))}</Td><Td align="right">{(a.distributorToDirect * 100).toFixed(0)}%</Td><Td align="right">{millions(o.distributorToDirect.annualValue)}</Td><Td>New revenue</Td></tr>
            <tr><Td>2. Cross-sell in the direct base</Td><Td align="right">{count(o.crossSell.pool)}</Td><Td align="right">{millions(o.crossSell.rows.reduce((s, r) => s + r.whiteSpace * r.benchmarkMonthly, 0))}</Td><Td align="right">{(a.crossSell * 100).toFixed(0)}%</Td><Td align="right">{millions(o.crossSell.annualValue)}</Td><Td>New revenue</Td></tr>
            <tr><Td>3. Ordering frequency</Td><Td align="right">{count(o.frequency.pool)}</Td><Td align="right">{millions(o.frequency.monthlyValue)}</Td><Td align="right">{(a.frequencyRecovery * 100).toFixed(0)}%</Td><Td align="right">{millions(o.frequency.annualValue)}</Td><Td>Existing outlets</Td></tr>
            <tr><Td>4. Lapsing win-back</Td><Td align="right">{count(o.lapsing.pool)}</Td><Td align="right">{millions(o.lapsing.monthlyAtRisk)}</Td><Td align="right">{(a.lapsingWinback * 100).toFixed(0)}%</Td><Td align="right">{millions(o.lapsing.annualValue)}</Td><Td>Revenue at risk</Td></tr>
            <tr><Td>5. Route overlap (capacity)</Td><Td align="right">{count(o.routeOverlap.duplicateAssignments)}</Td><Td align="right">–</Td><Td align="right">–</Td><Td align="right">{o.routeOverlap.repRoutesFreed.toFixed(1)}</Td><Td>Capacity (rep-routes, not KES)</Td></tr>
            <TotalRow><Td>Total new revenue (items 1–3)</Td><Td align="right">{""}</Td><Td align="right">{""}</Td><Td align="right">{""}</Td><Td align="right">{millions(o.totalNewRevenue)}</Td><Td>New revenue</Td></TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="1. Distributor-only outlets → direct accounts (non-Mars principals)">
        <div className="mb-3">
          <Note>Pool = outlets buying only through Mars distributor reps. Benchmark = the median non-Mars direct monthly purchase per outlet in the same segment. Segments with fewer than 20 such outlets or 15 direct benchmark outlets are left out.</Note>
        </div>
        <TableWrap>
          <Thead>
            <Th>Segment</Th>
            <Th align="right">Distributor-only outlets</Th>
            <Th align="right">Benchmark monthly / direct outlet (KES)</Th>
            <Th align="right">Pool value, monthly (KES M)</Th>
            <Th align="right">Annual capture (KES M)</Th>
            <Th align="right">Direct outlets behind benchmark</Th>
          </Thead>
          <tbody>
            {o.distributorToDirect.bySegment.map((p) => (
              <tr key={p.segment}>
                <Td>{p.segment}</Td>
                <Td align="right">{count(p.outlets)}</Td>
                <Td align="right">{count(p.benchmarkMonthly)}</Td>
                <Td align="right">{millions(p.poolMonthly)}</Td>
                <Td align="right">{millions(p.annualValue)}</Td>
                <Td align="right">{count(p.directOutletsBehindBenchmark)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold text-foreground">The same pool by region</div>
          <TableWrap>
            <Thead>
              <Th>Region</Th>
              <Th align="right">Distributor-only outlets</Th>
            </Thead>
            <tbody>
              {Object.entries(o.distributorToDirect.byRegion).sort((x, y) => y[1] - x[1]).map(([region, n]) => (
                <tr key={region}>
                  <Td>{region}</Td>
                  <Td align="right">{count(n)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </SectionCard>

      <SectionCard title="2. Cross-sell inside the direct base">
        <div className="mb-3">
          <Note>Pool = unique outlets already buying directly from at least one Nairobi principal and not yet buying the target principal, by segment. Benchmark = the median monthly purchase of the segment&apos;s outlets that do buy it.</Note>
        </div>
        <TableWrap>
          <Thead>
            <Th>Target principal</Th>
            <Th>Segment</Th>
            <Th align="right">Outlets already buying</Th>
            <Th align="right">White-space outlets</Th>
            <Th align="right">Benchmark monthly / outlet (KES)</Th>
            <Th align="right">Annual capture (KES M)</Th>
          </Thead>
          <tbody>
            {o.crossSell.rows.map((r) => (
              <tr key={`${r.principal}-${r.segment}`}>
                <Td>{r.principal}</Td>
                <Td>{r.segment}</Td>
                <Td align="right">{count(r.buying)}</Td>
                <Td align="right">{count(r.whiteSpace)}</Td>
                <Td align="right">{count(r.benchmarkMonthly)}</Td>
                <Td align="right">{millions(r.annualValue)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
