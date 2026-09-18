"use client";

import { Warning20Regular } from "@fluentui/react-icons";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatNumber } from "@/lib/format";

interface Exception {
  label: string;
  count: number;
  /** Anchors to the panel section below that already lists this exception's
   *  detail (principals, SKUs, customers) — jumps down the page rather than
   *  navigating away, so a presentation never leaves this one screen. */
  href: string;
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
    { label: "principal(s) well off target", count: offTargetPrincipals, href: "#sales-summary" },
    { label: "SKU(s) out of stock", count: outOfStockCount, href: "#stock-risk" },
    { label: "SKU(s) overstocked", count: overstockedCount, href: "#stock-risk" },
    { label: "customer(s) over credit limit", count: creditLimitBreaches, href: "#financials" },
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
          <a
            key={e.label}
            href={e.href}
            className="flex items-center gap-2 rounded-full transition-opacity duration-200 hover:opacity-70"
          >
            <Warning20Regular className="text-accent-red" />
            <span className="text-sm">
              <span className="font-bold tabular-nums">{formatNumber(e.count)}</span> <span className="text-muted-strong underline decoration-dotted underline-offset-2">{e.label}</span>
            </span>
          </a>
        ))}
      </div>
    </SectionCard>
  );
}
