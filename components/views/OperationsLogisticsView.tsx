"use client";

import { useState } from "react";
import type { Dataset } from "@/lib/types";
import type { PeriodSelection } from "@/lib/timeIntelligence";
import { StockView } from "./StockView";
import { InventoryMovementTab } from "@/components/operations/InventoryMovementTab";
import { MustSellListTab } from "@/components/operations/MustSellListTab";
import { TopPrincipalStockStatusTab } from "@/components/operations/TopPrincipalStockStatusTab";
import { PurchasesTab } from "@/components/operations/PurchasesTab";
import { OrderFulfillmentTab } from "@/components/operations/OrderFulfillmentTab";
import { FleetLogisticsTab } from "@/components/operations/FleetLogisticsTab";

export type OperationsTab =
  | "stock-balance"
  | "inventory-movement"
  | "must-sell-list"
  | "top-principal-status"
  | "purchases"
  | "order-fulfillment"
  | "fleet-logistics";

const TABS: { id: OperationsTab; label: string }[] = [
  { id: "stock-balance", label: "Stock Balance" },
  { id: "inventory-movement", label: "Inventory Movement" },
  { id: "must-sell-list", label: "Must-Sell List" },
  { id: "top-principal-status", label: "Top 5 Stock Status" },
  { id: "purchases", label: "Purchases" },
  { id: "order-fulfillment", label: "Order Fulfillment" },
  { id: "fleet-logistics", label: "Fleet & Logistics" },
];

/** Expands the existing Stock Balance page into the full Operations &
 *  Logistics module — same tab-pill orchestration pattern as
 *  FinancialsView.tsx, with the original Stock Balance content (StockView,
 *  untouched) as the first tab and every new section added alongside it. */
export function OperationsLogisticsView({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const [activeTab, setActiveTab] = useState<OperationsTab>("stock-balance");

  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-blue">Operations & Logistics</p>
        <div className="mt-1">
          <h1 className="text-xl font-bold text-brand-navy">Stock Balance & Operations</h1>
          <p className="mt-1 text-xs text-muted">Use the tabs to move between inventory, stocking, and order-fulfillment views.</p>
        </div>
      </header>

      <div className="rounded-xl border border-border bg-background-elevated p-1.5 shadow-sm" role="tablist" aria-label="Operations & Logistics sections">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${selected
                  ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-sm"
                  : "text-muted-strong hover:bg-surface hover:text-primary-blue"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel">
        {activeTab === "stock-balance" && <StockView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />}
        {activeTab === "inventory-movement" && <InventoryMovementTab dataset={dataset} />}
        {activeTab === "must-sell-list" && <MustSellListTab dataset={dataset} />}
        {activeTab === "top-principal-status" && <TopPrincipalStockStatusTab dataset={dataset} />}
        {activeTab === "purchases" && <PurchasesTab />}
        {activeTab === "order-fulfillment" && <OrderFulfillmentTab period={period} />}
        {activeTab === "fleet-logistics" && <FleetLogisticsTab />}
      </div>
    </div>
  );
}
