"use client";

import { useEffect } from "react";
import type { Session } from "next-auth";
import { useDashboardStore } from "@/lib/store";
import type { Dataset } from "@/lib/types";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentTable20Regular } from "@fluentui/react-icons";

import { OverviewView } from "@/components/views/OverviewView";
import { TimeIntelligenceView } from "@/components/views/TimeIntelligenceView";
import { CoverageView } from "@/components/views/CoverageView";
import { RepPerformanceView } from "@/components/views/RepPerformanceView";
import { CustomerBrandView } from "@/components/views/CustomerBrandView";
import { ProfitabilityView } from "@/components/views/ProfitabilityView";
import { StockView } from "@/components/views/StockView";

export function DashboardShell({
  initialDataset,
  user,
}: {
  initialDataset: Dataset | null;
  user: Session["user"] | null;
}) {
  const storeDataset = useDashboardStore((s) => s.dataset);
  const status = useDashboardStore((s) => s.status);
  const view = useDashboardStore((s) => s.view);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const setDataset = useDashboardStore((s) => s.setDataset);

  // The store starts empty (it's a client-side singleton with no knowledge of
  // the server-fetched snapshot). Fall back to the SSR-provided prop so the
  // server-rendered HTML already reflects real data instead of an empty
  // state; once the effect below pushes it into the store, the sidebar and
  // header (which read the store directly) pick it up too.
  const dataset = storeDataset ?? initialDataset;

  useEffect(() => {
    if (initialDataset) setDataset(initialDataset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-1 min-h-0">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header user={user} />
        <main className="flex-1 p-4 md:p-6 flex flex-col gap-6">
          {status === "loading" && !dataset ? (
            <FullPageSpinner label="Processing workbook…" />
          ) : !dataset ? (
            <EmptyState
              icon={<DocumentTable20Regular className="h-10 w-10" />}
              title="No sales data uploaded yet"
              description="Upload the monthly Excel export to populate revenue, coverage, profitability, stock and forecast views for every principal."
            />
          ) : (
            <div key={view} className="animate-fade-in flex flex-col gap-6">
              {view === "overview" && <OverviewView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />}
              {view === "timeIntelligence" && (
                <TimeIntelligenceView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
              )}
              {view === "coverage" && <CoverageView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />}
              {view === "repPerformance" && (
                <RepPerformanceView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
              )}
              {view === "customerBrand" && (
                <CustomerBrandView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
              )}
              {view === "profitability" && (
                <ProfitabilityView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
              )}
              {view === "stock" && <StockView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
