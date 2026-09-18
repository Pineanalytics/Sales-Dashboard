"use client";

import { Warning20Regular } from "@fluentui/react-icons";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatNumber } from "@/lib/format";

interface Exception {
  label: string;
  count: number;
}

/** A fast-scan risk summary for a presenter — built entirely from figures
 *  the panels below already compute, no new data sourcing. Only non-zero
 *  exceptions render, matching Order 360's own "no notable findings"
 *  convention (an all-clear state is good news, not an empty warning). */
export function ExceptionsStrip({
  offTargetPrincipals,
  outOfStockCount,
  overstockedCount,
  creditLimitBreaches,
}: {
  offTargetPrincipals: number;
  outOfStockCount: number;
  overstockedCount: number;
  creditLimitBreaches: number;
}) {
  const exceptions: Exception[] = [
    { label: "principal(s) well off target", count: offTargetPrincipals },
    { label: "SKU(s) out of stock", count: outOfStockCount },
    { label: "SKU(s) overstocked", count: overstockedCount },
    { label: "customer(s) over credit limit", count: creditLimitBreaches },
  ].filter((e) => e.count > 0);

  if (exceptions.length === 0) {
    return (
      <SectionCard accent="green">
        <p className="text-sm font-semibold text-muted-strong">No exceptions flagged — every tracked risk is within range for this selection.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard accent="red">
      <div className="flex flex-wrap gap-4">
        {exceptions.map((e) => (
          <div key={e.label} className="flex items-center gap-2">
            <Warning20Regular className="text-accent-red" />
            <span className="text-sm">
              <span className="font-bold tabular-nums">{formatNumber(e.count)}</span> <span className="text-muted-strong">{e.label}</span>
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
