import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact } from "@/lib/format";
import { summarizeBrandCustomerByRep, summarizeBrandCustomerByCustomer, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

/** Executive Overview add-on — top reps and top customers by revenue, built entirely
 *  from existing summarizers. Does not modify RepPerformanceView.tsx or
 *  CustomerBrandView.tsx. */
export function TopPerformers({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const topReps = summarizeBrandCustomerByRep(dataset, period, selectedPrincipalKey)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  const topCustomers = summarizeBrandCustomerByCustomer(dataset, period, selectedPrincipalKey)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return (
    <SectionCard title="Top Performers">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-1">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Top Reps by Revenue</span>
          {topReps.length === 0 ? (
            <p className="text-xs text-muted">No rep data for this period.</p>
          ) : (
            topReps.map((r) => (
              <div key={r.salesEmployee} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-strong">{r.salesEmployee}</span>
                <span className="shrink-0 tabular-nums font-semibold text-foreground">{formatCompact(r.revenue)}</span>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Top Customers by Revenue</span>
          {topCustomers.length === 0 ? (
            <p className="text-xs text-muted">No customer data for this period.</p>
          ) : (
            topCustomers.map((c) => (
              <div key={c.customerName} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-strong">{c.customerName}</span>
                <span className="shrink-0 tabular-nums font-semibold text-foreground">{formatCompact(c.revenue)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </SectionCard>
  );
}
