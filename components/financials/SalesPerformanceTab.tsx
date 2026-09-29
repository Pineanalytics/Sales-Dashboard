"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { money } from "@/components/views/ReceivablesView";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import {
  summarizeSalesForPeriod,
  summarizeSalesByPrincipal,
  getCurrentMonthPeriod,
  getPriorYearPeriod,
  type PeriodSelection,
} from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import type { DebtAttribution } from "@/lib/financeDebtAttribution";
import type { PrincipalGpTarget } from "@/lib/financeGpTarget";

// Fixed top-5 principal set (given directly, not derived by any ranking) —
// shown versus their own target, rolled up across every location-split raw
// Principal string that belongs to the same brand (e.g. "EABL-Nyeri" and
// "EABL-Nyahururu" both fold into "Eabl").
const TOP_5_PRINCIPALS = ["Mars", "Suntory", "Upfield", "Eabl", "Weetabix"];

export function SalesPerformanceTab({
  dataset,
  selectedPrincipalKey,
  gpTargets,
  receivablesOutstanding,
  debtAttribution,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  gpTargets: PrincipalGpTarget[];
  receivablesOutstanding: number;
  debtAttribution: DebtAttribution;
}) {
  const mtdPeriod = getCurrentMonthPeriod(dataset);
  const ytdPeriod: PeriodSelection = { kind: "YTD", year: mtdPeriod.year, month: mtdPeriod.month };
  const lyspPeriod = getPriorYearPeriod(mtdPeriod);

  const mtd = summarizeSalesForPeriod(dataset, mtdPeriod, selectedPrincipalKey);
  const ytd = summarizeSalesForPeriod(dataset, ytdPeriod, selectedPrincipalKey);
  const lysp = summarizeSalesForPeriod(dataset, lyspPeriod, selectedPrincipalKey);

  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, mtdPeriod).values());
  const top5 = TOP_5_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rows = byPrincipal.filter((p) => normalizePrincipalKey(p.principal) === key);
    let revenue = 0;
    let target = 0;
    let hasTarget = false;
    for (const r of rows) {
      revenue += r.revenue;
      if (r.target !== null) {
        target += r.target;
        hasTarget = true;
      }
    }
    const achievementPct = hasTarget && target > 0 ? Math.round((revenue / target) * 1000) / 10 : null;
    return { label, revenue, target: hasTarget ? target : null, achievementPct };
  });
  const costOfSales = [...byPrincipal].sort((a, b) => b.cogs - a.cogs);

  // GP targets are per-principal (Target.grossProfitTarget /
  // grossMarginTargetPct, entered on /targets-overview) — "All Principals"
  // blends them the same way Sales vs Target blends revenue targets: sum the
  // GP value targets, and weight the margin target by each principal's own
  // revenue target so a low-volume principal's % doesn't skew the blend.
  const matchingGpTargets = selectedPrincipalKey ? gpTargets.filter((g) => g.principal === selectedPrincipalKey) : gpTargets;
  let gpValueTargetSum = 0;
  let hasGpValueTarget = false;
  let weightedMarginSum = 0;
  let marginWeightSum = 0;
  for (const g of matchingGpTargets) {
    if (g.grossProfitTarget !== null) {
      gpValueTargetSum += g.grossProfitTarget;
      hasGpValueTarget = true;
    }
    if (g.grossMarginTargetPct !== null) {
      const weight = g.valueTarget ?? 0;
      weightedMarginSum += g.grossMarginTargetPct * weight;
      marginWeightSum += weight;
    }
  }
  const marginTargetPct = marginWeightSum > 0 ? weightedMarginSum / marginWeightSum * 100 : null;
  const gpValueAchievementPct = hasGpValueTarget && gpValueTargetSum > 0 ? Math.round((mtd.grossProfit / gpValueTargetSum) * 1000) / 10 : null;

  const stockValue = dataset.stockTotal.value;
  const workingCapital = stockValue + receivablesOutstanding;

  // Matches the accent-bordered SectionCard + icon-bearing KpiCard + @container
  // grid convention used across Commercial Performance / Executive Summary
  // (see SalesSummaryPanel.tsx, CoveragePanel.tsx, FinancialsPanel.tsx) rather
  // than the plain top-border card / icon-less ReceivablesKpi style the
  // original 4 Financials tabs use — this tab is new, so it follows the
  // dashboard-wide "slide" look instead.
  return (
    <div id="sales-performance" className="@container flex flex-col gap-4">
      <SectionCard title="Sales performance summary" accent="blue">
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-6">
          <KpiCard accent="revenue" label="Revenue (MTD)" value={formatCompact(mtd.revenue)} />
          <KpiCard accent="mission" label="Vs Running Target" value={<span className={tierTextClass[achievementTier(mtd.achievementPct)]}>{formatPercent(mtd.achievementPct)}</span>} sublabel={mtd.target !== null ? `Target ${formatCompact(mtd.target)}` : "N/T"} />
          <KpiCard accent="revenue" label="Revenue (YTD)" value={formatCompact(ytd.revenue)} />
          <KpiCard accent="revenue" label="LYSP Revenue" value={formatCompact(lysp.revenue)} sublabel={`${lyspPeriod.month} ${lyspPeriod.year}`} />
          <KpiCard accent="growth" label="Gross Profit (MTD)" value={formatCompact(mtd.grossProfit)} />
          <KpiCard
            accent="growth"
            label="GP Margin vs Target"
            value={<span className={tierTextClass[marginTier(mtd.grossMarginPct)]}>{formatPercent(mtd.grossMarginPct)}</span>}
            sublabel={marginTargetPct !== null ? `Target ${marginTargetPct.toFixed(1)}%` : "No target set — /targets-overview"}
          />
          {hasGpValueTarget ? (
            <KpiCard
              accent="mission"
              label="GP vs Value Target"
              value={<span className={tierTextClass[achievementTier(gpValueAchievementPct)]}>{formatPercent(gpValueAchievementPct)}</span>}
              sublabel={`Target ${formatCompact(gpValueTargetSum)}`}
            />
          ) : null}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Top 5 principals vs Target" accent="purple" action={<span className="text-xs text-muted">Mars, Suntory, Upfield, Eabl, Weetabix</span>}>
          <TableWrap>
            <Thead><Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Target</Th><Th align="right">Achievement</Th></Thead>
            <tbody>
              {top5.map((p) => (
                <tr key={p.label}>
                  <Td>{p.label}</Td>
                  <Td align="right">{formatCompact(p.revenue)}</Td>
                  <Td align="right">{p.target !== null ? formatCompact(p.target) : "N/T"}</Td>
                  <Td align="right"><span className={tierTextClass[achievementTier(p.achievementPct)]}>{formatPercent(p.achievementPct)}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </SectionCard>

        <SectionCard title="Cost of Sales per principal" accent="navy">
          <TableWrap>
            <Thead><Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Cost of Sales</Th><Th align="right">COGS %</Th></Thead>
            <tbody>
              {costOfSales.map((p) => (
                <tr key={p.principalKey}>
                  <Td>{p.principal}</Td>
                  <Td align="right">{formatCompact(p.revenue)}</Td>
                  <Td align="right">{formatCompact(p.cogs)}</Td>
                  <Td align="right">{p.revenue > 0 ? formatPercent((p.cogs / p.revenue) * 100) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </SectionCard>
      </div>

      <SectionCard title="Debt by principal" accent="red" action={<span className="text-xs text-muted">{debtAttribution.windowLabel} purchase mix, prorated across live outstanding</span>}>
        <TableWrap>
          <Thead><Th>Principal</Th><Th align="right">Debt</Th><Th align="right">% of overall debt</Th></Thead>
          <tbody>
            {debtAttribution.byPrincipal.map((p) => (
              <tr key={p.principal}>
                <Td>{p.principal}</Td>
                <Td align="right">{money(p.debt)}</Td>
                <Td align="right">{formatPercent(p.pctOfTotal)}</Td>
              </tr>
            ))}
            {debtAttribution.byPrincipal.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">No outstanding debt to attribute.</td></tr> : null}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Working capital & stock" accent="green">
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
          <KpiCard accent="mission" label="Working capital (proxy)" value={money(workingCapital)} sublabel="Stock value + Receivables outstanding" />
          <KpiCard accent="revenue" label="Stock opening balance (value)" value={money(stockValue)} sublabel="Company-wide" />
          <KpiCard accent="coverage" label="Stock opening balance (volume)" value={formatCompact(dataset.stockTotal.volume)} sublabel="Cases" />
        </div>
      </SectionCard>
    </div>
  );
}
