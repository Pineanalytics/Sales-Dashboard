"use client";

import { Broom20Regular, Filter20Regular } from "@fluentui/react-icons";
import { usePathname } from "next/navigation";
import { useDashboardStore } from "@/lib/store";
import { PeriodSelector } from "./PeriodSelector";
import { PrincipalSelector } from "./PrincipalSelector";

/** Sticky filter strip below the header — period + principal, visible on
 *  every analytics page. Principal selection used to live in the Sidebar;
 *  it's a filter, not navigation, so it belongs here instead. */
export function GlobalFilterBar() {
  const pathname = usePathname();
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);
  const clearAllFilters = useDashboardStore((s) => s.clearAllFilters);

  // Timestamps owns a compact report-specific control bar, where its rep,
  // date, role, and principal filters need to sit together. Keeping this
  // shared bar there would duplicate the principal control and waste a row.
  // Executive Overview owns a denser, dashboard-specific control surface that
  // groups its MTD/YTD switch with these same store-backed selectors. Showing
  // this shared bar there as well would duplicate the Principal control.
  if (!dataset || pathname?.startsWith("/timestamps") || pathname === "/dashboard") return null;

  return (
    <div className="sticky top-[72px] md:top-[84px] z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-1.5 pr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted lg:inline-flex"><Filter20Regular className="h-3.5 w-3.5" /> View</span>
        <PeriodSelector />
        <PrincipalSelector />
      </div>
      <button
        onClick={clearAllFilters}
        disabled={selectedPrincipalKeys.length === 0 && !hasUserSelectedPeriod}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-muted-strong hover:border-brand-orange hover:text-brand-orange disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-300"
      >
        <Broom20Regular className="h-3.5 w-3.5" /> Clear Filters
      </button>
    </div>
  );
}
