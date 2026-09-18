"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { periodToDateRange } from "@/lib/executiveSummary";
import type { PeriodSelection } from "@/lib/timeIntelligence";

interface Order360Meta {
  totalOrders: number;
  totalValue: number;
  podConfirmedPct: number;
}
interface FunnelStage {
  stage: string;
  count: number;
}
interface BacklogRow {
  amount: number;
}
interface Order360Response {
  meta: Order360Meta;
  funnel: FunnelStage[];
  backlog: { clearance: BacklogRow[]; pick: BacklogRow[]; dispatch: BacklogRow[]; audit: BacklogRow[]; delivery: BacklogRow[] };
}

const BACKLOG_STAGES = ["clearance", "pick", "dispatch", "audit", "delivery"] as const;

/** Order 360's source data carries no principal dimension at all (see
 *  lib/order360Summary.ts's own header note) — this panel always shows the
 *  whole company regardless of the executive summary's principal filter,
 *  but it does translate the selected period into Order 360's own date-range
 *  filter (lib/executiveSummary.ts's periodToDateRange), same /api/order-360
 *  route the Order 360 page itself calls. */
export function OrderFulfillmentPanel({ period }: { period: PeriodSelection }) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [data, setData] = useState<Order360Response | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const range = periodToDateRange(period);
      if (!range) {
        setStatus("error");
        return;
      }
      const params = new URLSearchParams({ dateFrom: range.dateFrom, dateTo: range.dateTo });
      try {
        const res = await fetch(`/api/order-360?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as Order360Response & { error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load Order 360 data.");
        if (controller.signal.aborted) return;
        setData(body);
        setStatus("idle");
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Executive summary: failed to load Order 360 data", err);
          setStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [period]);

  return (
    <SectionCard
      title="Order Fulfillment"
      accent="purple"
      action={<span className="text-xs text-muted">Company-wide — no principal breakdown in source data</span>}
    >
      {status === "loading" ? (
        <p className="text-xs text-muted">Loading order pipeline…</p>
      ) : status === "error" || !data ? (
        <p className="text-xs text-muted">Couldn&apos;t load Order 360 data for this period.</p>
      ) : (
        <OrderFulfillmentBody data={data} />
      )}
    </SectionCard>
  );
}

function OrderFulfillmentBody({ data }: { data: Order360Response }) {
  const deliveredCount = data.funnel[data.funnel.length - 1]?.count ?? 0;
  const deliveredPct = data.meta.totalOrders > 0 ? (deliveredCount / data.meta.totalOrders) * 100 : null;
  const openBacklogCount = BACKLOG_STAGES.reduce((sum, stage) => sum + data.backlog[stage].length, 0);
  const openBacklogValue = BACKLOG_STAGES.reduce((sum, stage) => sum + data.backlog[stage].reduce((s, r) => s + r.amount, 0), 0);

  return (
    <KpiGrid>
      <KpiCard accent="revenue" label="Total Orders" value={formatNumber(data.meta.totalOrders)} sublabel={formatCompact(data.meta.totalValue)} />
      <KpiCard accent="growth" label="Delivered" value={formatNumber(deliveredCount)} sublabel={formatPercent(deliveredPct)} />
      <KpiCard accent="quarter" label="Open Backlog" value={formatNumber(openBacklogCount)} sublabel={`${formatCompact(openBacklogValue)} tied up`} />
      <KpiCard accent="mission" label="POD Confirmed" value={formatPercent(data.meta.podConfirmedPct)} />
    </KpiGrid>
  );
}
