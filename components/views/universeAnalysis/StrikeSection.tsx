"use client";

import type { ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import type { SummaryGroup, SummaryRow } from "@/lib/universeAnalysis/metrics";
import type { TargetRow } from "@/lib/universeAnalysis/opportunities";
import { CsvLink, Note, SectionState, StrikeGroupTable, Tile, TileGrid, count, keyLabel, millions, plainPct, ratioPct, useSection, type AnalysisMeta } from "./shared";

interface TrendPoint {
  monthIndex: number;
  label: string;
  calls: number;
  productive: number;
  strikeRate: number | null;
}

interface StrikeData {
  meta: AnalysisMeta;
  total: SummaryRow;
  byPrincipal: SummaryGroup[];
  byRouteChannel: SummaryGroup[];
  byRegion: SummaryGroup[];
  byRepRegion: SummaryGroup[];
  byTeamLeader: SummaryGroup[];
  byRecency: SummaryGroup[];
  byConsistency: SummaryGroup[];
  byTenure: SummaryGroup[];
  bySegment: SummaryGroup[];
  byTier: SummaryGroup[];
  trend: { months: TrendPoint[]; byPrincipal: { principal: string; points: TrendPoint[] }[] };
  lowStrike: TargetRow[];
  lowStrikeRule: { windowMonths: number; minCalls: number; thresholdPct: number };
}

export function StrikeSection({ query }: { query: string }) {
  const { data, status } = useSection<StrikeData>("strike", query);
  return <SectionState status={status}>{data ? <Body data={data} query={query} /> : null}</SectionState>;
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

function Body({ data, query }: { data: StrikeData; query: string }) {
  const month = data.meta.month.label;
  const chartData = data.trend.months.map((m) => {
    const point: Record<string, string | number | null> = { label: m.label.slice(0, 3), All: m.strikeRate };
    for (const p of data.trend.byPrincipal) point[p.principal] = p.points.find((x) => x.monthIndex === m.monthIndex)?.strikeRate ?? null;
    return point;
  });
  const series = ["All", ...data.trend.byPrincipal.map((p) => p.principal)];
  return (
    <div className="flex flex-col gap-6">
      <TileGrid>
        <Tile label={`Strike rate · ${month}`} value={ratioPct(data.total.strikeRate)} sub="active outlets only (bought in the last 90 days)" />
        <Tile label="Calls with outcome" value={count(data.total.callsWithOutcome)} sub="customer-months called this month" />
        <Tile label="Productive calls" value={count(data.total.productiveCalls)} />
        <Tile label="Unproductive calls" value={count(data.total.unproductiveCalls)} sub={`worth KES ${millions(data.total.unproductiveValue)}M`} />
      </TileGrid>
      <Note>
        Strike rate is measured for one calendar month at a time ({month}); a year-to-date figure blends months and hides where the field stands today. A call is a customer-month, counted by the same rules as the Coverage page: the reps that visited the customer, and those of them with a sale or order.
        {data.meta.sourcesWithoutCalls.length ? ` No call data for ${data.meta.sourcesWithoutCalls.join(", ")} this month: left out, not shown as 0%.` : ""} Leverage records completed documents only, so it has no strike rate.
      </Note>

      <SectionCard title="Strike rate by month">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke={CHART_AXIS_COLOR} fontSize={12} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={12} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => (typeof value === "number" ? `${value.toFixed(1)}%` : "n/a")} />
              <Legend />
              {series.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={name === "All" ? 3 : 1.5} dot={{ r: 2 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2">
          <Note>Month by month across Pine, EABL DMS and Upfield DataEdge (the principal filter applies; the other filters do not). The chart counts every customer called in the month, the same basis as the Coverage page, so it reads lower than the tables, which leave out customers that did not buy in the last 90 days (the active outlets). A year-to-date strike would flatten these swings.</Note>
        </div>
      </SectionCard>

      <Block title="A. By principal" note="Strike per principal this month. Principals with no call outcome (Leverage's Unilever, Promasidor) are shown without a rate.">
        <StrikeGroupTable groups={data.byPrincipal} labelHeader="Principal" label={(k) => keyLabel(k, "principal")} />
      </Block>
      <Block title="B. Direct vs distributor, by channel">
        <StrikeGroupTable groups={data.byRouteChannel} labelHeader="Route · channel" label={(k) => `${keyLabel(k, "route_class")} · ${keyLabel(k, "channel")}`} />
      </Block>
      <Block title="C. By region (GPS-cleaned)">
        <StrikeGroupTable groups={data.byRegion} labelHeader="Region" label={(k) => keyLabel(k, "region")} />
      </Block>
      <Block title="D. By rep region and sub-region">
        <StrikeGroupTable groups={data.byRepRegion} labelHeader="Rep region · sub-region" label={(k) => keyLabel(k, "rep_region", "rep_subregion")} />
      </Block>
      <Block title="E. By team leader">
        <StrikeGroupTable groups={data.byTeamLeader} labelHeader="Team leader" label={(k) => keyLabel(k, "team_leader")} />
      </Block>
      <Block title="F. By recency: days since the last purchase" note="Strike usually falls as an outlet goes quiet: a falling strike is an early warning of lapsing.">
        <StrikeGroupTable groups={data.byRecency} labelHeader="Recency" label={(k) => keyLabel(k, "recency")} />
      </Block>
      <Block title="G. By ordering consistency (30-day periods bought out of the last 3)">
        <StrikeGroupTable groups={data.byConsistency} labelHeader="Periods bought" label={(k) => `${keyLabel(k, "consistency")} of 3`} />
      </Block>
      <Block title="H. By buying tenure">
        <StrikeGroupTable groups={data.byTenure} labelHeader="Buying tenure" label={(k) => keyLabel(k, "tenure")} />
      </Block>
      <Block title="I. By outlet segment">
        <StrikeGroupTable groups={data.bySegment} labelHeader="Segment" label={(k) => keyLabel(k, "segment")} />
      </Block>
      <Block title="J. By tier (true average invoice)">
        <StrikeGroupTable groups={data.byTier} labelHeader="Tier" label={(k) => keyLabel(k, "tier")} />
      </Block>

      <SectionCard title="K. Low-strike outlets to fix" action={<CsvLink href={`/api/universe-analysis?section=targets&action=Fix%20strike%20rate&format=csv&${query}`} />}>
        <div className="mb-3">
          <Note>
            Outlet-principal pairs called at least {data.lowStrikeRule.minCalls} times in the last {data.lowStrikeRule.windowMonths} months to {month} with a strike rate under {data.lowStrikeRule.thresholdPct}%. One month alone is too thin to flag an outlet, so this list looks at three.
          </Note>
        </div>
        <TableWrap>
          <Thead>
            <Th>Outlet</Th>
            <Th>Master ID</Th>
            <Th>Principal</Th>
            <Th>Rep</Th>
            <Th align="right">Strike (3 mo)</Th>
            <Th align="right">YTD sales (KES)</Th>
            <Th>Why</Th>
          </Thead>
          <tbody>
            {data.lowStrike.slice(0, 100).map((t) => (
              <tr key={`${t.masterOutletId}-${t.principals}`}>
                <Td>{t.outlet}</Td>
                <Td>{t.masterOutletId}</Td>
                <Td>{t.principals}</Td>
                <Td>{t.rep ?? "–"}</Td>
                <Td align="right">{plainPct(t.strikeRatePct)}</Td>
                <Td align="right">{count(t.salesYtd)}</Td>
                <Td>{t.why}</Td>
              </tr>
            ))}
            {data.lowStrike.length === 0 ? (
              <tr>
                <Td className="text-muted">No outlet meets the rule this month.</Td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
