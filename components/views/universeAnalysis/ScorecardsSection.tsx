"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import type { PrincipalScore, RepRow, TeamLeaderScore } from "@/lib/universeAnalysis/metrics";
import { Note, SectionState, StrikeBadge, count, millions, ratioPct, useSection, type AnalysisMeta } from "./shared";

interface ScorecardData {
  meta: AnalysisMeta;
  principals: PrincipalScore[];
  teamLeaders: TeamLeaderScore[];
  reps: RepRow[];
}

export function ScorecardsSection({ query }: { query: string }) {
  const { data, status } = useSection<ScorecardData>("scorecards", query);
  return <SectionState status={status}>{data ? <Body data={data} /> : null}</SectionState>;
}

const flagTier = (flag: RepRow["flag"]) => (flag === "OK" ? "good" : flag === "Non-field / van" ? "neutral" : "warn");

function Body({ data }: { data: ScorecardData }) {
  const [routeType, setRouteType] = useState<"All" | "Direct" | "Distributor">("All");
  const [flag, setFlag] = useState<"All" | "Flagged">("All");
  const reps = useMemo(() => data.reps.filter((r) => (routeType === "All" || r.routeType === routeType) && (flag === "All" || r.flag !== "OK")), [data.reps, routeType, flag]);
  const pill = (active: boolean) => `rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-primary-blue text-white" : "border border-border text-primary-blue hover:bg-accent-blue-soft"}`;
  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Principal scorecard">
        <div className="mb-3">
          <Note>Strike is for {data.meta.month.label}. SFA strike is the principal-wide figure over all its customers, including those that did not buy; the gap to the active-outlet strike shows calls spent on outlets that never buy.</Note>
        </div>
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Outlets</Th>
            <Th align="right">Direct outlets</Th>
            <Th align="right">Direct reps</Th>
            <Th align="right">YTD sales (KES M)</Th>
            <Th align="right">Share of sales</Th>
            <Th align="right">Avg invoice (KES)</Th>
            <Th align="right">Strike (active)</Th>
            <Th align="right">Strike (SFA-wide)</Th>
            <Th align="right">Unproductive value (KES M)</Th>
            <Th align="right">Consistent</Th>
            <Th align="right">Lapsing</Th>
            <Th align="right">Cross-buy</Th>
            <Th align="right">Wholesale share</Th>
          </Thead>
          <tbody>
            {data.principals.map((p) => (
              <tr key={String(p.principal)}>
                <Td>{p.principal}</Td>
                <Td align="right">{count(p.outlets)}</Td>
                <Td align="right">{count(p.directOutlets)}</Td>
                <Td align="right">{count(p.directReps)}</Td>
                <Td align="right">{millions(p.sales)}</Td>
                <Td align="right">{ratioPct(p.shareOfSales)}</Td>
                <Td align="right">{count(p.avgInvoice)}</Td>
                <Td align="right"><StrikeBadge ratio={p.strikeRate} /></Td>
                <Td align="right"><StrikeBadge ratio={p.sfaStrikeRate} /></Td>
                <Td align="right">{millions(p.unproductiveValue)}</Td>
                <Td align="right">{ratioPct(p.consistentShare, 0)}</Td>
                <Td align="right">{ratioPct(p.lapsingShare, 0)}</Td>
                <Td align="right">{ratioPct(p.crossBuyRate, 0)}</Td>
                <Td align="right">{ratioPct(p.wholesaleShareOfSales, 0)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Team leader scorecard">
        <TableWrap>
          <Thead>
            <Th>Team leader</Th>
            <Th>Principals</Th>
            <Th align="right">Reps</Th>
            <Th align="right">Outlets</Th>
            <Th align="right">YTD sales (KES M)</Th>
            <Th align="right">Strike rate</Th>
            <Th align="right">Unproductive value (KES M)</Th>
            <Th align="right">Consistent</Th>
            <Th align="right">Lapsing</Th>
          </Thead>
          <tbody>
            {data.teamLeaders.map((t) => (
              <tr key={String(t.teamLeader)}>
                <Td>{t.teamLeader ?? "Unassigned"}</Td>
                <Td className="max-w-[260px] truncate" title={t.principals}>{t.principals}</Td>
                <Td align="right">{count(t.reps)}</Td>
                <Td align="right">{count(t.outlets)}</Td>
                <Td align="right">{millions(t.sales)}</Td>
                <Td align="right"><StrikeBadge ratio={t.strikeRate} /></Td>
                <Td align="right">{millions(t.unproductiveValue)}</Td>
                <Td align="right">{ratioPct(t.consistentShare, 0)}</Td>
                <Td align="right">{ratioPct(t.lapsingShare, 0)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard
        title="Rep productivity"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {(["All", "Direct", "Distributor"] as const).map((v) => (
              <button key={v} onClick={() => setRouteType(v)} className={pill(routeType === v)}>{v}</button>
            ))}
            <button onClick={() => setFlag(flag === "All" ? "Flagged" : "All")} className={pill(flag === "Flagged")}>Flagged only</button>
          </div>
        }
      >
        <div className="mb-3">
          <Note>
            Flags: thin route (under 40 outlets), low strike (under 75%), high lapsing (over 40%), low consistency (under 45%); counters, key accounts and vans are not field reps. Showing {count(Math.min(reps.length, 300))} of {count(reps.length)}.
          </Note>
        </div>
        <TableWrap>
          <Thead>
            <Th>Rep</Th>
            <Th>Route</Th>
            <Th>Team leader</Th>
            <Th>Region</Th>
            <Th align="right">Outlets</Th>
            <Th align="right">YTD sales (KES M)</Th>
            <Th align="right">Strike rate</Th>
            <Th align="right">Consistent</Th>
            <Th align="right">Lapsing</Th>
            <Th>Flag</Th>
          </Thead>
          <tbody>
            {reps.slice(0, 300).map((r, i) => (
              <tr key={`${r.routeType}-${r.rep}-${i}`}>
                <Td>{r.rep ?? "Unassigned"}</Td>
                <Td>{r.routeType}</Td>
                <Td>{r.teamLeader ?? "–"}</Td>
                <Td>{r.region ?? "–"}</Td>
                <Td align="right">{count(r.outlets)}</Td>
                <Td align="right">{millions(r.sales)}</Td>
                <Td align="right"><StrikeBadge ratio={r.strikeRate} /></Td>
                <Td align="right">{ratioPct(r.consistentShare, 0)}</Td>
                <Td align="right">{ratioPct(r.lapsingShare, 0)}</Td>
                <Td><Badge tier={flagTier(r.flag)}>{r.flag}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
