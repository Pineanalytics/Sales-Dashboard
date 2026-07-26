"use client";

import { SectionCard } from "@/components/ui/KpiGrid";
import { tierBarColor, achievementTier } from "@/lib/format";
import type { Dataset } from "@/lib/types";
import { summarizeSalesByPrincipal, type PeriodSelection } from "@/lib/timeIntelligence";

/** Horizontal GP-margin-% bar per Principal — same underlying data as
 *  ProfitabilityView.tsx's vertical bar chart (summarizeSalesByPrincipal), just laid
 *  out horizontally to match the reference dashboard's "Principal Margins" list. */
export function PrincipalMarginsBars({ dataset, period }: { dataset: Dataset; period: PeriodSelection }) {
  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, period).values())
    .filter((p) => p.revenue > 0)
    .sort((a, b) => (b.grossMarginPct ?? 0) - (a.grossMarginPct ?? 0));

  if (byPrincipal.length === 0) {
    return <SectionCard title="Principal Margins">No sales data for this period.</SectionCard>;
  }

  const maxMargin = Math.max(...byPrincipal.map((p) => p.grossMarginPct ?? 0), 1);

  return (
    <SectionCard title="Principal Margins">
      <div className="flex flex-col gap-2">
        {byPrincipal.map((p) => {
          const pct = p.grossMarginPct ?? 0;
          const tier = achievementTier(pct >= 15 ? 100 : pct >= 8 ? 70 : 40);
          return (
            <div key={p.principalKey} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 truncate text-muted-strong" title={p.principal}>
                {p.principal}
              </span>
              <div className="flex-1 h-2.5 rounded-full bg-background-elevated overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(2, (pct / maxMargin) * 100)}%`, background: tierBarColor[tier] }}
                />
              </div>
              <span className="w-12 shrink-0 text-right tabular-nums font-semibold text-foreground">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
