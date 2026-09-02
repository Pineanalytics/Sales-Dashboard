"use client";

import { useState } from "react";
import { useDashboardStore } from "@/lib/store";
import type { ReceivablesDashboard } from "@/lib/receivables";
import { PLStatementView } from "./PLStatementView";
import { ProfitabilityView } from "./ProfitabilityView";
import {
  CustomerCreditExposure,
  LargestOpenItems,
  ReceivablesSummary,
} from "./ReceivablesView";
import { SectionCard } from "@/components/ui/KpiGrid";

export type FinancialsTab =
  | "receivables-summary"
  | "credit-exposure"
  | "open-items"
  | "profitability";

type Props = {
  canViewReceivables: boolean;
  canViewProfitability: boolean;
  initialTab?: FinancialsTab;
  receivables: ReceivablesDashboard | null;
};

const TABS: { id: FinancialsTab; label: string; receivables?: boolean; profitability?: boolean }[] = [
  { id: "receivables-summary", label: "Receivables & Ageing", receivables: true },
  { id: "credit-exposure", label: "Customer Credit Exposure", receivables: true },
  { id: "open-items", label: "Largest Open Items", receivables: true },
  { id: "profitability", label: "Profitability", profitability: true },
];

export function FinancialsView({
  canViewReceivables,
  canViewProfitability,
  initialTab,
  receivables,
}: Props) {
  const dataset = useDashboardStore((state) => state.dataset);
  const selectedPrincipalKey = useDashboardStore((state) => state.selectedPrincipalKey);
  const period = useDashboardStore((state) => state.selectedPeriod);
  const availableTabs = TABS.filter((tab) =>
    (tab.receivables && canViewReceivables) || (tab.profitability && canViewProfitability),
  );
  const initial = initialTab && availableTabs.some((tab) => tab.id === initialTab)
    ? initialTab
    : availableTabs[0]?.id ?? "receivables-summary";
  const [selectedTab, setSelectedTab] = useState<FinancialsTab>(initial);
  const [profitabilityView, setProfitabilityView] = useState<"grossProfit" | "plStatement">("grossProfit");
  const activeTab = availableTabs.some((tab) => tab.id === selectedTab) ? selectedTab : initial;

  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-xl border border-[#d8e4d7] bg-white px-5 py-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#28795a]">Financials</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#073c35]">Financial performance & receivables</h1>
            <p className="mt-1 text-xs text-[#65766f]">
              Use the tabs to move between financial views without a long scrolling page.
            </p>
          </div>
          <p className="text-xs text-[#65766f]">
            Receivables balances refresh from the dashboard SAP sync.
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-[#d8e4d7] bg-[#eef4ee] p-1.5 shadow-sm" role="tablist" aria-label="Financials sections">
        <div className="flex flex-wrap gap-1">
          {availableTabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedTab(tab.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${selected
                  ? "bg-[#075a4b] text-white shadow-sm"
                  : "text-[#31544a] hover:bg-white hover:text-[#073c35]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel">
        {activeTab === "receivables-summary" && receivables && <ReceivablesSummary data={receivables} />}
        {activeTab === "credit-exposure" && receivables && <CustomerCreditExposure data={receivables} />}
        {activeTab === "open-items" && receivables && <LargestOpenItems data={receivables} />}
        {activeTab === "profitability" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#d8e4d7] bg-white p-3 shadow-sm">
              <span className="mr-1 text-xs font-semibold text-[#31544a]">Profitability view</span>
              <button
                type="button"
                onClick={() => setProfitabilityView("grossProfit")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${profitabilityView === "grossProfit" ? "bg-[#075a4b] text-white" : "bg-[#edf4ed] text-[#31544a]"}`}
              >
                Gross profit & margin
              </button>
              <button
                type="button"
                onClick={() => setProfitabilityView("plStatement")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${profitabilityView === "plStatement" ? "bg-[#075a4b] text-white" : "bg-[#edf4ed] text-[#31544a]"}`}
              >
                P&amp;L statement
              </button>
            </div>
            {dataset ? (
              profitabilityView === "grossProfit" ? (
                <ProfitabilityView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
              ) : (
                <PLStatementView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
              )
            ) : (
              <SectionCard>
                <p className="text-sm font-semibold text-[#073c35]">Profitability data is loading</p>
                <p className="mt-1 text-xs text-[#65766f]">The period dataset will appear as soon as it is available.</p>
              </SectionCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
