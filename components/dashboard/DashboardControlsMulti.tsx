"use client";

import { Broom20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { PeriodSelector } from "./PeriodSelector";
import { PrincipalSelector } from "./PrincipalSelector";

/** Legacy standalone control surface. The dashboard uses one calendar-driven
 * view; there is no separate MTD/YTD mode to maintain. */
export function DashboardControlsMulti({ compact = false }: { compact?: boolean }) {
  const selectedPrincipalKeys = useDashboardStore((state) => state.selectedPrincipalKeys);
  const hasUserSelectedPeriod = useDashboardStore((state) => state.hasUserSelectedPeriod);
  const clearAllFilters = useDashboardStore((state) => state.clearAllFilters);

  return (
    <section className={`rounded-xl border border-border bg-surface ${compact ? "px-3 py-2" : "px-4 py-3 md:px-5"} shadow-[0_4px_14px_rgba(11,61,53,0.08)]`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <PeriodSelector />
          <PrincipalSelector />
        </div>
        <button type="button" onClick={clearAllFilters} disabled={selectedPrincipalKeys.length === 0 && !hasUserSelectedPeriod} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-strong transition-colors hover:border-brand-orange hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-40">
          <Broom20Regular className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
    </section>
  );
}
