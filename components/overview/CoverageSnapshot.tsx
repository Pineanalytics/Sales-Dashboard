import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { formatNumber, formatPercent } from "@/lib/format";
import { summarizeCoverageForPeriod, summarizeCoverageByRep, type PeriodSelection, type RoleCategory } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import { CoverageRoleToggle } from "./CoverageRoleToggle";

/** Executive Overview add-on — a compact coverage/productivity summary next to the
 *  full OverviewView, built entirely from existing summarizers. Does not modify
 *  OverviewView.tsx or CoverageView.tsx. */
export function CoverageSnapshot({
  dataset,
  selectedPrincipalKey,
  period,
  role,
  onRoleChange,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
  role: Extract<RoleCategory, "primary" | "secondary">;
  onRoleChange: (role: Extract<RoleCategory, "primary" | "secondary">) => void;
}) {
  const roleLabel = role === "primary" ? "Primary" : "Secondary";
  const summary = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey, role);
  const repSummaries = summarizeCoverageByRep(dataset, period, selectedPrincipalKey, role);
  const topReps = repSummaries
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, 5);
  const averageCoverage = repSummaries.length > 0 ? summary.coverage / repSummaries.length : 0;

  return (
    <SectionCard title="Coverage & Productivity Snapshot" action={<CoverageRoleToggle value={role} onChange={onRoleChange} />}>
      <div className="flex flex-col gap-4 p-1">
        <div className="grid grid-cols-2 gap-3">
          <KpiCard accent="coverage" label={`${roleLabel} Coverage`} value={<AnimatedValue value={summary.coverage} format={formatNumber} />} />
          <KpiCard accent="coverage" label="Productive Calls" value={<AnimatedValue value={summary.productiveCalls} format={formatNumber} />} />
          <KpiCard accent="coverage" label="Productivity %" value={formatPercent(summary.productivityPct)} />
          <KpiCard accent="coverage" label="Active Reps" value={<AnimatedValue value={repSummaries.length} format={formatNumber} />} sublabel={`${formatNumber(averageCoverage)} avg coverage / rep`} />
        </div>

        {topReps.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Top {roleLabel} Reps by Coverage</span>
            {topReps.map((r) => (
              <div key={r.employeeName} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-strong">{r.employeeName}</span>
                <span className="shrink-0 tabular-nums font-semibold text-foreground">{formatNumber(r.coverage)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
