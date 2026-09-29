"use client";

import { Presenter20Regular, PresenterOff20Regular } from "@fluentui/react-icons";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { money } from "@/components/views/ReceivablesView";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import { aggregateStockByPrincipal } from "@/lib/stock";
import { summarizeSalesForPeriod, summarizeSalesByPrincipal, getCurrentMonthPeriod } from "@/lib/timeIntelligence";
import { useDashboardStore } from "@/lib/store";
import type { ReceivablesDashboard } from "@/lib/receivables";
import type { DebtAttribution } from "@/lib/financeDebtAttribution";
import type { PrincipalGpTarget } from "@/lib/financeGpTarget";

const TOP_5_PRINCIPALS = ["Mars", "Suntory", "Upfield", "Eabl", "Weetabix"];
const TOP_5_KEYS = new Set(TOP_5_PRINCIPALS.map(normalizePrincipalKey));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A condensed, presentation-ready two-slide summary of the Finance module —
 *  static (no drill-down/expand affordances, unlike the full /financials
 *  tabs), listed in the sidebar directly below Executive Summary. Reuses the
 *  exact same selectors as the full module (summarizeSalesForPeriod,
 *  aggregateStockByPrincipal, debtAttribution) so the two never drift apart. */
export function FinancePresentationView({
  receivables,
  gpTargets,
  debtAttribution,
}: {
  receivables: ReceivablesDashboard | null;
  gpTargets: PrincipalGpTarget[];
  debtAttribution: DebtAttribution;
}) {
  const dataset = useDashboardStore((s) => s.dataset);
  const presentationMode = useDashboardStore((s) => s.presentationMode);
  const setPresentationMode = useDashboardStore((s) => s.setPresentationMode);

  if (!dataset) return null;

  const mtdPeriod = getCurrentMonthPeriod(dataset);
  const mtd = summarizeSalesForPeriod(dataset, mtdPeriod, null);
  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, mtdPeriod).values());

  const top5 = TOP_5_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rows = byPrincipal.filter((p) => normalizePrincipalKey(p.principal) === key);
    let revenue = 0, target = 0, hasTarget = false, grossProfit = 0;
    for (const r of rows) {
      revenue += r.revenue;
      grossProfit += r.grossProfit;
      if (r.target !== null) { target += r.target; hasTarget = true; }
    }
    const achievementPct = hasTarget && target > 0 ? round1((revenue / target) * 100) : null;
    return { label, revenue, target: hasTarget ? target : null, achievementPct, grossProfit };
  });
  const otherRows = byPrincipal.filter((p) => !TOP_5_KEYS.has(normalizePrincipalKey(p.principal)));
  const othersAgg = otherRows.reduce(
    (acc, p) => ({ revenue: acc.revenue + p.revenue, target: acc.target + (p.target ?? 0), hasTarget: acc.hasTarget || p.target !== null, grossProfit: acc.grossProfit + p.grossProfit }),
    { revenue: 0, target: 0, hasTarget: false, grossProfit: 0 }
  );
  const totalRevenue = top5.reduce((s, p) => s + p.revenue, 0) + othersAgg.revenue;
  const totalTarget = top5.reduce((s, p) => s + (p.target ?? 0), 0) + othersAgg.target;
  const totalHasTarget = top5.some((p) => p.target !== null) || othersAgg.hasTarget;
  const totalAchievementPct = totalHasTarget && totalTarget > 0 ? round1((totalRevenue / totalTarget) * 100) : null;

  let weightedMarginSum = 0, marginWeightSum = 0;
  for (const g of gpTargets) {
    if (g.grossMarginTargetPct !== null) {
      const weight = g.valueTarget ?? 0;
      weightedMarginSum += g.grossMarginTargetPct * weight;
      marginWeightSum += weight;
    }
  }
  const marginTargetPct = marginWeightSum > 0 ? (weightedMarginSum / marginWeightSum) * 100 : null;

  const receivablesOutstanding = receivables?.ledgerBalance ?? 0;
  const workingCapital = dataset.stockTotal.value + receivablesOutstanding;
  const currentDebt = receivables ? receivables.buckets.Current + receivables.buckets["1–30 days"] : 0;
  const overdueOver30 = receivables ? receivables.buckets["31–60 days"] + receivables.buckets["61–90 days"] + receivables.buckets["Over 90 days"] : 0;

  const stockRollups = aggregateStockByPrincipal(dataset);
  const debtByKey = new Map(debtAttribution.byPrincipal.map((d) => [normalizePrincipalKey(d.principal), d.debt]));
  const stockTop5 = TOP_5_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rollup = stockRollups.find((r) => r.key === key) ?? null;
    return { label, rollup, debt: debtByKey.get(key) ?? 0 };
  });
  const stockOthers = stockRollups.filter((r) => !TOP_5_KEYS.has(r.key));
  const stockOthersAgg = stockOthers.reduce(
    (acc, r) => ({ value: acc.value + r.value, debt: acc.debt + (debtByKey.get(r.key) ?? 0) }),
    { value: 0, debt: 0 }
  );
  const stockTotalValue = stockTop5.reduce((s, r) => s + (r.rollup?.value ?? 0), 0) + stockOthersAgg.value;
  const stockTotalDebt = stockTop5.reduce((s, r) => s + r.debt, 0) + stockOthersAgg.debt;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-strong">Finance Presentation · {mtdPeriod.month} {mtdPeriod.year}</p>
        <button
          onClick={() => setPresentationMode(!presentationMode)}
          className="no-print flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-strong transition-colors duration-300 hover:bg-accent-blue-soft hover:text-primary-blue"
          aria-pressed={presentationMode}
        >
          {presentationMode ? <PresenterOff20Regular /> : <Presenter20Regular />}
          {presentationMode ? "Exit presentation mode" : "Presentation mode"}
        </button>
      </div>

      {/* Slide 1: Sales & Gross Profit */}
      <SectionCard title="Slide 1 — Sales & Gross Profit" accent="blue">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-6">
            <KpiCard accent="revenue" label="Revenue (MTD)" value={formatCompact(mtd.revenue)} />
            <KpiCard accent="mission" label="Vs Running Target" value={<span className={tierTextClass[achievementTier(mtd.achievementPct)]}>{formatPercent(mtd.achievementPct)}</span>} sublabel={mtd.target !== null ? `Target ${formatCompact(mtd.target)}` : "N/T"} />
            <KpiCard accent="growth" label="Gross Profit (MTD)" value={formatCompact(mtd.grossProfit)} />
            <KpiCard
              accent="growth"
              label="GP Margin vs Target"
              value={<span className={tierTextClass[marginTier(mtd.grossMarginPct)]}>{formatPercent(mtd.grossMarginPct)}</span>}
              sublabel={marginTargetPct !== null ? `Target ${marginTargetPct.toFixed(1)}%` : "No target set"}
            />
            <KpiCard accent="mission" label="Working Capital" value={money(workingCapital)} sublabel="Stock + Receivables" />
            <KpiCard accent="coverage" label="Stock Opening Value" value={money(dataset.stockTotal.value)} sublabel="Company-wide" />
          </div>

          <TableWrap>
            <Thead><Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Target</Th><Th align="right">Achievement</Th><Th align="right">GP</Th></Thead>
            <tbody>
              {top5.map((p) => (
                <tr key={p.label}>
                  <Td>{p.label}</Td>
                  <Td align="right">{formatCompact(p.revenue)}</Td>
                  <Td align="right">{p.target !== null ? formatCompact(p.target) : "N/T"}</Td>
                  <Td align="right"><span className={tierTextClass[achievementTier(p.achievementPct)]}>{formatPercent(p.achievementPct)}</span></Td>
                  <Td align="right">{formatCompact(p.grossProfit)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="text-muted-strong">All Other Principals ({otherRows.length})</Td>
                <Td align="right">{formatCompact(othersAgg.revenue)}</Td>
                <Td align="right">{othersAgg.hasTarget ? formatCompact(othersAgg.target) : "N/T"}</Td>
                <Td align="right">—</Td>
                <Td align="right">{formatCompact(othersAgg.grossProfit)}</Td>
              </tr>
              <TotalRow>
                <Td>Total (all principals)</Td>
                <Td align="right">{formatCompact(totalRevenue)}</Td>
                <Td align="right">{totalHasTarget ? formatCompact(totalTarget) : "N/T"}</Td>
                <Td align="right">{formatPercent(totalAchievementPct)}</Td>
                <Td align="right">{formatCompact(top5.reduce((s, p) => s + p.grossProfit, 0) + othersAgg.grossProfit)}</Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </div>
      </SectionCard>

      {/* Slide 2: Debt & Stock */}
      <SectionCard title="Slide 2 — Debt & Stock" accent="red">
        <div className="flex flex-col gap-4">
          {receivables ? (
            <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
              <KpiCard accent="mission" label="Overall Debt" value={money(receivables.ledgerBalance)} sublabel={`${receivables.customerCount} customers`} />
              <KpiCard accent="growth" label="Current Debt" value={money(currentDebt)} sublabel="Within 30 days" />
              <KpiCard accent="quarter" label="Overdue Debt" value={money(overdueOver30)} sublabel="Over 30 days" />
              <KpiCard accent="coverage" label="Over 90 Days" value={money(receivables.buckets["Over 90 days"])} sublabel="Collection risk" />
            </div>
          ) : (
            <p className="text-sm text-muted">Receivables have not synced yet.</p>
          )}

          <TableWrap>
            <Thead><Th>Principal</Th><Th align="right">Stock Value</Th><Th align="right">Debt</Th></Thead>
            <tbody>
              {stockTop5.map((r) => (
                <tr key={r.label}>
                  <Td>{r.label}</Td>
                  <Td align="right">{r.rollup ? formatCompact(r.rollup.value) : "—"}</Td>
                  <Td align="right">{money(r.debt)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="text-muted-strong">All Other Principals ({stockOthers.length})</Td>
                <Td align="right">{formatCompact(stockOthersAgg.value)}</Td>
                <Td align="right">{money(stockOthersAgg.debt)}</Td>
              </tr>
              <TotalRow>
                <Td>Total (all principals)</Td>
                <Td align="right">{formatCompact(stockTotalValue)}</Td>
                <Td align="right">{money(stockTotalDebt)}</Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        </div>
      </SectionCard>
    </div>
  );
}
