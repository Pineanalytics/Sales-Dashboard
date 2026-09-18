"use client";

import { useDashboardStore } from "@/lib/store";
import { summarizeSalesByPrincipal } from "@/lib/timeIntelligence";
import { aggregateStockByPrincipal, classifyDormantPrincipals, sumStockRollups } from "@/lib/stock";
import { computeOverstock, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/executiveSummary";
import { achievementTier } from "@/lib/format";
import { ExceptionsStrip } from "./ExceptionsStrip";
import { SalesSummaryPanel } from "./SalesSummaryPanel";
import { StockRiskPanel } from "./StockRiskPanel";
import { OrderFulfillmentPanel } from "./OrderFulfillmentPanel";
import { FieldBehaviorPanel } from "./FieldBehaviorPanel";
import { FinancialsPanel } from "./FinancialsPanel";
import type { ReceivablesDashboard } from "@/lib/receivables";

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

  if (!dataset) return null;

  const offTargetPrincipals = Array.from(summarizeSalesByPrincipal(dataset, period).values()).filter(
    (r) => achievementTier(r.achievementPct) === "bad"
  ).length;

  const allStockRollups = aggregateStockByPrincipal(dataset);
  const { dormantKeys } = classifyDormantPrincipals(dataset, allStockRollups.map((r) => r.key));
  const activeStockTotal = sumStockRollups(allStockRollups.filter((r) => !dormantKeys.has(r.key)));
  const overstock = computeOverstock(dataset, null, OVERSTOCK_DAYS_THRESHOLD);

  return (
    <div className="flex flex-col gap-4">
      <ExceptionsStrip
        offTargetPrincipals={offTargetPrincipals}
        outOfStockCount={activeStockTotal.outOfStockCount}
        overstockedCount={overstock.itemCount}
        creditLimitBreaches={receivables?.creditLimitBreaches ?? 0}
      />
      <SalesSummaryPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <StockRiskPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} />
        <OrderFulfillmentPanel period={period} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FieldBehaviorPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
        <FinancialsPanel
          dataset={dataset}
          selectedPrincipalKey={selectedPrincipalKey}
          period={period}
          receivables={receivables}
          canViewReceivables={canViewReceivables}
        />
      </div>
    </div>
  );
}
