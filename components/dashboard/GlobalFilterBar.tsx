"use client";

import { Broom20Regular } from "@fluentui/react-icons";
import { usePathname } from "next/navigation";
import { ALL_DAY_NAMES, useDashboardStore } from "@/lib/store";
import { resolvePeriodMonths } from "@/lib/timeIntelligence";
import { pageKeyForPathname } from "@/lib/pageAccess";
import { useCurrentUser } from "./UserContext";
import { PeriodSelector } from "./PeriodSelector";
import { PrincipalSelector } from "./PrincipalSelector";
import { DayNameSelector } from "./DayNameFilter";
import { InlineReportExport } from "@/components/reports/InlineReportExport";

/** Sticky filter strip below the header — period + principal, visible on
 *  every analytics page. Principal selection used to live in the Sidebar;
 *  it's a filter, not navigation, so it belongs here instead. Also the one
 *  place every non-Timestamps report-backed page can host its "extract"
 *  button next to the exact filters that extract will use — InlineReportExport
 *  quietly renders nothing on a page with no matching report definition. */
export function GlobalFilterBar() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);
  const clearAllFilters = useDashboardStore((s) => s.clearAllFilters);
  const salesSection = useDashboardStore((s) => s.salesSection);
  const selectedDayNames = useDashboardStore((s) => s.selectedDayNames);
  const hasDayFilter = selectedDayNames.size !== ALL_DAY_NAMES.length;
  const showExecutiveControls = pathname === "/dashboard" || (pathname === "/sales" && salesSection === "executive");
  const selectedPeriod = useDashboardStore((s) => s.selectedPeriod);
  const canFilterExecutiveDays = showExecutiveControls && resolvePeriodMonths(selectedPeriod).length === 1;

  // Timestamps owns a compact report-specific control bar, where its rep,
  // date, role, and principal filters need to sit together. Keeping this
  // shared bar there would duplicate the principal control and waste a row.
  if (!dataset || pathname?.startsWith("/timestamps")) return null;

  return (
    <div className="sticky top-[72px] md:top-[84px] z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-8 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodSelector />
        <PrincipalSelector />
        {canFilterExecutiveDays ? <DayNameSelector /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <InlineReportExport
          reportKey={pageKeyForPathname(pathname) ?? ""}
          allowedPages={user?.allowedPages ?? []}
          isAdmin={user?.role === "ADMIN"}
        />
        <button
          onClick={clearAllFilters}
          disabled={selectedPrincipalKeys.length === 0 && !hasUserSelectedPeriod && !hasDayFilter}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-strong hover:border-brand-orange hover:text-brand-orange disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-300"
        >
          <Broom20Regular className="h-3.5 w-3.5" /> Clear Filters
        </button>
      </div>
    </div>
  );
}
