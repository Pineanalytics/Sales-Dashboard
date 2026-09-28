"use client";

import { Presenter20Regular, PresenterOff20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import type { PeriodSelection } from "@/lib/timeIntelligence";
import { SalesSummaryPanel } from "@/components/executiveSummary/SalesSummaryPanel";
import { FieldBehaviorPanel } from "@/components/executiveSummary/FieldBehaviorPanel";
import { TeamLeaderPerformancePanel } from "@/components/executiveSummary/TeamLeaderPerformancePanel";
import { CoveragePanel } from "./CoveragePanel";
import { WeeklyMonthlyTargetPanel } from "./WeeklyMonthlyTargetPanel";
import type { WeeklyMonthlyTargetSummary } from "@/lib/commercialPerformance";

/** Matches ExecutiveSummaryClient's own periodLabelFor exactly — small enough
 *  that duplicating it locally beats exporting a one-off cross-module
 *  dependency for a single reuse. */
function periodLabelFor(period: PeriodSelection): string {
  if (period.kind === "H1" || period.kind === "H2" || period.kind.startsWith("Q")) return `${period.kind} ${period.year}`;
  return `${period.kind} ${period.month ?? ""} ${period.year}`.replace(/\s+/g, " ").trim();
}

/** The Commercial department's deep-dive view — the same sales/coverage/
 *  behavior selectors Executive Summary shows one tile of each for, laid out
 *  full-page instead of squeezed half-width alongside Stock Risk/Financials/
 *  etc. Executive Summary stays the cross-department at-a-glance page; this
 *  is the single-department expansion for Commercial specifically. */
export function CommercialPerformanceClient({ weeklyMonthlyTargetSummary }: { weeklyMonthlyTargetSummary: WeeklyMonthlyTargetSummary }) {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const presentationMode = useDashboardStore((s) => s.presentationMode);
  const setPresentationMode = useDashboardStore((s) => s.setPresentationMode);

  if (!dataset) return null;

  const todayLabel = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-strong">
          Commercial Performance · {selectedPrincipalKey ?? "All Principals"} · {periodLabelFor(period)} · as of {todayLabel}
        </p>
        <button
          onClick={() => setPresentationMode(!presentationMode)}
          className="no-print flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-strong transition-colors duration-300 hover:bg-accent-blue-soft hover:text-primary-blue"
          aria-pressed={presentationMode}
        >
          {presentationMode ? <PresenterOff20Regular /> : <Presenter20Regular />}
          {presentationMode ? "Exit presentation mode" : "Presentation mode"}
        </button>
      </div>

      <SalesSummaryPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <CoveragePanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
        <WeeklyMonthlyTargetPanel summary={weeklyMonthlyTargetSummary} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <FieldBehaviorPanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
        <TeamLeaderPerformancePanel dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} />
      </div>
    </div>
  );
}
