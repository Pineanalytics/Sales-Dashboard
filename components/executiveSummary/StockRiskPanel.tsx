"use client";

import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatNumber } from "@/lib/format";
import { aggregateStockByPrincipal, classifyDormantPrincipals, sumStockRollups, computeOverstock, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/stock";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { Dataset } from "@/lib/types";

const DRILLDOWN_LINK_CLASS = "font-semibold text-primary-blue hover:underline";

/** Full detail listings (which SKUs, which principals) now live in Stock
 *  Balance itself — see components/views/StockView.tsx's Out of
 *  Stock/Overstocked tabs and its cross-principal "Stock by Item" table —
 *  reached here via ?status= deep links, rather than duplicating those same
 *  tables inline in this at-a-glance KPI summary. */
export function StockRiskPanel({ dataset, selectedPrincipalKey }: { dataset: Dataset; selectedPrincipalKey: string | null }) {
  // Stock has no period dimension (it's a point-in-time snapshot, not a
  // monthly time series like Sales), and its rows key by normalized brand,
  // not the raw Principal/location label the global filter carries — same
  // normalization StockView.tsx applies before any Stock lookup.
  const normalizedKey = selectedPrincipalKey ? normalizePrincipalKey(selectedPrincipalKey) : null;

  const allRollups = aggregateStockByPrincipal(dataset);
  const { dormantKeys } = classifyDormantPrincipals(dataset, allRollups.map((r) => r.key));
  const activeRollups = allRollups.filter((r) => !dormantKeys.has(r.key));

  const scopedRollups = normalizedKey ? activeRollups.filter((r) => r.key === normalizedKey) : activeRollups;
  const total = sumStockRollups(scopedRollups);
  const overstock = computeOverstock(dataset, normalizedKey);

  return (
    <div id="stock-risk" className="@container">
      <SectionCard
        title="Stock Risk"
        accent="amber"
        action={
          <Link href="/stock" className={`text-xs ${DRILLDOWN_LINK_CLASS}`}>
            Open Stock Balance →
          </Link>
        }
      >
        {/* Sized to this panel's own (container-query) width, not the
            viewport — KpiGrid's viewport breakpoints misfire when nested in
            a half-width xl:grid-cols-2 pairing (see ExecutiveSummaryClient),
            cramming 4 cards into a 6-track grid sized for the full page. */}
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
          <KpiCard accent="revenue" label="Stock Value" value={formatCompact(total.value)} />
          <KpiCard
            accent="growth"
            label="Out of Stock"
            value={formatNumber(total.outOfStockCount)}
            sublabel={
              <Link href="/stock?status=outOfStock" className={DRILLDOWN_LINK_CLASS}>
                View SKUs →
              </Link>
            }
          />
          <KpiCard accent="growth" label="Running Out" value={formatNumber(total.runningOutCount)} />
          <KpiCard
            accent="quarter"
            label="Overstocked"
            value={formatNumber(overstock.itemCount)}
            sublabel={
              <Link href="/stock?status=overstocked" className={DRILLDOWN_LINK_CLASS}>
                {formatCompact(overstock.value)} tied up · cover &gt; {OVERSTOCK_DAYS_THRESHOLD}d — View SKUs →
              </Link>
            }
          />
        </div>
      </SectionCard>
    </div>
  );
}
