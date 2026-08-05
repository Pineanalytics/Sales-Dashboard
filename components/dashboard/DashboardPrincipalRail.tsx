"use client";

import { useDashboardStore } from "@/lib/store";
import { principalsByRevenueDesc } from "@/lib/selectors";

/** Scrollable 2-column pill grid for Principal selection, matching the reference
 *  dashboard's dark-navy sidebar list. New, additive component for the Executive
 *  Overview's own rail — the existing dropdown PrincipalSelector (used in the
 *  always-visible GlobalFilterBar on every other page) is untouched. Reads/writes
 *  the same store field, so switching a principal here stays in sync everywhere. */
export function DashboardPrincipalRail() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectedPrincipalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const selectPrincipal = useDashboardStore((s) => s.selectPrincipal);
  const period = useDashboardStore((s) => s.selectedPeriod);

  if (!dataset) return null;

  const principals = principalsByRevenueDesc(dataset, period);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Principal</span>
      <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
        <button
          onClick={() => selectPrincipal(null)}
          className={`col-span-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold transition-colors duration-200 ${
            selectedPrincipalKey === null ? "bg-brand-orange text-white" : "bg-dark-navy text-white/90 hover:bg-primary-blue"
          }`}
        >
          All Principals
        </button>
        {principals.map((p) => {
          const active = selectedPrincipalKey === p.principalKey;
          return (
            <button
              key={p.principalKey}
              onClick={() => selectPrincipal(active ? null : p.principalKey)}
              title={p.principal}
              className={`truncate rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold transition-colors duration-200 ${
                active ? "bg-brand-orange text-white" : "bg-dark-navy text-white/90 hover:bg-primary-blue"
              }`}
            >
              {p.principal}
            </button>
          );
        })}
      </div>
    </div>
  );
}
