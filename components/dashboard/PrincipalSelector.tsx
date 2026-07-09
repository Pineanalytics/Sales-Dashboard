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
  const selected = principals.find((p) => p.principalKey === selectedPrincipalKey) ?? null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-background-elevated px-3 py-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted shrink-0">Principal</label>
      <select
        aria-label="Principal"
        value={selectedPrincipalKey ?? ""}
        onChange={(e) => selectPrincipal(e.target.value || null)}
        className="bg-transparent text-xs font-semibold text-muted-strong outline-none max-w-[160px] truncate"
      >
        <option value="">All Principals</option>
        {principals.map((p) => (
          <option key={p.principalKey} value={p.principalKey}>
            {p.principal}
          </option>
        ))}
      </select>
      {selected ? <AchievementBadge pct={selected.achievementPct} /> : null}
    </div>
  );
}
