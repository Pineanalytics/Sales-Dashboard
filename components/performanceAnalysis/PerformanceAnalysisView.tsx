"use client";

import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "@/lib/store";
import { normalizePrincipalKey } from "@/lib/normalize";
import { CANONICAL_MONTHS, resolvePeriodMonths, type PeriodSelection } from "@/lib/timeIntelligence";
import { GP_BASIS_LABELS, type GpBasis, type PerformanceResponse } from "@/lib/performanceAnalysis/types";
import { CustomersSection } from "./CustomersSection";
import { GrowthSection } from "./GrowthSection";
import { ItemsSection } from "./ItemsSection";
import { MonthlySection } from "./MonthlySection";
import { OperationsSection } from "./OperationsSection";
import { PrincipalsSection } from "./PrincipalsSection";
import { SummarySection } from "./SummarySection";
import { Panel, Segmented } from "./shared";

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "principals", label: "Principals" },
  { id: "monthly", label: "Month on month" },
  { id: "items", label: "Top items" },
  { id: "customers", label: "Customers" },
  { id: "growth", label: "Growth & GP" },
  { id: "operations", label: "Branches, reps & returns" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Until the viewer touches the period filter the page shows the whole year to the latest month,
 *  the same convention the Overview uses (the filter's own default is just the current month). */
function effectivePeriod(selected: PeriodSelection, userChose: boolean): PeriodSelection {
  if (userChose) return selected;
  return { kind: "YTD", year: selected.year, month: selected.month ?? CANONICAL_MONTHS[new Date().getUTCMonth()] };
}

const monthKey = (year: string, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

interface LoadState {
  key: string;
  response?: PerformanceResponse;
  error?: string;
}

export function PerformanceAnalysisView() {
  const selectedPeriod = useDashboardStore((s) => s.selectedPeriod);
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const [tab, setTab] = useState<TabId>("summary");
  const [basis, setBasis] = useState<GpBasis>("dashboard");
  const [state, setState] = useState<LoadState>({ key: "" });

  const query = useMemo(() => {
    const period = effectivePeriod(selectedPeriod, hasUserSelectedPeriod);
    const months = period.year ? resolvePeriodMonths(period).map((m) => monthKey(m.year, m.monthIndex)) : [];
    if (months.length === 0) return "";
    const params = new URLSearchParams({ months: months.join(","), basis });
    const principals = Array.from(new Set(selectedPrincipalKeys.map((key) => normalizePrincipalKey(key)).filter(Boolean)));
    if (principals.length > 0) params.set("principals", principals.join(","));
    return params.toString();
  }, [selectedPeriod, hasUserSelectedPeriod, selectedPrincipalKeys, basis]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    fetch(`/api/performance-analysis?${query}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
        return (await res.json()) as PerformanceResponse;
      })
      .then((response) => setState({ key: query, response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((previous) => ({ key: query, response: previous.response, error: error instanceof Error ? error.message : "The report could not be loaded." }));
      });
    return () => controller.abort();
  }, [query]);

  const loading = query !== "" && state.key !== query;
  const report = state.response?.report ?? null;
  const meta = state.response?.meta ?? null;
  const hasData = report !== null && report.kpi.lines > 0;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight text-foreground">Performance analysis</h1>
      </header>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-full bg-background-elevated p-1" role="tablist" aria-label="Performance analysis sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === item.id ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-sm" : "text-muted-strong hover:text-primary-blue"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Gross profit basis</span>
          <Segmented
            label="Gross profit basis"
            value={basis}
            onChange={setBasis}
            options={(Object.keys(GP_BASIS_LABELS) as GpBasis[]).map((value) => ({ value, label: GP_BASIS_LABELS[value] }))}
          />
        </div>
      </div>
      {!hasUserSelectedPeriod ? <p className="-mt-2 text-xs text-muted">Showing the year to date. Choose a period above to narrow it.</p> : null}

      {state.error ? (
        <Panel>
          <p className="py-6 text-center text-sm text-red-600">{state.error}</p>
        </Panel>
      ) : null}

      {!state.response && !state.error ? (
        <Panel>
          <p className="py-10 text-center text-sm text-muted">Loading the report…</p>
        </Panel>
      ) : null}

      {state.response && !hasData && !loading ? (
        <Panel>
          <p className="py-10 text-center text-sm text-muted">
            {meta ? "No SAP sales were recorded for this period and principal selection." : "The performance report has not been built yet. It refreshes once a day from SAP."}
          </p>
        </Panel>
      ) : null}

      {report && hasData ? (
        <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-50" : ""}`} aria-busy={loading}>
          {tab === "summary" ? <SummarySection p={report} /> : null}
          {tab === "principals" ? <PrincipalsSection p={report} /> : null}
          {tab === "monthly" ? <MonthlySection p={report} /> : null}
          {tab === "items" ? <ItemsSection p={report} /> : null}
          {tab === "customers" ? <CustomersSection p={report} /> : null}
          {tab === "growth" ? <GrowthSection p={report} /> : null}
          {tab === "operations" ? <OperationsSection p={report} /> : null}

          <footer className="border-t border-border pt-4 text-[13px] text-muted">
            Source: SAP Business One invoices and credit notes, {report.kpi.lines.toLocaleString()} document lines in this selection, {report.kpi.customers.toLocaleString()} customer accounts, {report.kpi.skus.toLocaleString()} SKUs.
            Sales = line total excl. VAT, invoices less credit notes. {GP_BASIS_LABELS[basis]} shown.
            {meta && meta.excludedLines > 0 ? ` ${meta.excludedLines.toLocaleString()} lines (KES ${(meta.excludedSales / 1e6).toFixed(1)}M) belong to items with no active principal and are left out, as they are on Sales Performance.` : ""}
            {report.labels.cq && report.labels.pq ? ` Growth compares ${report.labels.cq} with ${report.labels.pq}.` : ""}
          </footer>
        </div>
      ) : null}
    </div>
  );
}
