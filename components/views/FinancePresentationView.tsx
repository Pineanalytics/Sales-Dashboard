"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Presenter20Regular, PresenterOff20Regular } from "@fluentui/react-icons";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import { aggregateStockByPrincipal } from "@/lib/stock";
import { summarizeSalesForPeriod, summarizeSalesByPrincipal, getCurrentMonthPeriod, resolvePeriodMonths, CANONICAL_MONTHS, type PeriodSelection } from "@/lib/timeIntelligence";
import {
  buildGpTargetSummary,
  daysCoverAtCost,
  describePeriod,
  isSameMonth,
  marginAchievementPct,
  monthName,
  nairobiToday,
  periodElapsedDays,
  periodEndMonth,
  previousMonth,
  runRateWindow,
  weeklyRunRateAtCost,
  type MonthRef,
} from "@/lib/financePresentation";
import { useDashboardStore } from "@/lib/store";
import type { ReceivablesDashboard } from "@/lib/receivables";
import type { PayablesDashboard, PayablesByPrincipalRow } from "@/lib/payables";
import type { DebtAttribution } from "@/lib/financeDebtAttribution";
import type { AgeingTrendForMonth, AgeingSnapshotPoint } from "@/lib/receivablesAgeing";

const TOP_5_PRINCIPALS = ["Mars", "Suntory", "Upfield", "Eabl", "Weetabix"];
const TOP_5_KEYS = new Set(TOP_5_PRINCIPALS.map(normalizePrincipalKey));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** "KES" is a small prefix so a long figure keeps its room inside a tile. */
function kes(value: number): ReactNode {
  return (
    <>
      <span className="mr-1 align-baseline text-[0.55em] font-medium tracking-wide text-muted-strong">KES</span>
      {formatCompact(value)}
    </>
  );
}

function ageingRowTotal(point: AgeingSnapshotPoint) {
  if (!point.buckets) return null;
  const current = point.buckets.current + point.buckets.days30;
  return { current, days60: point.buckets.days60, days90: point.buckets.days90, daysOver90: point.buckets.daysOver90, total: current + point.buckets.days60 + point.buckets.days90 + point.buckets.daysOver90 };
}

interface AgeingPayload {
  selected: AgeingTrendForMonth;
  previous: AgeingTrendForMonth;
  /** The balance at the selected month's end; null while the month is still the current one. */
  monthEnd: AgeingSnapshotPoint | null;
}
type AgeingState = { key: string; status: "idle"; data: AgeingPayload } | { key: string; status: "error" } | { key: ""; status: "idle"; data: null };

/** The weekly ageing for the selected month and the month before it. Re-fetched whenever the period's last month changes. */
function useAgeing(end: MonthRef, enabled: boolean): { loading: boolean; error: boolean; data: AgeingPayload | null } {
  const [state, setState] = useState<AgeingState>({ key: "", status: "idle", data: null });
  const key = `${end.year}-${end.monthIndex}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/finance-presentation/ageing?year=${end.year}&monthIndex=${end.monthIndex}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as AgeingPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load the ageing.");
        if (!controller.signal.aborted) setState({ key, status: "idle", data: body });
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Finance presentation: failed to load the ageing", err);
          setState({ key, status: "error" });
        }
      }
    })();
    return () => controller.abort();
  }, [key, enabled, end.year, end.monthIndex]);

  if (!enabled) return { loading: false, error: false, data: null };
  const current = state.key === key;
  return { loading: !current, error: current && state.status === "error", data: current && state.status === "idle" ? state.data : null };
}

interface DebtBalances {
  total: number;
  current: number;
  overdue: number;
  over90: number;
  customers: number | null;
}

/** A condensed, presentation-ready two-slide summary of the Finance module —
 *  static (no drill-down/expand affordances, unlike the full /financials
 *  tabs), listed in the sidebar directly below Executive Summary. Reuses the
 *  exact same selectors as the full module (summarizeSalesForPeriod,
 *  aggregateStockByPrincipal, debtAttribution, ageing snapshots) so the two
 *  never drift apart. Both slides follow the global reporting period: sales and
 *  gross profit for the selected months, debtors as at the period's last month,
 *  and the weekly ageing for that month and the one before it. */
export function FinancePresentationView({
  receivables,
  payables,
  payablesByPrincipal,
  debtAttribution,
}: {
  receivables: ReceivablesDashboard | null;
  payables: PayablesDashboard | null;
  payablesByPrincipal: PayablesByPrincipalRow[];
  debtAttribution: DebtAttribution;
}) {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPeriod = useDashboardStore((s) => s.selectedPeriod);
  const presentationMode = useDashboardStore((s) => s.presentationMode);
  const setPresentationMode = useDashboardStore((s) => s.setPresentationMode);
  const [activeSlide, setActiveSlide] = useState<1 | 2>(1);

  const today = nairobiToday();
  const todayMonth: MonthRef = { year: today.year, monthIndex: today.monthIndex };
  const endMonth = (selectedPeriod.year ? periodEndMonth(selectedPeriod) : null) ?? todayMonth;
  const ageing = useAgeing(endMonth, receivables !== null);

  if (!dataset) return null;

  const period: PeriodSelection = selectedPeriod.year ? selectedPeriod : getCurrentMonthPeriod(dataset);
  const periodText = describePeriod(period);
  const isLiveMonth = isSameMonth(endMonth, todayMonth);
  const periodSummary = summarizeSalesForPeriod(dataset, period, null);
  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, period).values());
  const elapsedDays = periodElapsedDays(period, today);

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

  // GP margin against the policy targets (Mars 15%, EABL 6%, Suntory 7%, Upfield 10%, Weetabix 10%, every other 10%).
  const gpSummary = buildGpTargetSummary(byPrincipal.map((p) => ({ principal: p.principal, revenue: p.revenue, target: p.target, grossProfit: p.grossProfit })));
  const marginTargetPct = gpSummary.total.marginTargetPct;
  const marginVsTargetPct = marginAchievementPct(periodSummary.grossMarginPct, marginTargetPct);
  const pp = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}pp`);

  // Debtors as at the period's last month: the live ledger for the current month,
  // otherwise that month's closing ageing snapshot.
  const bucket = receivables?.buckets;
  const liveBalances: DebtBalances | null =
    receivables && bucket
      ? {
          total: receivables.ledgerBalance,
          current: bucket.Current + bucket["1–30 days"],
          overdue: bucket["31–60 days"] + bucket["61–90 days"] + bucket["Over 90 days"],
          over90: bucket["Over 90 days"],
          customers: receivables.customerCount,
        }
      : null;
  const closing = ageing.data?.monthEnd?.buckets ?? null;
  const closingBalances: DebtBalances | null = closing
    ? {
        total: closing.current + closing.days30 + closing.days60 + closing.days90 + closing.daysOver90,
        current: closing.current + closing.days30,
        overdue: closing.days60 + closing.days90 + closing.daysOver90,
        over90: closing.daysOver90,
        customers: null,
      }
    : null;
  const balances = isLiveMonth ? liveBalances : closingBalances;

  const payablesOutstanding = payables?.ledgerBalance ?? 0;
  // Genuine Net Working Capital once Payables has synced at least once;
  // before that, fall back to the original Stock + Receivables proxy (no
  // Payables figure existed at all until this was built) rather than
  // silently treating an un-synced zero as "no payables owed". Stock and
  // payables have no history, so for a closed month they are the latest balances.
  const workingCapital = balances ? dataset.stockTotal.value + balances.total - (payables ? payablesOutstanding : 0) : null;

  // DSO = closing AR balance ÷ period sales × days elapsed in that period —
  // elapsed (not the full month) so a partial MTD period doesn't get
  // overstated by a full 30-day multiplier against only a few days of sales.
  const dso = balances && periodSummary.revenue > 0 && elapsedDays > 0 ? round1((balances.total / periodSummary.revenue) * elapsedDays) : null;

  const stockRollups = aggregateStockByPrincipal(dataset);
  const debtByKey = new Map(debtAttribution.byPrincipal.map((d) => [normalizePrincipalKey(d.principal), d.debt]));
  // Weekly run rate and days cover are measured at COST: stock is valued at cost, so it is
  // covered against cost of sales (the period's COGS per elapsed week), not net sales.
  const firstMonth = resolvePeriodMonths(period).reduce<MonthRef | null>((best, m) => {
    const candidate = { year: Number(m.year), monthIndex: m.monthIndex };
    return best === null || candidate.year * 12 + candidate.monthIndex < best.year * 12 + best.monthIndex ? candidate : best;
  }, null) ?? endMonth;
  const runWindow = runRateWindow(elapsedDays, firstMonth);
  const cogsByKey = new Map<string, number>();
  for (const p of byPrincipal) {
    const key = normalizePrincipalKey(p.principal);
    cogsByKey.set(key, (cogsByKey.get(key) ?? 0) + p.cogs);
  }
  if (runWindow.usePrior) {
    // Early in the period: add the month before it so the pace is not set by a few days of postings.
    const priorPeriod: PeriodSelection = { kind: "MONTH", year: String(runWindow.prior.year), month: CANONICAL_MONTHS[runWindow.prior.monthIndex] };
    for (const p of summarizeSalesByPrincipal(dataset, priorPeriod).values()) {
      const key = normalizePrincipalKey(p.principal);
      cogsByKey.set(key, (cogsByKey.get(key) ?? 0) + p.cogs);
    }
  }
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
    const runRateCost = weeklyRunRateAtCost(cogsByKey.get(key) ?? 0, runWindow.windowDays);
    return { label, rollup, debt: debtByKey.get(key) ?? 0, payable: payableByKey.get(key) ?? 0, runRateCost, daysCover: daysCoverAtCost(rollup?.value ?? 0, runRateCost) };
  });
  const stockOthers = stockRollups.filter((r) => !TOP_5_KEYS.has(r.key));
  const stockOthersValue = stockOthers.reduce((s, r) => s + r.value, 0);
  const othersCogs = Array.from(cogsByKey.entries()).filter(([key]) => !TOP_5_KEYS.has(key)).reduce((s, [, v]) => s + v, 0);
  const totalCogs = Array.from(cogsByKey.values()).reduce((s, v) => s + v, 0);
  const othersRunRateCost = weeklyRunRateAtCost(othersCogs, runWindow.windowDays);
  const totalRunRateCost = weeklyRunRateAtCost(totalCogs, runWindow.windowDays);
  const stockTotalValue = stockTop5.reduce((s, r) => s + (r.rollup?.value ?? 0), 0) + stockOthersValue;
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
  // Net Working Capital per row, same formula as the page-level KPI (Stock +
  // Receivables − Payables) applied at the principal level; "—" until
  // Payables has synced at least once, matching every other Payable-derived
  // cell in this table.
  const nwc = (stockValue: number, debt: number, payable: number) => stockValue + debt - payable;
  const cover = (value: number | null) => (value === null ? "—" : value.toFixed(1));

  // Weekly ageing: every week of the selected month and of the month before it.
  const previous = previousMonth(endMonth);
  const ageingRows: { label: string; point: AgeingSnapshotPoint }[] = ageing.data
    ? [
        ...ageing.data.previous.weeks.map((point) => ({ label: `${monthName(previous)} · ${point.label}`, point })),
        ...ageing.data.selected.weeks.map((point) => ({ label: `${monthName(endMonth)} · ${point.label}`, point })),
      ]
    : [];
  const balanceNote = isLiveMonth
    ? "Debtors as at today (live ledger)."
    : `Debtors as at the end of ${monthName(endMonth)} ${endMonth.year} (ageing snapshot); payables and stock are the latest balances.`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-strong">Finance Presentation · {periodText}</p>
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
            Slide {slideNumber} — {slideNumber === 1 ? "Sales & Gross Profit" : "Debtors and Working Capital"}
          </button>
        ))}
      </div>

      {/* Slide 1: Sales & Gross Profit */}
      <div id="finance-slide-1" className={`@container ${activeSlide === 1 ? "" : "hidden"}`}>
        <SectionCard title="Slide 1 — Sales & Gross Profit" accent="blue">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-6">
              <KpiCard accent="revenue" label="Revenue" value={formatCompact(periodSummary.revenue)} sublabel={periodText} />
              <KpiCard accent="mission" label="Vs Running Target" value={<span className={tierTextClass[achievementTier(periodSummary.achievementPct)]}>{formatPercent(periodSummary.achievementPct)}</span>} sublabel={periodSummary.target !== null ? `Target ${formatCompact(periodSummary.target)}` : "N/T"} />
              <KpiCard accent="growth" label="Gross Profit" value={formatCompact(periodSummary.grossProfit)} sublabel={periodText} />
              <KpiCard accent="growth" label="Gross Margin %" value={<span className={tierTextClass[marginTier(periodSummary.grossMarginPct)]}>{formatPercent(periodSummary.grossMarginPct)}</span>} sublabel="Actual, company-wide" />
              <KpiCard
                accent="mission"
                label="GP Margin vs Target"
                value={<span className={tierTextClass[achievementTier(marginVsTargetPct)]}>{formatPercent(marginVsTargetPct)}</span>}
                sublabel={
                  marginTargetPct !== null && periodSummary.grossMarginPct !== null
                    ? `${periodSummary.grossMarginPct.toFixed(1)}% vs ${marginTargetPct.toFixed(1)}% target · ${pp(gpSummary.total.variancePp)}`
                    : "No target"
                }
              />
              <KpiCard accent="coverage" label="Net Working Capital" value={workingCapital !== null ? kes(workingCapital) : "—"} sublabel={payables ? "Stock + Receivables − Payables" : "Stock + Receivables (Payables not synced)"} />
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

            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                GP vs target — achieved · {periodText} · margin targets: Mars 15%, EABL 6%, Suntory 7%, Upfield 10%, Weetabix 10%, all others 10%
              </h4>
              <TableWrap>
                <Thead>
                  <Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Target margin</Th><Th align="right">Actual margin</Th><Th align="right">Variance</Th>
                  <Th align="right">GP target</Th><Th align="right">GP actual</Th><Th align="right">GP achieved</Th><Th align="right">Status</Th>
                </Thead>
                <tbody>
                  {gpSummary.rows.map((r) => (
                    <tr key={r.label}>
                      <Td>{r.label}</Td>
                      <Td align="right">{formatCompact(r.revenue)}</Td>
                      <Td align="right">{r.marginTargetPct.toFixed(1)}%</Td>
                      <Td align="right"><span className={tierTextClass[achievementTier(marginAchievementPct(r.marginPct, r.marginTargetPct))]}>{formatPercent(r.marginPct)}</span></Td>
                      <Td align="right"><span className={r.variancePp !== null && r.variancePp < 0 ? "font-semibold text-accent-red" : "font-semibold text-accent-green"}>{pp(r.variancePp)}</span></Td>
                      <Td align="right">{r.gpTarget !== null ? formatCompact(r.gpTarget) : "N/T"}</Td>
                      <Td align="right">{formatCompact(r.grossProfit)}</Td>
                      <Td align="right">{r.gpAchievementPct !== null ? <span className={tierTextClass[achievementTier(r.gpAchievementPct)]}>{formatPercent(r.gpAchievementPct)}</span> : "—"}</Td>
                      <Td align="right">{r.achieved === null ? "—" : r.achieved ? <span className="font-semibold text-accent-green">Achieved</span> : <span className="font-semibold text-accent-red">Below target</span>}</Td>
                    </tr>
                  ))}
                  <TotalRow>
                    <Td>Total (all principals)</Td>
                    <Td align="right">{formatCompact(gpSummary.total.revenue)}</Td>
                    <Td align="right">{gpSummary.total.marginTargetPct !== null ? `${gpSummary.total.marginTargetPct.toFixed(1)}%` : "—"}</Td>
                    <Td align="right">{formatPercent(gpSummary.total.marginPct)}</Td>
                    <Td align="right">{pp(gpSummary.total.variancePp)}</Td>
                    <Td align="right">{gpSummary.total.gpTarget !== null ? formatCompact(gpSummary.total.gpTarget) : "N/T"}</Td>
                    <Td align="right">{formatCompact(gpSummary.total.grossProfit)}</Td>
                    <Td align="right">{gpSummary.total.gpAchievementPct !== null ? formatPercent(gpSummary.total.gpAchievementPct) : "—"}</Td>
                    <Td align="right">{gpSummary.total.achieved === null ? "—" : gpSummary.total.achieved ? "Achieved" : "Below target"}</Td>
                  </TotalRow>
                </tbody>
              </TableWrap>
              <p className="mt-2 text-[11px] text-muted">GP target = the principal&apos;s revenue target for the period × its target margin; GP achieved = GP actual ÷ GP target. Principals with no revenue target are judged on margin alone.</p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Slide 2: Debtors and Working Capital */}
      <div id="finance-slide-2" className={`@container ${activeSlide === 2 ? "" : "hidden"}`}>
        <SectionCard title="Slide 2 — Debtors and Working Capital" accent="red">
          <div className="flex flex-col gap-4">
            {receivables ? (
              <>
                <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
                  <KpiCard accent="mission" label="Overall Debt" value={balances ? kes(balances.total) : "—"} sublabel={balances?.customers != null ? `${balances.customers} customers` : isLiveMonth ? "" : `At ${monthName(endMonth)} end`} />
                  <KpiCard accent="growth" label="Current Debt" value={balances ? kes(balances.current) : "—"} sublabel="Within 30 days" />
                  <KpiCard accent="quarter" label="Overdue Debt" value={balances ? kes(balances.overdue) : "—"} sublabel="Over 30 days" />
                  <KpiCard accent="coverage" label="Over 90 Days" value={balances ? kes(balances.over90) : "—"} sublabel="Collection risk" />
                  <KpiCard accent="mission" label="DSO" value={dso !== null ? `${dso.toFixed(1)}d` : "—"} sublabel="Days Sales Outstanding" />
                  <KpiCard accent="quarter" label="Accounts Payable" value={payables ? kes(payables.ledgerBalance) : "N/A"} sublabel={payables ? `${payables.vendorCount} vendors${isLiveMonth ? "" : " · latest"}` : "Not yet synced"} />
                  <KpiCard accent="revenue" label="Stock Opening Value" value={kes(dataset.stockTotal.value)} sublabel={isLiveMonth ? "Company-wide" : "Company-wide · latest"} />
                  <KpiCard accent="mission" label="Net Working Capital" value={workingCapital !== null ? kes(workingCapital) : "—"} sublabel={payables ? "Stock + Receivables − Payables" : "Stock + Receivables (Payables not synced)"} />
                </div>
                {!balances && !isLiveMonth && !ageing.loading ? (
                  <p className="text-sm text-muted">No ageing snapshot exists for the end of {monthName(endMonth)} {endMonth.year}, so the debtor balances cannot be shown for this period.</p>
                ) : null}
                <p className="text-[11px] text-muted">{balanceNote}</p>
              </>
            ) : (
              <p className="text-sm text-muted">Receivables have not synced yet.</p>
            )}

            {receivables ? (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Ageing trend — weekly, {monthName(previous)} and {monthName(endMonth)} {endMonth.year}
                </h4>
                {ageing.loading ? <p className="text-sm text-muted">Loading the ageing…</p> : null}
                {ageing.error ? <p className="text-sm text-muted">The ageing could not be loaded.</p> : null}
                {ageingRows.length > 0 ? (
                  <TableWrap>
                    <Thead><Th>Period</Th><Th align="right">Total</Th><Th align="right">Current (0–30 days)</Th><Th align="right">60 days</Th><Th align="right">90 days</Th><Th align="right">Over 90 days</Th></Thead>
                    <tbody>
                      {ageingRows.map(({ label, point }) => {
                        const t = ageingRowTotal(point);
                        return (
                          <tr key={label}>
                            <Td>{label}</Td>
                            <Td align="right" className="font-semibold">{t ? kes(t.total) : "—"}</Td>
                            {(["current", "days60", "days90", "daysOver90"] as const).map((key) => (
                              <Td key={key} align="right">
                                {t ? (
                                  <>
                                    {kes(t[key])}
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
                ) : null}
              </div>
            ) : null}

            <TableWrap>
              <Thead>
                <Th>Principal</Th><Th align="right">Payable</Th><Th align="right">Stock Value</Th><Th align="right">Run Rate (weekly, at cost)</Th><Th align="right">Days Cover (at cost)</Th><Th align="right">Debt</Th><Th align="right">Net Working Capital</Th>
              </Thead>
              <tbody>
                {stockTop5.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td align="right">{payables ? kes(r.payable) : "—"}</Td>
                    <Td align="right">{r.rollup ? formatCompact(r.rollup.value) : "—"}</Td>
                    <Td align="right">{r.runRateCost !== null ? formatCompact(r.runRateCost) : "—"}</Td>
                    <Td align="right">{cover(r.daysCover)}</Td>
                    <Td align="right">{kes(r.debt)}</Td>
                    <Td align="right">{payables ? kes(nwc(r.rollup?.value ?? 0, r.debt, r.payable)) : "—"}</Td>
                  </tr>
                ))}
                <tr>
                  <Td className="text-muted-strong">All Other Principals ({stockOthers.length})</Td>
                  <Td align="right">{payables ? kes(othersPayable) : "—"}</Td>
                  <Td align="right">{formatCompact(stockOthersValue)}</Td>
                  <Td align="right">{othersRunRateCost !== null ? formatCompact(othersRunRateCost) : "—"}</Td>
                  <Td align="right">{cover(daysCoverAtCost(stockOthersValue, othersRunRateCost))}</Td>
                  <Td align="right">{kes(othersDebt)}</Td>
                  <Td align="right">{payables ? kes(nwc(stockOthersValue, othersDebt, othersPayable)) : "—"}</Td>
                </tr>
                <TotalRow>
                  <Td>Total (all principals)</Td>
                  <Td align="right">{payables ? kes(stockTotalPayable) : "—"}</Td>
                  <Td align="right">{formatCompact(stockTotalValue)}</Td>
                  <Td align="right">{totalRunRateCost !== null ? formatCompact(totalRunRateCost) : "—"}</Td>
                  <Td align="right">{cover(daysCoverAtCost(stockTotalValue, totalRunRateCost))}</Td>
                  <Td align="right">{kes(stockTotalDebt)}</Td>
                  <Td align="right">{payables ? kes(nwc(stockTotalValue, stockTotalDebt, stockTotalPayable)) : "—"}</Td>
                </TotalRow>
              </tbody>
            </TableWrap>
            <p className="text-[11px] text-muted">Run rate and days cover are at cost: weekly cost of sales against stock valued at cost. {runWindow.usePrior ? `Fewer than four weeks of ${periodText} have elapsed, so ${monthName(runWindow.prior)} is included in the run rate. ` : ""}Stock, payables and debt-by-principal are the latest balances.</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
