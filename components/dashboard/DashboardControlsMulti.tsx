"use client";

import { Broom20Regular, CalendarMonth20Regular, Filter20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { PeriodSelector } from "./PeriodSelector";
import { PrincipalSelector } from "./PrincipalSelector";

export type DashboardView = "mtd" | "ytd";

export function ExecutiveViewSwitch({ view, onViewChange }: { view: DashboardView; onViewChange: (view: DashboardView) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg bg-background-elevated p-1" aria-label="Executive summary view">
      {([ { key: "mtd", label: "MTD Sales" }, { key: "ytd", label: "YTD Summary" } ] as const).map((option) => (
        <button key={option.key} type="button" onClick={() => onViewChange(option.key)} className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${view === option.key ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** In the embedded Sales workspace this is only a mode switch because the
 * shared filter bar already owns period, principal and clear. The standalone
 * /dashboard route retains its complete control surface. */
export function DashboardControlsMulti({ view, onViewChange, compact = false }: { view: DashboardView; onViewChange: (view: DashboardView) => void; compact?: boolean }) {
  const selectedPrincipalKeys = useDashboardStore((state) => state.selectedPrincipalKeys);
  const hasUserSelectedPeriod = useDashboardStore((state) => state.hasUserSelectedPeriod);
  const clearAllFilters = useDashboardStore((state) => state.clearAllFilters);

  if (compact) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-[0_2px_8px_rgba(11,61,53,0.06)]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-strong">Executive view</span>
          <ExecutiveViewSwitch view={view} onViewChange={onViewChange} />
        </div>
        <span className="text-[11px] text-muted">{view === "mtd" ? "Current calendar month" : "Year through selected month"}</span>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-[0_4px_14px_rgba(11,61,53,0.08)] md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <ExecutiveViewSwitch view={view} onViewChange={onViewChange} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l-0 border-border pl-0 md:border-l md:pl-3">
            <Filter20Regular className="hidden h-4 w-4 shrink-0 text-primary-blue md:block" aria-hidden="true" />
            <PrincipalSelector />
            {view === "ytd" ? (
              <div className="min-w-0 border-l border-border pl-2">
                <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted"><CalendarMonth20Regular className="h-3.5 w-3.5" /> Reporting range</span>
                <PeriodSelector />
              </div>
            ) : <span className="rounded-full bg-accent-blue-soft px-3 py-1.5 text-[11px] font-semibold text-primary-blue">Current calendar month</span>}
          </div>
        </div>
        <button type="button" onClick={clearAllFilters} disabled={selectedPrincipalKeys.length === 0 && !hasUserSelectedPeriod} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-strong transition-colors hover:border-brand-orange hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-40">
          <Broom20Regular className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
    </section>
  );
}
