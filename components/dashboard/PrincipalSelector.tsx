"use client";

import { useDashboardStore } from "@/lib/store";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { AchievementBadge } from "@/components/ui/Badge";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

/** Principal filter — extracted from the old Sidebar so it can live in the
 *  GlobalFilterBar instead. Renders a compact dropdown rather than the old
 *  full pill-list, since the filter bar is a horizontal strip, not a
 *  scrollable vertical rail. */
export function PrincipalSelector() {
  const dataset = useDashboardStore((s) => s.sourceDataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const setPrincipalSelection = useDashboardStore((s) => s.setPrincipalSelection);
  const period = useDashboardStore((s) => s.selectedPeriod);

  if (!dataset) return null;

  const principals = principalsByRevenueDesc(dataset, period);
  const principalOptions = Array.from(new Set(dataset.monthlySales.map((row) => row.principal))).sort((a, b) => a.localeCompare(b));
  const selected = principals.find((p) => p.principalKey === selectedPrincipalKey) ?? null;

  return (
    <div className="flex items-end gap-2 rounded-xl border border-border bg-background-elevated px-3 py-2">
      <MultiSelectFilter
        label="Principal"
        options={principalOptions.map((principal) => ({ value: principal, label: principal }))}
        value={selectedPrincipalKeys}
        onChange={setPrincipalSelection}
        allLabel="All Principals"
      />
      {selected ? <AchievementBadge pct={selected.achievementPct} /> : null}
    </div>
  );
}
