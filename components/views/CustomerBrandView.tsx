"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber, formatPercent, marginTier } from "@/lib/format";
import type { CustomerPortfolioSummary, CustomerTier } from "@/lib/customerPortfolio";
import type { PeriodSelection } from "@/lib/timeIntelligence";
import { CHART_COLORS, CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const TIER_STYLE: Record<CustomerTier, { tier: "good" | "warn" | "neutral" | "bad"; note: string }> = {
  Strategic: { tier: "good", note: "First 80% of positive revenue" },
  Growth: { tier: "warn", note: "Next 15% of positive revenue" },
  "Long Tail": { tier: "neutral", note: "Remaining positive revenue" },
  Adjustment: { tier: "bad", note: "Non-positive net revenue" },
};

function growthLabel(value: number | null, current: number) {
  if (value === null) return current > 0 ? "New" : "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function growthClass(value: number | null, current: number) {
  if (value === null) return current > 0 ? "text-emerald-700" : "text-muted";
  return value >= 0 ? "text-emerald-700" : "text-red-600";
}

export function CustomerBrandView({ portfolio, selectedPrincipalKey, period, latestMonthLabel, previousMonthLabel }: {
  portfolio: CustomerPortfolioSummary;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
  latestMonthLabel: string;
  previousMonthLabel: string;
}) {
  const [view, setView] = useState<"customers" | "brands">("customers");
  const [tierFilter, setTierFilter] = useState<CustomerTier | "All">("All");
  const [search, setSearch] = useState("");
  const { totals, customers, brands, principals, tierSummary } = portfolio;
  const visibleCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return customers.filter((customer) =>
      (tierFilter === "All" || customer.tier === tierFilter) &&
      (!query || customer.customerName.toLocaleLowerCase().includes(query) || customer.principals.some((principal) => principal.toLocaleLowerCase().includes(query)))
    );
  }, [customers, search, tierFilter]);

  const topCustomersChart = customers.slice(0, 10).map((customer) => ({ name: customer.customerName, value: customer.revenue }));
  const topBrandTotal = brands.slice(0, 7).reduce((sum, brand) => sum + brand.revenue, 0);
  const doughnutData = [...brands.slice(0, 7).map((brand) => ({ name: brand.name, value: brand.revenue })), { name: "Others", value: Math.max(0, totals.revenue - topBrandTotal) }].filter((item) => item.value > 0);
  const priorYear = String(Number(period.year) - 1);

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-blue">Customer & Brand Portfolio</p>
          <h2 className="text-lg font-bold text-brand-navy">Customer contribution, tiering and growth</h2>
          <p className="text-xs text-muted-strong">{selectedPrincipalKey ?? "All principals"} · {period.kind} {period.year}{period.month ? ` through ${period.month}` : ""}</p>
        </div>
        <div className="inline-flex rounded-full bg-background-elevated p-0.5">
          <button onClick={() => setView("customers")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "customers" ? "bg-secondary-blue text-white" : "text-muted-strong"}`}>Customer analysis</button>
          <button onClick={() => setView("brands")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "brands" ? "bg-secondary-blue text-white" : "text-muted-strong"}`}>Brands & products</button>
        </div>
      </div>

      {view === "customers" ? (
        <>
          <KpiGrid>
            <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={formatCompact(totals.revenue)} sublabel={`${formatNumber(totals.customerCount)} buying customers`} />
            <KpiCard accent="growth" label={`${period.kind} vs ${priorYear} full period`} value={growthLabel(totals.yoyGrowthPct, totals.revenue)} sublabel={`${formatCompact(totals.priorYearRevenue)} full prior-year equivalent`} />
            <KpiCard accent="growth" label="Vs LYSP" value={growthLabel(totals.vsLyspGrowthPct, totals.revenue)} sublabel={totals.lyspRevenue === null ? "No matching prior-year daily data" : `vs ${formatCompact(totals.lyspRevenue)} through day ${totals.comparisonDay}`} />
            <KpiCard accent="growth" label={`${latestMonthLabel} MoM`} value={growthLabel(totals.momGrowthPct, totals.latestMonthRevenue)} sublabel={`Day 1–${totals.comparisonDay ?? "end"} vs ${formatCompact(totals.previousMonthRevenue)} in ${previousMonthLabel}`} />
            <KpiCard accent="quarter" label="Top 10 Concentration" value={formatPercent(totals.topTenSharePct)} sublabel="Share of selected-period revenue" />
            <KpiCard accent="coverage" label="Customer Movement" value={`${totals.newCustomers} new`} sublabel={`${totals.retainedCustomers} retained · ${totals.lapsedCustomers} lapsed`} />
          </KpiGrid>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tierSummary.map((item) => (
              <div key={item.tier} className="rounded-xl border border-border bg-surface p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2"><Badge tier={TIER_STYLE[item.tier].tier}>{item.tier}</Badge><span className="text-xs text-muted">{item.customerCount} customers</span></div>
                <p className="mt-2 text-xl font-bold tabular-nums text-brand-navy">{formatCompact(item.revenue)}</p>
                <p className="text-xs text-muted-strong">{formatPercent(item.revenueSharePct)} of revenue · {TIER_STYLE[item.tier].note}</p>
              </div>
            ))}
          </div>

          <ChartGrid>
            <SectionCard title="Top 10 Customers by Revenue" action={<span className="text-xs text-muted">Selected period</span>}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topCustomersChart} layout="vertical" margin={{ top: 4, right: 14, left: 24, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} /><XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(value) => formatCompact(Number(value))} /><YAxis type="category" dataKey="name" width={125} stroke={CHART_AXIS_COLOR} fontSize={10} tick={{ width: 120 }} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatCompact(Number(value))} /><Bar dataKey="value" fill="var(--primary-blue)" radius={[0, 6, 6, 0]} /></BarChart>
              </ResponsiveContainer>
            </SectionCard>
            <SectionCard title="Revenue Contribution by Principal" action={<span className="text-xs text-muted">Customer portfolio context</span>}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={principals.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 14, left: 18, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} /><XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(value) => formatCompact(Number(value))} /><YAxis type="category" dataKey="name" width={120} stroke={CHART_AXIS_COLOR} fontSize={10} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatCompact(Number(value))} /><Bar dataKey="revenue" fill="var(--secondary-blue)" radius={[0, 6, 6, 0]} /></BarChart>
              </ResponsiveContainer>
            </SectionCard>
          </ChartGrid>

          <SectionCard title="Ranked Customer Portfolio" action={<span className="text-xs text-muted">MoM: day 1–{totals.comparisonDay ?? "end"} · YoY: full selected period</span>}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {(["All", "Strategic", "Growth", "Long Tail", "Adjustment"] as const).map((tier) => <button key={tier} onClick={() => setTierFilter(tier)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${tierFilter === tier ? "border-secondary-blue bg-secondary-blue text-white" : "border-border bg-surface text-muted-strong hover:bg-background-elevated"}`}>{tier}</button>)}
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer or principal…" className="ml-auto min-w-[240px] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" />
            </div>
            <TableWrap>
              <Thead><Th align="center">Rank</Th><Th>Customer</Th><Th align="center">Tier</Th><Th>Principal(s)</Th><Th align="right">Products</Th><Th align="right">Revenue</Th><Th align="right">Contribution</Th><Th align="right">Cum. Share</Th><Th align="right">MoM Growth</Th><Th align="right">YoY Growth</Th><Th align="right">GP Margin</Th></Thead>
              <tbody>
                {visibleCustomers.slice(0, 100).map((customer) => (
                  <tr key={`${customer.rank}-${customer.customerName}`}>
                    <Td align="center" className="text-muted">{customer.rank}</Td><Td><span className="font-semibold text-brand-navy">{customer.customerName}</span></Td><Td align="center"><Badge tier={TIER_STYLE[customer.tier].tier}>{customer.tier}</Badge></Td>
                    <Td title={customer.principals.join(", ")}>{customer.principals.slice(0, 2).join(", ")}{customer.principals.length > 2 ? ` +${customer.principals.length - 2}` : ""}</Td><Td align="right">{customer.brandCount}</Td><Td align="right">{formatCompact(customer.revenue)}</Td><Td align="right">{formatPercent(customer.contributionPct)}</Td><Td align="right">{formatPercent(customer.cumulativeContributionPct)}</Td>
                    <Td align="right" className={growthClass(customer.momGrowthPct, customer.latestMonthRevenue)}>{growthLabel(customer.momGrowthPct, customer.latestMonthRevenue)}</Td><Td align="right" className={growthClass(customer.yoyGrowthPct, customer.revenue)}>{growthLabel(customer.yoyGrowthPct, customer.revenue)}</Td><Td align="right"><Badge tier={marginTier(customer.grossMarginPct)}>{formatPercent(customer.grossMarginPct)}</Badge></Td>
                  </tr>
                ))}
                {visibleCustomers.length === 0 ? <tr><td className="py-8 text-center text-muted" colSpan={11}>No customers match this filter.</td></tr> : null}
              </tbody>
            </TableWrap>
            {visibleCustomers.length > 100 ? <p className="mt-2 text-right text-xs text-muted">Showing the first 100 of {visibleCustomers.length} matching customers.</p> : null}
          </SectionCard>
          <p className="text-xs text-muted">Customer matching normalizes case and repeated spaces only; punctuation variants remain separate SAP accounts. Tiering excludes non-positive revenue from the Pareto denominator. YoY compares the full selected YTD with the full equivalent prior-year YTD; LYSP and MoM use the same elapsed calendar day.</p>
        </>
      ) : (
        <>
          <KpiGrid>
            <KpiCard accent="revenue" label={`${period.kind} Revenue`} value={formatCompact(totals.revenue)} /><KpiCard accent="revenue" label={`${period.kind} Cases`} value={formatNumber(totals.cases)} /><KpiCard accent="quarter" label="Gross Margin" value={formatPercent(totals.grossMarginPct)} /><KpiCard accent="growth" label="Top Customer" value={customers[0]?.customerName ?? "—"} sublabel={customers[0] ? formatCompact(customers[0].revenue) : undefined} /><KpiCard accent="mission" label="Top Brand / Product" value={brands[0]?.name ?? "—"} sublabel={brands[0] ? formatCompact(brands[0].revenue) : undefined} />
          </KpiGrid>
          <ChartGrid>
            <SectionCard title="Brand / Product Revenue Share"><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={doughnutData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={100} paddingAngle={2}>{doughnutData.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatCompact(Number(value))} /><Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-strong)" }} /></PieChart></ResponsiveContainer></SectionCard>
            <SectionCard title="Top 10 Customers by Revenue"><ResponsiveContainer width="100%" height={300}><BarChart data={topCustomersChart} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} /><XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={70} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={11} tickFormatter={(value) => formatCompact(Number(value))} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatCompact(Number(value))} /><Bar dataKey="value" fill="var(--primary-blue)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></SectionCard>
          </ChartGrid>
          <SectionCard title="Brand / Product Performance" action={<span className="text-xs text-muted">SAP item-level performance for the selected period and principal</span>}>
            <TableWrap><Thead><Th>Brand / Product</Th><Th align="right">Cases</Th><Th align="right">Revenue</Th><Th align="right">Gross Profit</Th><Th align="center">Margin</Th><Th align="center">Contribution</Th></Thead><tbody>{brands.map((brand) => <tr key={brand.name}><Td><span className="font-semibold text-brand-navy">{brand.name}</span></Td><Td align="right">{formatNumber(brand.cases)}</Td><Td align="right">{formatCompact(brand.revenue)}</Td><Td align="right">{formatCompact(brand.grossProfit)}</Td><Td align="center"><Badge tier={marginTier(brand.grossMarginPct)}>{formatPercent(brand.grossMarginPct)}</Badge></Td><Td align="center">{formatPercent(brand.contributionPct)}</Td></tr>)}<TotalRow><Td>Total</Td><Td align="right">{formatNumber(totals.cases)}</Td><Td align="right">{formatCompact(totals.revenue)}</Td><Td align="right">{formatCompact(totals.grossProfit)}</Td><Td align="center"><Badge tier={marginTier(totals.grossMarginPct)}>{formatPercent(totals.grossMarginPct)}</Badge></Td><Td align="center">{formatPercent(totals.revenue !== 0 ? 100 : null)}</Td></TotalRow></tbody></TableWrap>
          </SectionCard>
        </>
      )}
    </div>
  );
}
