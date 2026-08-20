"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDashboardStore } from "@/lib/store";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartGrid, KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { TableWrap, Td, Th, Thead, TotalRow } from "@/components/ui/Table";
import { RoleToggle, type RoleFilter } from "@/components/ui/RoleToggle";
import { formatCompact, formatNumber } from "@/lib/format";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { BuildingShop20Regular } from "@fluentui/react-icons";

interface ActiveOutletSummary {
  totals: { distinctOutlets: number; transactions: number; sales: number; primaryOutlets: number; secondaryOutlets: number; availableOutlets: number };
  executiveRows: { principal: string; salesRole: string; outlets: number; transactions: number; sales: number }[];
  channelRows: { name: string; value: number }[];
  subChannelRows: { name: string; value: number }[];
  monthly: { year: string; month: string; monthIndex: number; principal: string; salesRole: string; distinctOutlets: number; transactions: number; sales: number }[];
  topOutlets: { principal: string; customerId: string; outletName: string; channel: string; subChannel: string; salesRole: string; timesBought: number; frequencyBand: string; sales: number; mostRecentRep: string | null }[];
}

const TOP_N_OUTLETS = 100;

function month3(month: string): string {
  return month.slice(0, 3);
}

export default function ActiveOutletsPage() {
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [summary, setSummary] = useState<ActiveOutletSummary | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const params = new URLSearchParams({ role: roleFilter });
        if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
        const res = await fetch(`/api/active-outlets?${params}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load Active Outlets data.");
        if (!cancelled) {
          setSummary(body);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPrincipalKey, roleFilter]);

  if (status === "loading") return <FullPageSpinner label="Loading Active Outlets…" />;
  if (status === "error" || !summary) {
    return <EmptyState icon={<BuildingShop20Regular className="h-10 w-10" />} title="Couldn't load Active Outlets" description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule." />;
  }
  if (summary.totals.availableOutlets === 0) {
    return <EmptyState icon={<BuildingShop20Regular className="h-10 w-10" />} title="No Active Outlets data yet" description="This page populates automatically from the direct-SQL sync (scripts/db-bridge/active-outlets), which runs hourly — no manual upload needed." />;
  }

  const channelData = summary.channelRows.map((row, index) => ({ ...row, fill: CHART_COLORS[index % CHART_COLORS.length] }));
  const subChannelData = summary.subChannelRows.map((row, index) => ({ ...row, fill: CHART_COLORS[index % CHART_COLORS.length] }));
  const monthOrder = Array.from(new Set(summary.monthly.map((m) => m.monthIndex))).sort((a, b) => a - b);
  const trendData = monthOrder.map((monthIndex) => {
    const rows = summary.monthly.filter((m) => m.monthIndex === monthIndex);
    return {
      name: month3(rows[0]?.month ?? ""),
      Primary: rows.filter((m) => m.salesRole === "Primary Sales").reduce((sum, m) => sum + m.distinctOutlets, 0),
      Secondary: rows.filter((m) => m.salesRole === "Secondary Sales").reduce((sum, m) => sum + m.distinctOutlets, 0),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Sales Role"><RoleToggle value={roleFilter} onChange={setRoleFilter} /></SectionCard>

      <KpiGrid>
        <KpiCard accent="coverage" label={roleFilter === "all" ? "Distinct Buying Outlets (YTD)" : `Distinct ${roleFilter === "Primary Sales" ? "Primary" : "Secondary"} Outlets (YTD)`} value={<AnimatedValue value={summary.totals.distinctOutlets} format={formatNumber} />} />
        <KpiCard accent="coverage" label="Purchase Transactions (YTD)" value={<AnimatedValue value={summary.totals.transactions} format={formatNumber} />} />
        {roleFilter === "all" ? <><KpiCard accent="growth" label="Primary Outlets" value={<AnimatedValue value={summary.totals.primaryOutlets} format={formatNumber} />} /><KpiCard accent="quarter" label="Secondary Outlets" value={<AnimatedValue value={summary.totals.secondaryOutlets} format={formatNumber} />} /></> : null}
        <KpiCard accent="revenue" label="YTD Sales" value={<AnimatedValue value={summary.totals.sales} format={formatCompact} />} />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title="Distinct Buying Outlets by Month (Primary vs Secondary)">
          <ResponsiveContainer width="100%" height={300}><LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} /><XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={11} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Legend wrapperStyle={{ fontSize: 11 }} />{roleFilter !== "Secondary Sales" ? <Line type="monotone" dataKey="Primary" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} /> : null}{roleFilter !== "Primary Sales" ? <Line type="monotone" dataKey="Secondary" stroke={CHART_COLORS[1]} strokeWidth={2.5} dot={{ r: 3 }} /> : null}</LineChart></ResponsiveContainer>
        </SectionCard>
        <SectionCard title="Distinct Outlets by Channel">
          <ResponsiveContainer width="100%" height={300}><BarChart data={channelData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} /><XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} /><YAxis type="category" dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} width={90} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Bar dataKey="value" radius={[0, 6, 6, 0]}>{channelData.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar></BarChart></ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Distinct Outlets by Sub Channel">
        <ResponsiveContainer width="100%" height={280}><BarChart data={subChannelData} margin={{ top: 8, right: 8, left: 0, bottom: 60 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} /><XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={70} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={11} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{subChannelData.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar></BarChart></ResponsiveContainer>
      </SectionCard>

      <SectionCard title="Active Outlets by Principal &amp; Sales Role"><TableWrap><Thead><Th>Principal</Th><Th>Sales Role</Th><Th align="right">Distinct Outlets</Th><Th align="right">Transactions</Th><Th align="right">Sales</Th></Thead><tbody>{summary.executiveRows.map((row) => <tr key={`${row.principal}|${row.salesRole}`}><Td>{row.principal}</Td><Td>{row.salesRole}</Td><Td align="right">{formatNumber(row.outlets)}</Td><Td align="right">{formatNumber(row.transactions)}</Td><Td align="right">{formatCompact(row.sales)}</Td></tr>)}<TotalRow><Td>Total</Td><Td>—</Td><Td align="right">{formatNumber(summary.totals.distinctOutlets)}</Td><Td align="right">{formatNumber(summary.totals.transactions)}</Td><Td align="right">{formatCompact(summary.totals.sales)}</Td></TotalRow></tbody></TableWrap></SectionCard>

      <SectionCard title="Outlet Detail" action={<span className="text-xs text-muted">Top {Math.min(TOP_N_OUTLETS, summary.totals.availableOutlets)} of {summary.totals.availableOutlets} by sales</span>}><TableWrap><Thead><Th>Outlet</Th><Th>Principal</Th><Th>Channel</Th><Th>Sub Channel</Th><Th>Sales Role</Th><Th align="right">Times Bought</Th><Th>Frequency</Th><Th>Most Recent Rep</Th><Th align="right">Sales</Th></Thead><tbody>{summary.topOutlets.map((outlet) => <tr key={`${outlet.principal}|${outlet.customerId}`}><Td title={outlet.outletName}>{outlet.outletName}</Td><Td>{outlet.principal}</Td><Td>{outlet.channel}</Td><Td>{outlet.subChannel}</Td><Td>{outlet.salesRole}</Td><Td align="right">{formatNumber(outlet.timesBought)}</Td><Td>{outlet.frequencyBand}</Td><Td>{outlet.mostRecentRep ?? "—"}</Td><Td align="right">{formatCompact(outlet.sales)}</Td></tr>)}</tbody></TableWrap></SectionCard>
    </div>
  );
}
