"use client";

import { useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { money } from "@/components/views/ReceivablesView";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import { aggregateStockByPrincipal } from "@/lib/stock";
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
const TOP_5_KEYS = new Set(TOP_5_PRINCIPALS.map(normalizePrincipalKey));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function SalesPerformanceTab({
  dataset,
  selectedPrincipalKey,
  gpTargets,
  overallMarginTargetPct,
  receivablesOutstanding,
  debtAttribution,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  gpTargets: PrincipalGpTarget[];
  /** The company-wide margin target in percent, shown when no principal is selected. */
  overallMarginTargetPct: number;
  receivablesOutstanding: number;
  debtAttribution: DebtAttribution;
}) {
  const mtdPeriod = getCurrentMonthPeriod(dataset);
  const ytdPeriod: PeriodSelection = { kind: "YTD", year: mtdPeriod.year, month: mtdPeriod.month };
  const lyspPeriod = getPriorYearPeriod(mtdPeriod);

  const mtd = summarizeSalesForPeriod(dataset, mtdPeriod, selectedPrincipalKey);
  const ytd = summarizeSalesForPeriod(dataset, ytdPeriod, selectedPrincipalKey);
  const lysp = summarizeSalesForPeriod(dataset, lyspPeriod, selectedPrincipalKey);

  // This table is a fixed "whole portfolio" report (top 5 + everyone else +
  // grand total) — it always reflects every principal regardless of the
  // dashboard's own selectedPrincipalKey filter, the same way Debt by
  // Principal below it already does.
  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, mtdPeriod).values());
  const top5 = TOP_5_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rows = byPrincipal.filter((p) => normalizePrincipalKey(p.principal) === key);
    let revenue = 0;
    let target = 0;
    let hasTarget = false;
    let grossProfit = 0;
    for (const r of rows) {
      revenue += r.revenue;
      grossProfit += r.grossProfit;
      if (r.target !== null) {
        target += r.target;
        hasTarget = true;
      }
    }
    const achievementPct = hasTarget && target > 0 ? round1((revenue / target) * 100) : null;
    const marginPct = revenue > 0 ? round1((grossProfit / revenue) * 100) : null;
    return { label, revenue, target: hasTarget ? target : null, achievementPct, grossProfit, marginPct };
  });

  const otherRows = byPrincipal.filter((p) => !TOP_5_KEYS.has(normalizePrincipalKey(p.principal))).sort((a, b) => b.revenue - a.revenue);
  const othersAgg = otherRows.reduce(
    (acc, p) => ({
      revenue: acc.revenue + p.revenue,
      target: acc.target + (p.target ?? 0),
      hasTarget: acc.hasTarget || p.target !== null,
      grossProfit: acc.grossProfit + p.grossProfit,
    }),
    { revenue: 0, target: 0, hasTarget: false, grossProfit: 0 }
  );
  const othersAchievementPct = othersAgg.hasTarget && othersAgg.target > 0 ? round1((othersAgg.revenue / othersAgg.target) * 100) : null;
  const othersMarginPct = othersAgg.revenue > 0 ? round1((othersAgg.grossProfit / othersAgg.revenue) * 100) : null;
  const [othersExpanded, setOthersExpanded] = useState(false);

  const totalRevenue = top5.reduce((s, p) => s + p.revenue, 0) + othersAgg.revenue;
  const totalTarget = top5.reduce((s, p) => s + (p.target ?? 0), 0) + othersAgg.target;
  const totalHasTarget = top5.some((p) => p.target !== null) || othersAgg.hasTarget;
  const totalGrossProfit = top5.reduce((s, p) => s + p.grossProfit, 0) + othersAgg.grossProfit;
  const totalAchievementPct = totalHasTarget && totalTarget > 0 ? round1((totalRevenue / totalTarget) * 100) : null;
  const totalMarginPct = totalRevenue > 0 ? round1((totalGrossProfit / totalRevenue) * 100) : null;

  // GP targets are per-principal (Target.grossProfitTarget /
  // grossMarginTargetPct, entered on /targets-overview) — "All Principals"
  // blends them the same way Sales vs Target blends revenue targets: sum the
  // GP value targets, and weight the margin target by each principal's own
  // revenue target so a low-volume principal's % doesn't skew the blend.
  const matchingGpTargets = selectedPrincipalKey ? gpTargets.filter((g) => g.principal === selectedPrincipalKey) : gpTargets;
  let weightedMarginSum = 0;
  let marginWeightSum = 0;
  for (const g of matchingGpTargets) {
    if (g.grossMarginTargetPct !== null) {
      const weight = g.valueTarget ?? 0;
      weightedMarginSum += g.grossMarginTargetPct * weight;
      marginWeightSum += weight;
    }
  }
  // With no principal selected the company target applies (10% by default), not the blend of the brand targets.
  const blendedMarginTargetPct = marginWeightSum > 0 ? (weightedMarginSum / marginWeightSum) * 100 : null;
  const marginTargetPct = selectedPrincipalKey ? blendedMarginTargetPct : overallMarginTargetPct;

  // Stock + debt, side by side per principal — same top-5/other-principals/
  // totals shape as the sales table above, reusing lib/stock.ts's rollups
  // (already normalized-brand-keyed, same as Operations & Logistics' Top 5
  // Stock Status) and the debt attribution already computed for this page.
  const stockRollups = aggregateStockByPrincipal(dataset);
  const debtByKey = new Map(debtAttribution.byPrincipal.map((d) => [normalizePrincipalKey(d.principal), d.debt]));
  const stockTop5 = TOP_5_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rollup = stockRollups.find((r) => r.key === key) ?? null;
    return { label, key, rollup, debt: debtByKey.get(key) ?? 0 };
  });
  const stockOtherRollups = stockRollups.filter((r) => !TOP_5_KEYS.has(r.key)).sort((a, b) => b.value - a.value);
  const stockOthersAgg = stockOtherRollups.reduce(
    (acc, r) => ({ value: acc.value + r.value, rrWeekValue: acc.rrWeekValue + r.rrWeekValue, debt: acc.debt + (debtByKey.get(r.key) ?? 0) }),
    { value: 0, rrWeekValue: 0, debt: 0 }
  );
  const [stockOthersExpanded, setStockOthersExpanded] = useState(false);
  const stockTotalValue = stockTop5.reduce((s, r) => s + (r.rollup?.value ?? 0), 0) + stockOthersAgg.value;
  const stockTotalRrWeek = stockTop5.reduce((s, r) => s + (r.rollup?.rrWeekValue ?? 0), 0) + stockOthersAgg.rrWeekValue;
  const stockTotalDebt = stockTop5.reduce((s, r) => s + r.debt, 0) + stockOthersAgg.debt;
  const stockTotalDaysCover = stockTotalRrWeek > 0 ? round1((stockTotalValue / stockTotalRrWeek) * 7) : 0;

  const workingCapital = dataset.stockTotal.value + receivablesOutstanding;

  // Matches the accent-bordered SectionCard + icon-bearing KpiCard + @container
  // grid convention used across Commercial Performance / Executive Summary
  // (see SalesSummaryPanel.tsx, CoveragePanel.tsx, FinancialsPanel.tsx) rather
  // than the plain top-border card / icon-less ReceivablesKpi style the
  // original 4 Financials tabs use — this tab is new, so it follows the
  // dashboard-wide "slide" look instead. Fixed at exactly 6 cards (no
  // conditional extra card) so this row always renders as one single line
  // at @lg width, rather than sometimes wrapping a 7th card.
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
        </div>
      </SectionCard>

      <SectionCard title="Top 5 principals vs Target" accent="purple" action={<span className="text-xs text-muted">Mars, Suntory, Upfield, Eabl, Weetabix</span>}>
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Target</Th>
            <Th align="right">Achievement</Th>
            <Th align="right">GP</Th>
            <Th align="right">GP Margin %</Th>
          </Thead>
          <tbody>
            {top5.map((p) => (
              <tr key={p.label}>
                <Td>{p.label}</Td>
                <Td align="right">{formatCompact(p.revenue)}</Td>
                <Td align="right">{p.target !== null ? formatCompact(p.target) : "N/T"}</Td>
                <Td align="right"><span className={tierTextClass[achievementTier(p.achievementPct)]}>{formatPercent(p.achievementPct)}</span></Td>
                <Td align="right">{formatCompact(p.grossProfit)}</Td>
                <Td align="right"><span className={tierTextClass[marginTier(p.marginPct)]}>{formatPercent(p.marginPct)}</span></Td>
              </tr>
            ))}
            <tr className="bg-background-elevated/60">
              <Td>
                <button type="button" onClick={() => setOthersExpanded((v) => !v)} className="text-xs font-semibold text-secondary-blue hover:text-primary-blue">
                  Other Principals ({otherRows.length}) {othersExpanded ? "▲" : "▼"}
                </button>
              </Td>
              <Td align="right">{formatCompact(othersAgg.revenue)}</Td>
              <Td align="right">{othersAgg.hasTarget ? formatCompact(othersAgg.target) : "N/T"}</Td>
              <Td align="right"><span className={tierTextClass[achievementTier(othersAchievementPct)]}>{formatPercent(othersAchievementPct)}</span></Td>
              <Td align="right">{formatCompact(othersAgg.grossProfit)}</Td>
              <Td align="right"><span className={tierTextClass[marginTier(othersMarginPct)]}>{formatPercent(othersMarginPct)}</span></Td>
            </tr>
            {othersExpanded && otherRows.map((p) => (
              <tr key={p.principalKey} className="text-muted-strong">
                <Td className="pl-6">{p.principal}</Td>
                <Td align="right">{formatCompact(p.revenue)}</Td>
                <Td align="right">{p.target !== null ? formatCompact(p.target) : "N/T"}</Td>
                <Td align="right"><span className={tierTextClass[achievementTier(p.achievementPct)]}>{formatPercent(p.achievementPct)}</span></Td>
                <Td align="right">{formatCompact(p.grossProfit)}</Td>
                <Td align="right"><span className={tierTextClass[marginTier(p.grossMarginPct)]}>{formatPercent(p.grossMarginPct)}</span></Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total (all principals)</Td>
              <Td align="right">{formatCompact(totalRevenue)}</Td>
              <Td align="right">{totalHasTarget ? formatCompact(totalTarget) : "N/T"}</Td>
              <Td align="right">{formatPercent(totalAchievementPct)}</Td>
              <Td align="right">{formatCompact(totalGrossProfit)}</Td>
              <Td align="right">{formatPercent(totalMarginPct)}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>

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

      <SectionCard title="Working capital" accent="green">
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-1">
          <KpiCard accent="mission" label="Working capital (proxy)" value={money(workingCapital)} sublabel="Stock value + Receivables outstanding" />
        </div>
      </SectionCard>

      <SectionCard title="Stock opening balance & debt by principal" accent="navy">
        <TableWrap>
          <Thead>
            <Th>Principal</Th>
            <Th align="right">Opening Value</Th>
            <Th align="right">Run Rate (weekly)</Th>
            <Th align="right">Days Cover</Th>
            <Th align="right">Debt</Th>
          </Thead>
          <tbody>
            {stockTop5.map((r) => (
              <tr key={r.label}>
                <Td>{r.label}</Td>
                <Td align="right">{r.rollup ? formatCompact(r.rollup.value) : "—"}</Td>
                <Td align="right">{r.rollup ? formatCompact(r.rollup.rrWeekValue) : "—"}</Td>
                <Td align="right">{r.rollup ? r.rollup.daysStock.toFixed(1) : "—"}</Td>
                <Td align="right">{money(r.debt)}</Td>
              </tr>
            ))}
            <tr className="bg-background-elevated/60">
              <Td>
                <button type="button" onClick={() => setStockOthersExpanded((v) => !v)} className="text-xs font-semibold text-secondary-blue hover:text-primary-blue">
                  Other Principals ({stockOtherRollups.length}) {stockOthersExpanded ? "▲" : "▼"}
                </button>
              </Td>
              <Td align="right">{formatCompact(stockOthersAgg.value)}</Td>
              <Td align="right">{formatCompact(stockOthersAgg.rrWeekValue)}</Td>
              <Td align="right">{stockOthersAgg.rrWeekValue > 0 ? round1((stockOthersAgg.value / stockOthersAgg.rrWeekValue) * 7).toFixed(1) : "—"}</Td>
              <Td align="right">{money(stockOthersAgg.debt)}</Td>
            </tr>
            {stockOthersExpanded && stockOtherRollups.map((r) => (
              <tr key={r.key} className="text-muted-strong">
                <Td className="pl-6">{r.name}</Td>
                <Td align="right">{formatCompact(r.value)}</Td>
                <Td align="right">{formatCompact(r.rrWeekValue)}</Td>
                <Td align="right">{r.daysStock.toFixed(1)}</Td>
                <Td align="right">{money(debtByKey.get(r.key) ?? 0)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total (all principals)</Td>
              <Td align="right">{formatCompact(stockTotalValue)}</Td>
              <Td align="right">{formatCompact(stockTotalRrWeek)}</Td>
              <Td align="right">{stockTotalDaysCover.toFixed(1)}</Td>
              <Td align="right">{money(stockTotalDebt)}</Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
