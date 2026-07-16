"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { useDashboardStore } from "@/lib/store";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { RoleToggle, type RoleFilter } from "@/components/ui/RoleToggle";
import { formatCompact, formatNumber } from "@/lib/format";
import { CHART_COLORS, CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { BuildingShop20Regular } from "@fluentui/react-icons";

interface ActiveOutletRow {
  year: string;
  principal: string;
  customerId: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  salesRole: string;
  timesBought: number;
  purchaseDays: number;
  activeMonths: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  frequencyBand: string;
  sales: number;
  qty: number;
  mostRecentRep: string | null;
  mostRecentRepGroup: string | null;
}

interface ActiveOutletMonthlyRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  salesRole: string;
  distinctOutlets: number;
  transactions: number;
  sales: number;
}

const TOP_N_OUTLETS = 100;

function month3(month: string): string {
  return month.slice(0, 3);
}

export default function ActiveOutletsPage() {
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [outlets, setOutlets] = useState<ActiveOutletRow[]>([]);
  const [monthly, setMonthly] = useState<ActiveOutletMonthlyRow[]>([]);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/active-outlets", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load Active Outlets data.");
        if (!cancelled) {
          setOutlets(body.outlets);
          setMonthly(body.monthly);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") return <FullPageSpinner label="Loading Active Outlets…" />;
  if (status === "error") {
    return (
      <EmptyState
        icon={<BuildingShop20Regular className="h-10 w-10" />}
        title="Couldn't load Active Outlets"
        description="Try refreshing the page. If this keeps happening, the direct-SQL sync may be behind schedule."
      />
    );
  }
  if (outlets.length === 0) {
    return (
      <EmptyState
        icon={<BuildingShop20Regular className="h-10 w-10" />}
        title="No Active Outlets data yet"
        description="This page populates automatically from the direct-SQL sync (scripts/db-bridge/active-outlets), which runs every 10 minutes — no manual upload needed."
      />
    );
  }

  const filteredOutlets = selectedPrincipalKey ? outlets.filter((o) => o.principal === selectedPrincipalKey) : outlets;
  const filteredMonthly = selectedPrincipalKey ? monthly.filter((m) => m.principal === selectedPrincipalKey) : monthly;
  const roleFilteredOutlets = roleFilter === "all" ? filteredOutlets : filteredOutlets.filter((o) => o.salesRole === roleFilter);

  // TRUE distinct re-count across every principal/role in scope — never derived by
  // summing the per-principal/per-role buckets below, which can double-count an
  // outlet that bought under both Primary and Secondary for the same principal.
  const distinctOutlets = new Set(roleFilteredOutlets.map((o) => o.customerId)).size;
  const totalTransactions = roleFilteredOutlets.reduce((s, o) => s + o.timesBought, 0);
  const primaryOutlets = new Set(filteredOutlets.filter((o) => o.salesRole === "Primary Sales").map((o) => o.customerId)).size;
  const secondaryOutlets = new Set(filteredOutlets.filter((o) => o.salesRole === "Secondary Sales").map((o) => o.customerId)).size;
  const totalSales = roleFilteredOutlets.reduce((s, o) => s + o.sales, 0);

  // Executive-Summary-style table: one row per Principal x Sales Role. Each
  // ActiveOutlet row is already exactly one distinct outlet for that principal
  // (unique on year+principal+customerId), so counting rows here is a correct
  // distinct-outlet count per bucket — no double-counting within a bucket.
  interface ExecRow {
    principal: string;
    salesRole: string;
    outlets: number;
    transactions: number;
    sales: number;
  }
  const execMap = new Map<string, ExecRow>();
  for (const o of roleFilteredOutlets) {
    const key = `${o.principal}|${o.salesRole}`;
    let row = execMap.get(key);
    if (!row) {
      row = { principal: o.principal, salesRole: o.salesRole, outlets: 0, transactions: 0, sales: 0 };
      execMap.set(key, row);
    }
    row.outlets += 1;
    row.transactions += o.timesBought;
    row.sales += o.sales;
  }
  const execRows = Array.from(execMap.values()).sort((a, b) => a.principal.localeCompare(b.principal) || a.salesRole.localeCompare(b.salesRole));

  // Channel / Sub Channel breakdown — distinct outlets, re-counted per bucket.
  function distinctByKey(rows: ActiveOutletRow[], keyOf: (r: ActiveOutletRow) => string) {
    const map = new Map<string, Set<string>>();
    for (const o of rows) {
      const k = keyOf(o);
      if (!map.has(k)) map.set(k, new Set());
      map.get(k)!.add(o.customerId);
    }
    return Array.from(map.entries())
      .map(([name, set], i) => ({ name, value: set.size, fill: CHART_COLORS[i % CHART_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
  }
  const channelData = distinctByKey(roleFilteredOutlets, (o) => o.channel);
  const subChannelData = distinctByKey(roleFilteredOutlets, (o) => o.subChannel);

  // Monthly trend — Primary and Secondary kept as two separate lines rather than
  // summed, since summing them would double-count an outlet with purchases under
  // both roles for the same principal+month (same caveat the source script itself
  // documents for its Executive Summary role subtotals).
  const monthOrder = Array.from(new Set(filteredMonthly.map((m) => m.monthIndex))).sort((a, b) => a - b);
  const trendData = monthOrder.map((idx) => {
    const rowsForMonth = filteredMonthly.filter((m) => m.monthIndex === idx);
    const monthName = rowsForMonth[0]?.month ?? "";
    const primary = rowsForMonth.filter((m) => m.salesRole === "Primary Sales").reduce((s, m) => s + m.distinctOutlets, 0);
    const secondary = rowsForMonth.filter((m) => m.salesRole === "Secondary Sales").reduce((s, m) => s + m.distinctOutlets, 0);
    return { name: month3(monthName), Primary: primary, Secondary: secondary };
  });

  const drillDownRows = [...roleFilteredOutlets].sort((a, b) => b.sales - a.sales).slice(0, TOP_N_OUTLETS);

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Sales Role">
        <RoleToggle value={roleFilter} onChange={setRoleFilter} />
      </SectionCard>

      <KpiGrid>
        <KpiCard
          accent="coverage"
          label={roleFilter === "all" ? "Distinct Buying Outlets (YTD)" : `Distinct ${roleFilter === "Primary Sales" ? "Primary" : "Secondary"} Outlets (YTD)`}
          value={<AnimatedValue value={distinctOutlets} format={formatNumber} />}
        />
        <KpiCard accent="coverage" label="Purchase Transactions (YTD)" value={<AnimatedValue value={totalTransactions} format={formatNumber} />} />
        {roleFilter === "all" ? (
          <>
            <KpiCard accent="growth" label="Primary Outlets" value={<AnimatedValue value={primaryOutlets} format={formatNumber} />} />
            <KpiCard accent="quarter" label="Secondary Outlets" value={<AnimatedValue value={secondaryOutlets} format={formatNumber} />} />
          </>
        ) : null}
        <KpiCard accent="revenue" label="YTD Sales" value={<AnimatedValue value={totalSales} format={formatCompact} />} />
      </KpiGrid>

      <ChartGrid>
        <SectionCard title="Distinct Buying Outlets by Month (Primary vs Secondary)">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {roleFilter !== "Secondary Sales" ? <Line type="monotone" dataKey="Primary" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} /> : null}
              {roleFilter !== "Primary Sales" ? <Line type="monotone" dataKey="Secondary" stroke={CHART_COLORS[1]} strokeWidth={2.5} dot={{ r: 3 }} /> : null}
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Distinct Outlets by Channel">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={channelData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
              <XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis type="category" dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} width={90} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {channelData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>

      <SectionCard title="Distinct Outlets by Sub Channel">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={subChannelData} margin={{ top: 8, right: 8, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={70} />
            <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
            <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {subChannelData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <SectionCard title="Active Outlets by Principal &amp; Sales Role">
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th>Sales Role</Th>
            <Th align="right">Distinct Outlets</Th>
            <Th align="right">Transactions</Th>
            <Th align="right">Sales</Th>
          </Thead>
          <tbody>
            {execRows.map((r) => (
              <tr key={`${r.principal}|${r.salesRole}`}>
                <Td>{r.principal}</Td>
                <Td>{r.salesRole}</Td>
                <Td align="right">{formatNumber(r.outlets)}</Td>
                <Td align="right">{formatNumber(r.transactions)}</Td>
                <Td align="right">{formatCompact(r.sales)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">{formatNumber(distinctOutlets)}</Td>
              <Td align="right">{formatNumber(totalTransactions)}</Td>
              <Td align="right">{formatCompact(totalSales)}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard
        title="Outlet Detail"
        action={<span className="text-xs text-muted">Top {Math.min(TOP_N_OUTLETS, filteredOutlets.length)} of {filteredOutlets.length} by sales</span>}
      >
        <TableWrap>
          <Thead>
            <Th>Outlet</Th>
            <Th>Principal</Th>
            <Th>Channel</Th>
            <Th>Sub Channel</Th>
            <Th>Sales Role</Th>
            <Th align="right">Times Bought</Th>
            <Th>Frequency</Th>
            <Th>Most Recent Rep</Th>
            <Th align="right">Sales</Th>
          </Thead>
          <tbody>
            {drillDownRows.map((o) => (
              <tr key={`${o.principal}|${o.customerId}`}>
                <Td title={o.outletName}>{o.outletName}</Td>
                <Td>{o.principal}</Td>
                <Td>{o.channel}</Td>
                <Td>{o.subChannel}</Td>
                <Td>{o.salesRole}</Td>
                <Td align="right">{formatNumber(o.timesBought)}</Td>
                <Td>{o.frequencyBand}</Td>
                <Td>{o.mostRecentRep ?? "—"}</Td>
                <Td align="right">{formatCompact(o.sales)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
