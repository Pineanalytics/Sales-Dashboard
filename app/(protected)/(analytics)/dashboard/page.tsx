"use client";

import { useDashboardStore } from "@/lib/store";
import { OverviewView } from "@/components/views/OverviewView";
import { GrowthComparison } from "@/components/overview/GrowthComparison";
import { CoverageSnapshot } from "@/components/overview/CoverageSnapshot";
import { TopPerformers } from "@/components/overview/TopPerformers";
import type { PeriodSelection } from "@/lib/timeIntelligence";

export default function DashboardPage() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);
  if (!dataset) return null;

  // Matches OverviewView's own internal "YTD until touched" fallback, so the two new
  // sections below stay consistent with what OverviewView is already showing — kept
  // here rather than in OverviewView.tsx so that component stays untouched.
  const effectivePeriod: PeriodSelection = hasUserSelectedPeriod
    ? period
    : { kind: "YTD", year: period.year, month: period.month };

  return (
    <>
      <OverviewView dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={period} />
      <GrowthComparison dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={effectivePeriod} />
      <CoverageSnapshot dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={effectivePeriod} />
      <TopPerformers dataset={dataset} selectedPrincipalKey={selectedPrincipalKey} period={effectivePeriod} />
    </>
  );
}
