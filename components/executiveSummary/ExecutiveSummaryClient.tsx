"use client";

import { Presenter20Regular, PresenterOff20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { summarizeSalesByPrincipal, type PeriodSelection } from "@/lib/timeIntelligence";
import { aggregateStockByPrincipal, classifyDormantPrincipals, sumStockRollups, computeOverstock, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/stock";
import { achievementTier } from "@/lib/format";
import { ExceptionsStrip } from "./ExceptionsStrip";
import { SalesSummaryPanel } from "./SalesSummaryPanel";
import { StockRiskPanel } from "./StockRiskPanel";
import { OrderFulfillmentPanel } from "./OrderFulfillmentPanel";
import { FieldBehaviorPanel } from "./FieldBehaviorPanel";
import { FinancialsPanel } from "./FinancialsPanel";
import { TeamLeaderPerformancePanel } from "./TeamLeaderPerformancePanel";
import type { ReceivablesDashboard } from "@/lib/receivables";

/** Matches ReportCatalog.tsx's own periodLabelFor exactly — small enough
 *  that duplicating it locally beats exporting a one-off cross-module
 *  dependency for a single reuse. */
function periodLabelFor(period: PeriodSelection): string {
  if (period.kind === "H1" || period.kind === "H2" || period.kind.startsWith("Q")) return `${period.kind} ${period.year}`;
  return `${period.kind} ${period.month ?? ""} ${period.year}`.replace(/\s+/g, " ").trim();
}

export function ExecutiveSummaryClient({
  receivables,
  canViewReceivables,
}: {
  receivables: ReceivablesDashboard | null;
  canViewReceivables: boolean;
}) {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const presentationMode = useDashboardStore((s) => s.presentationMode);
  const setPresentationMode = useDashboardStore((s) => s.setPresentationMode);

  if (!dataset) return null;

  const offTargetPrincipals = Array.from(summarizeSalesByPrincipal(dataset, period).values()).filter(
    (r) => achievementTier(r.achievementPct) === "bad"
  ).length;

  const allStockRollups = aggregateStockByPrincipal(dataset);
  const { dormantKeys } = classifyDormantPrincipals(dataset, allStockRollups.map((r) => r.key));
  const activeStockTotal = sumStockRollups(allStockRollups.filter((r) => !dormantKeys.has(r.key)));
  const overstock = computeOverstock(dataset, null, OVERSTOCK_DAYS_THRESHOLD);

  const todayLabel = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-strong">
          Executive Summary · {selectedPrincipalKey ?? "All Principals"} · {periodLabelFor(period)} · as of {todayLabel}
        </p>
        <button
          onClick={() => setPresentationMode(!presentationMode)}
          className="no-print flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-strong transition-colors duration-300 hover:bg-accent-blue-soft hover:text-primary-blue"
          aria-pressed={presentationMode}
        >
          {presentationMode ? <PresenterOff20Regular /> : <Presenter20Regular />}
          {presentationMode ? "Exit presentation mode" : "Presentation mode"}
        </button>
      </div>
      <ExceptionsStrip
        offTargetPrincipals={offTargetPrincipals}
        outOfStockCount={activeStockTotal.outOfStockCount}
        overstockedCount={overstock.itemCount}
        creditLimitBreaches={receivables?.creditLimitBreaches ?? 0}
      />
      {/* Every panel now pairs with another (none full-width/alone) — Sales
          vs. Target with Stock Risk (both are at-a-glance KPI summaries that
          link out to their own detail module), Order Fulfillment with
          Field/Rep Behavior, and Financials with Team Leader Performance. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SalesSummaryPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
        <StockRiskPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <OrderFulfillmentPanel period={period} />
        <FieldBehaviorPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FinancialsPanel
          dataset={dataset}
          selectedPrincipalKey={selectedPrincipalKey}
          period={period}
          receivables={receivables}
          canViewReceivables={canViewReceivables}
        />
        <TeamLeaderPerformancePanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} />
      </div>
    </div>
  );
}
