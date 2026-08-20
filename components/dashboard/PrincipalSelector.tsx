"use client";

import { useDashboardStore } from "@/lib/store";
import { principalsByRevenueDesc } from "@/lib/selectors";
import { AchievementBadge } from "@/components/ui/Badge";

/** Principal filter — extracted from the old Sidebar so it can live in the
 *  GlobalFilterBar instead. Renders a compact dropdown rather than the old
 *  full pill-list, since the filter bar is a horizontal strip, not a
 *  scrollable vertical rail. */
export function PrincipalSelector() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const selectPrincipal = useDashboardStore((s) => s.selectPrincipal);
  const period = useDashboardStore((s) => s.selectedPeriod);

  if (!dataset) return null;

  const principals = principalsByRevenueDesc(dataset, period);
  const principalOptions = Array.from(new Set(dataset.monthlySales.map((row) => row.principal))).sort((a, b) => a.localeCompare(b));
  const selected = principals.find((p) => p.principalKey === selectedPrincipalKey) ?? null;

  return (
    <div className="flex items-end gap-2 rounded-xl border border-border bg-background-elevated px-3 py-2">
      <label className="flex min-w-[190px] flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Principal
      <select
        aria-label="Principal"
        value={selectedPrincipalKey ?? ""}
        onChange={(e) => selectPrincipal(e.target.value || null)}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-xs font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary-blue"
      >
        <option value="">All Principals</option>
        {principalOptions.map((principal) => (
          <option key={principal} value={principal}>
            {principal}
          </option>
        ))}
      </select>
      </label>
      {selected ? <AchievementBadge pct={selected.achievementPct} /> : null}
    </div>
  );
}
