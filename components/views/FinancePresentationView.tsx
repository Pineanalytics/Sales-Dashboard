"use client";

import { useState } from "react";
import { Presenter20Regular, PresenterOff20Regular } from "@fluentui/react-icons";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { money } from "@/components/views/ReceivablesView";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import { aggregateStockByPrincipal } from "@/lib/stock";
import { summarizeSalesForPeriod, summarizeSalesByPrincipal, getCurrentMonthPeriod, getMtdTargetPacing } from "@/lib/timeIntelligence";
import { useDashboardStore } from "@/lib/store";
import type { ReceivablesDashboard } from "@/lib/receivables";
import type { PayablesDashboard, PayablesByPrincipalRow } from "@/lib/payables";
import type { DebtAttribution } from "@/lib/financeDebtAttribution";
import type { PrincipalGpTarget } from "@/lib/financeGpTarget";
import type { AgeingTrendForMonth, AgeingSnapshotPoint } from "@/lib/receivablesAgeing";

const TOP_5_PRINCIPALS = ["Mars", "Suntory", "Upfield", "Eabl", "Weetabix"];
const TOP_5_KEYS = new Set(TOP_5_PRINCIPALS.map(normalizePrincipalKey));
const round1 = (n: number) => Math.round(n * 10) / 10;

function ageingRowTotal(point: AgeingSnapshotPoint) {
  if (!point.buckets) return null;
  const current = point.buckets.current + point.buckets.days30;
  return { current, days60: point.buckets.days60, days90: point.buckets.days90, daysOver90: point.buckets.daysOver90, total: current + point.buckets.days60 + point.buckets.days90 + point.buckets.daysOver90 };
}

/** A condensed, presentation-ready two-slide summary of the Finance module —
 *  static (no drill-down/expand affordances, unlike the full /financials
 *  tabs), listed in the sidebar directly below Executive Summary. Reuses the
 *  exact same selectors as the full module (summarizeSalesForPeriod,
 *  aggregateStockByPrincipal, debtAttribution, ageing snapshots) so the two
 *  never drift apart. Both slides share one KPI-row shape (6 cards on one
 *  @container line) for visual consistency. */
export function FinancePresentationView({
  receivables,
  payables,
  payablesByPrincipal,
  gpTargets,
  debtAttribution,
  ageingTrend,
}: {
  receivables: ReceivablesDashboard | null;
  payables: PayablesDashboard | null;
  payablesByPrincipal: PayablesByPrincipalRow[];
  gpTargets: PrincipalGpTarget[];
  debtAttribution: DebtAttribution;
  ageingTrend: AgeingTrendForMonth | null;
}) {
  const dataset = useDashboardStore((s) => s.dataset);
  const presentationMode = useDashboardStore((s) => s.presentationMode);
  const setPresentationMode = useDashboardStore((s) => s.setPresentationMode);
  const [activeSlide, setActiveSlide] = useState<1 | 2>(1);

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
    const marginPct = revenue > 0 ? round1((grossProfit / revenue) * 100) : null;
    return { label, revenue, target: hasTarget ? target : null, achievementPct, grossProfit, marginPct };
  });
  const otherRows = byPrincipal.filter((p) => !TOP_5_KEYS.has(normalizePrincipalKey(p.principal)));
  const othersAgg = otherRows.reduce(
    (acc, p) => ({ revenue: acc.revenue + p.revenue, target: acc.target + (p.target ?? 0), hasTarget: acc.hasTarget || p.target !== null, grossProfit: acc.grossProfit + p.grossProfit }),
    { revenue: 0, target: 0, hasTarget: false, grossProfit: 0 }
  );
  const othersMarginPct = othersAgg.revenue > 0 ? round1((othersAgg.grossProfit / othersAgg.revenue) * 100) : null;
  const totalRevenue = top5.reduce((s, p) => s + p.revenue, 0) + othersAgg.revenue;
  const totalTarget = top5.reduce((s, p) => s + (p.target ?? 0), 0) + othersAgg.target;
  const totalHasTarget = top5.some((p) => p.target !== null) || othersAgg.hasTarget;
  const totalAchievementPct = totalHasTarget && totalTarget > 0 ? round1((totalRevenue / totalTarget) * 100) : null;
  const totalGrossProfit = top5.reduce((s, p) => s + p.grossProfit, 0) + othersAgg.grossProfit;
  const totalMarginPct = totalRevenue > 0 ? round1((totalGrossProfit / totalRevenue) * 100) : null;

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
  const payablesOutstanding = payables?.ledgerBalance ?? 0;
  // Genuine Net Working Capital once Payables has synced at least once;
  // before that, fall back to the original Stock + Receivables proxy (no
  // Payables figure existed at all until this was built) rather than
  // silently treating an un-synced zero as "no payables owed".
  const workingCapital = dataset.stockTotal.value + receivablesOutstanding - (payables ? payablesOutstanding : 0);
  const currentDebt = receivables ? receivables.buckets.Current + receivables.buckets["1–30 days"] : 0;
  const overdueOver30 = receivables ? receivables.buckets["31–60 days"] + receivables.buckets["61–90 days"] + receivables.buckets["Over 90 days"] : 0;

  // DSO = closing AR balance ÷ period sales × days elapsed in that period —
  // elapsed (not the full month) so a partial MTD period doesn't get
  // overstated by a full 30-day multiplier against only a few days of sales.
  const mtdPacing = getMtdTargetPacing(mtdPeriod);
  const dso = receivables && mtd.revenue > 0 && mtdPacing && mtdPacing.elapsedDays > 0
    ? round1((receivablesOutstanding / mtd.revenue) * mtdPacing.elapsedDays)
    : null;

  const stockRollups = aggregateStockByPrincipal(dataset);
  const debtByKey = new Map(debtAttribution.byPrincipal.map((d) => [normalizePrincipalKey(d.principal), d.debt]));
  // Only Mars/Suntory/Upfield/Eabl/Weetabix have a confirmed vendor-code
  // mapping (see lib/payables.ts's VENDOR_PRINCIPAL_CODES — vendor legal
  // names often don't match the principal they distribute for, so this isn't
  // guessable from stockRollups' own keys the way debt/stock are). Every
  // other vendor's payable rolls into "All Other Principals" below, same
  // convention as stock/debt.
  const payableByKey = new Map(payablesByPrincipal.map((p) => [p.principalKey, p.outstanding]));
  const mappedPayablesTotal = payablesByPrincipal.reduce((s, p) => s + p.outstanding, 0);
  const stockTop5 = TOP_5_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rollup = stockRollups.find((r) => r.key === key) ?? null;
    return { label, rollup, debt: debtByKey.get(key) ?? 0, payable: payableByKey.get(key) ?? 0 };
  });
  const stockOthers = stockRollups.filter((r) => !TOP_5_KEYS.has(r.key));
  const stockOthersAgg = stockOthers.reduce(
    (acc, r) => ({ value: acc.value + r.value, rrWeekValue: acc.rrWeekValue + r.rrWeekValue }),
    { value: 0, rrWeekValue: 0 }
  );
  const stockTotalValue = stockTop5.reduce((s, r) => s + (r.rollup?.value ?? 0), 0) + stockOthersAgg.value;
  const stockTotalRrWeek = stockTop5.reduce((s, r) => s + (r.rollup?.rrWeekValue ?? 0), 0) + stockOthersAgg.rrWeekValue;
  // "All Other Principals" debt = total debt minus the 5 mapped principals'
  // share, not a sum over stockOthers' own debtByKey entries — a principal
  // can carry debt (it sold on credit) with zero physical stock on hand
  // right now, or a customer can fall into debtAttribution's "Unattributed"
  // bucket (no BrandCustomerActual match), and neither shows up in
  // stockRollups at all. Deriving "Other" as the remainder keeps this
  // table's Total reconciled to the page's own Overall Debt KPI exactly,
  // the same convention already used for the Payable column below.
  const top5Debt = stockTop5.reduce((s, r) => s + r.debt, 0);
  const othersDebt = debtAttribution.totalDebt - top5Debt;
  const stockTotalDebt = debtAttribution.totalDebt;
  // "Other Principals" payable = every vendor NOT individually mapped —
  // total payables minus whatever was attributed to the 5 mapped principals
  // above, not a stockRollups-keyed sum (no vendor-to-stock-principal join
  // exists for the long tail).
  const othersPayable = payables ? payables.ledgerBalance - mappedPayablesTotal : 0;
  const stockTotalPayable = payables ? payables.ledgerBalance : mappedPayablesTotal;
  const stockOthersDaysCover = stockOthersAgg.rrWeekValue > 0 ? round1((stockOthersAgg.value / stockOthersAgg.rrWeekValue) * 7) : 0;
  const stockTotalDaysCover = stockTotalRrWeek > 0 ? round1((stockTotalValue / stockTotalRrWeek) * 7) : 0;
  // Net Working Capital per row, same formula as the page-level KPI (Stock +
  // Receivables − Payables) applied at the principal level; "—" until
  // Payables has synced at least once, matching every other Payable-derived
  // cell in this table.
  const nwc = (stockValue: number, debt: number, payable: number) => stockValue + debt - payable;

  // Full weekly breakdown, same as the main Ageing Trend tab — last month's
  // closing balance, then every week of the current month distinctly (not
  // condensed down to a single "latest week" row).
  const ageingRows: AgeingSnapshotPoint[] = ageingTrend ? [ageingTrend.lastMonth, ...ageingTrend.weeks] : [];

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

      <div className="no-print flex rounded-full bg-background-elevated p-1 w-fit" role="tablist" aria-label="Finance Presentation slides">
        {([1, 2] as const).map((slideNumber) => (
          <button
            key={slideNumber}
            type="button"
            role="tab"
            aria-selected={activeSlide === slideNumber}
            onClick={() => setActiveSlide(slideNumber)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              activeSlide === slideNumber ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-sm" : "text-muted-strong hover:text-primary-blue"
            }`}
          >
            Slide {slideNumber} — {slideNumber === 1 ? "Sales & Gross Profit" : "Debt & Stock"}
          </button>
        ))}
      </div>

      {/* Slide 1: Sales & Gross Profit */}
      <div id="finance-slide-1" className={`@container ${activeSlide === 1 ? "" : "hidden"}`}>
        <SectionCard title="Slide 1 — Sales & Gross Profit" accent="blue">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-6">
              <KpiCard accent="revenue" label="Revenue (MTD)" value={formatCompact(mtd.revenue)} />
              <KpiCard accent="mission" label="Vs Running Target" value={<span className={tierTextClass[achievementTier(mtd.achievementPct)]}>{formatPercent(mtd.achievementPct)}</span>} sublabel={mtd.target !== null ? `Target ${formatCompact(mtd.target)}` : "N/T"} />
              <KpiCard accent="growth" label="Gross Profit (MTD)" value={formatCompact(mtd.grossProfit)} />
              <KpiCard accent="growth" label="Gross Margin %" value={<span className={tierTextClass[marginTier(mtd.grossMarginPct)]}>{formatPercent(mtd.grossMarginPct)}</span>} sublabel="Actual, company-wide" />
              <KpiCard
                accent="mission"
                label="GP Margin vs Target"
                value={<span className={tierTextClass[marginTier(mtd.grossMarginPct)]}>{formatPercent(mtd.grossMarginPct)}</span>}
                sublabel={marginTargetPct !== null ? `Target ${marginTargetPct.toFixed(1)}%` : "No target set"}
              />
              <KpiCard accent="coverage" label="Net Working Capital" value={money(workingCapital)} sublabel={payables ? "Stock + Receivables − Payables" : "Stock + Receivables (Payables not synced)"} />
            </div>

            <TableWrap>
              <Thead><Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Target</Th><Th align="right">Achievement</Th><Th align="right">GP</Th><Th align="right">GP Margin %</Th></Thead>
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
                <tr>
                  <Td className="text-muted-strong">All Other Principals ({otherRows.length})</Td>
                  <Td align="right">{formatCompact(othersAgg.revenue)}</Td>
                  <Td align="right">{othersAgg.hasTarget ? formatCompact(othersAgg.target) : "N/T"}</Td>
                  <Td align="right">—</Td>
                  <Td align="right">{formatCompact(othersAgg.grossProfit)}</Td>
                  <Td align="right">{formatPercent(othersMarginPct)}</Td>
                </tr>
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
          </div>
        </SectionCard>
      </div>

      {/* Slide 2: Debt & Stock */}
      <div id="finance-slide-2" className={`@container ${activeSlide === 2 ? "" : "hidden"}`}>
        <SectionCard title="Slide 2 — Debt & Stock" accent="red">
          <div className="flex flex-col gap-4">
            {receivables ? (
              <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-8">
                <KpiCard accent="mission" label="Overall Debt" value={money(receivables.ledgerBalance)} sublabel={`${receivables.customerCount} customers`} />
                <KpiCard accent="growth" label="Current Debt" value={money(currentDebt)} sublabel="Within 30 days" />
                <KpiCard accent="quarter" label="Overdue Debt" value={money(overdueOver30)} sublabel="Over 30 days" />
                <KpiCard accent="coverage" label="Over 90 Days" value={money(receivables.buckets["Over 90 days"])} sublabel="Collection risk" />
                <KpiCard accent="mission" label="DSO" value={dso !== null ? `${dso.toFixed(1)}d` : "—"} sublabel="Days Sales Outstanding" />
                <KpiCard accent="quarter" label="Accounts Payable" value={payables ? money(payables.ledgerBalance) : "N/A"} sublabel={payables ? `${payables.vendorCount} vendors` : "Not yet synced"} />
                <KpiCard accent="revenue" label="Stock Opening Value" value={money(dataset.stockTotal.value)} sublabel="Company-wide" />
                <KpiCard accent="mission" label="Net Working Capital" value={money(workingCapital)} sublabel={payables ? "Stock + Receivables − Payables" : "Stock + Receivables (Payables not synced)"} />
              </div>
            ) : (
              <p className="text-sm text-muted">Receivables have not synced yet.</p>
            )}

            {ageingRows.length > 0 ? (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Ageing trend — last month closing, then each week distinctly</h4>
                <TableWrap>
                  <Thead><Th>Period</Th><Th align="right">Total</Th><Th align="right">Current (0–30 days)</Th><Th align="right">60 days</Th><Th align="right">90 days</Th><Th align="right">Over 90 days</Th></Thead>
                  <tbody>
                    {ageingRows.map((point) => {
                      const t = ageingRowTotal(point);
                      return (
                        <tr key={point.label}>
                          <Td>{point.label}</Td>
                          <Td align="right" className="font-semibold">{t ? money(t.total) : "—"}</Td>
                          {(["current", "days60", "days90", "daysOver90"] as const).map((key) => (
                            <Td key={key} align="right">
                              {t ? (
                                <>
                                  {money(t[key])}
                                  <span className="ml-1 text-xs text-muted">({t.total > 0 ? formatPercent((t[key] / t.total) * 100) : "—"})</span>
                                </>
                              ) : "—"}
                            </Td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              </div>
            ) : null}

            <TableWrap>
              <Thead><Th>Principal</Th><Th align="right">Payable</Th><Th align="right">Stock Value</Th><Th align="right">Run Rate (weekly)</Th><Th align="right">Days Cover</Th><Th align="right">Debt</Th><Th align="right">Net Working Capital</Th></Thead>
              <tbody>
                {stockTop5.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td align="right">{payables ? money(r.payable) : "—"}</Td>
                    <Td align="right">{r.rollup ? formatCompact(r.rollup.value) : "—"}</Td>
                    <Td align="right">{r.rollup ? formatCompact(r.rollup.rrWeekValue) : "—"}</Td>
                    <Td align="right">{r.rollup ? r.rollup.daysStock.toFixed(1) : "—"}</Td>
                    <Td align="right">{money(r.debt)}</Td>
                    <Td align="right">{payables ? money(nwc(r.rollup?.value ?? 0, r.debt, r.payable)) : "—"}</Td>
                  </tr>
                ))}
                <tr>
                  <Td className="text-muted-strong">All Other Principals ({stockOthers.length})</Td>
                  <Td align="right">{payables ? money(othersPayable) : "—"}</Td>
                  <Td align="right">{formatCompact(stockOthersAgg.value)}</Td>
                  <Td align="right">{formatCompact(stockOthersAgg.rrWeekValue)}</Td>
                  <Td align="right">{stockOthersDaysCover.toFixed(1)}</Td>
                  <Td align="right">{money(othersDebt)}</Td>
                  <Td align="right">{payables ? money(nwc(stockOthersAgg.value, othersDebt, othersPayable)) : "—"}</Td>
                </tr>
                <TotalRow>
                  <Td>Total (all principals)</Td>
                  <Td align="right">{payables ? money(stockTotalPayable) : "—"}</Td>
                  <Td align="right">{formatCompact(stockTotalValue)}</Td>
                  <Td align="right">{formatCompact(stockTotalRrWeek)}</Td>
                  <Td align="right">{stockTotalDaysCover.toFixed(1)}</Td>
                  <Td align="right">{money(stockTotalDebt)}</Td>
                  <Td align="right">{payables ? money(nwc(stockTotalValue, stockTotalDebt, stockTotalPayable)) : "—"}</Td>
                </TotalRow>
              </tbody>
            </TableWrap>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
