"use client";

import { Broom20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { PeriodSelector } from "./PeriodSelector";
import { PrincipalSelector } from "./PrincipalSelector";

/** Sticky filter strip below the header — period + principal, visible on
 *  every analytics page. Principal selection used to live in the Sidebar;
 *  it's a filter, not navigation, so it belongs here instead. */
export function GlobalFilterBar() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);
  const clearAllFilters = useDashboardStore((s) => s.clearAllFilters);

  if (!dataset) return null;

  return (
    <div className="sticky top-[72px] md:top-[84px] z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-8 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodSelector />
        <PrincipalSelector />
      </div>
      <button
        onClick={clearAllFilters}
        disabled={!selectedPrincipalKey && !hasUserSelectedPeriod}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-strong hover:border-brand-orange hover:text-brand-orange disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-300"
      >
        <Broom20Regular className="h-3.5 w-3.5" /> Clear Filters
      </button>
    </div>
  );
}
