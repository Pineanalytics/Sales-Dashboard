"use client";

import { useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { BinaryToggle } from "@/components/ui/BinaryToggle";
import { formatNumber, formatPercent, strikeRateTier, tierTextClass } from "@/lib/format";
import { summarizeCoverageForPeriod, summarizeCoverageTargetsForPeriod, type PeriodSelection, type RoleCategory } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

const ROLE_OPTIONS = [
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
] as const;

/** Same Coverage & Productivity selectors that page uses (summarizeCoverageForPeriod
 *  / summarizeCoverageTargetsForPeriod, both dataset-driven — no separate fetch),
 *  laid out as a standalone panel for Commercial Performance's deeper view.
 *  Coverage/Productivity targets are a Primary-only concept (see
 *  summarizeCoverageTargetsForPeriod's own doc comment) — the two "vs Target"
 *  tiles simply don't render for Secondary, same as the Coverage page itself. */
export function CoveragePanel({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const [role, setRole] = useState<RoleCategory>("primary");
  const summary = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey, role);
  const targets = summarizeCoverageTargetsForPeriod(dataset, period, selectedPrincipalKey);
  const targetsApply = role === "primary";

  const coverageAchievementPct = targetsApply && targets.coverageTarget ? Math.round((summary.coverage / targets.coverageTarget) * 1000) / 10 : null;
  const productivityAchievementPct =
    targetsApply && targets.productivityTarget ? Math.round((summary.productiveCalls / targets.productivityTarget) * 1000) / 10 : null;

  return (
    <div id="coverage" className="@container h-full">
      <SectionCard title="Coverage" accent="purple" action={<BinaryToggle value={role} options={ROLE_OPTIONS} onChange={setRole} />}>
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-5">
          <KpiCard accent="coverage" label="Calls Visited" value={formatNumber(summary.coverage)} sublabel="Unique outlet visits" />
          <KpiCard accent="coverage" label="Productive Calls" value={formatNumber(summary.productiveCalls)} sublabel="Sale or order calls" />
          <KpiCard
            accent="quarter"
            label="Strike Rate"
            value={<span className={tierTextClass[strikeRateTier(summary.productivityPct)]}>{formatPercent(summary.productivityPct)}</span>}
            sublabel="Productive ÷ visited"
          />
          {targetsApply ? (
            <KpiCard
              accent="mission"
              label="Coverage vs Target"
              value={coverageAchievementPct === null ? "—" : formatPercent(coverageAchievementPct)}
              sublabel={targets.coverageTarget === null ? "Target not set" : `Target: ${formatNumber(targets.coverageTarget)}`}
            />
          ) : null}
          {targetsApply ? (
            <KpiCard
              accent="mission"
              label="Productivity vs Target"
              value={productivityAchievementPct === null ? "—" : formatPercent(productivityAchievementPct)}
              sublabel={targets.productivityTarget === null ? "Target not set" : `Target: ${formatNumber(targets.productivityTarget)}`}
            />
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
