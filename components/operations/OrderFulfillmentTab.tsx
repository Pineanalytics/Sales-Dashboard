"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { periodToDateRange } from "@/lib/executiveSummary";
import { resolvePeriodMonths, type PeriodSelection } from "@/lib/timeIntelligence";

interface FunnelStage {
  stage: string;
  count: number;
}
interface BacklogRow {
  amount: number;
}
interface Order360Response {
  meta: { totalOrders: number; totalValue: number; podConfirmedPct: number; podConfirmedCount: number; podUnconfirmedCount: number };
  funnel: FunnelStage[];
  backlog: { clearance: BacklogRow[]; pick: BacklogRow[]; dispatch: BacklogRow[]; audit: BacklogRow[]; delivery: BacklogRow[] };
  payments: { stkCount: number; noStkCount: number; stkValuePaid: number };
  availableMonths: string[];
}

const BACKLOG_STAGES = ["clearance", "pick", "dispatch", "audit", "delivery"] as const;

/** A richer summary than Executive Summary's compact OrderFulfillmentPanel
 *  (same /api/order-360 endpoint, same "no principal dimension" constraint)
 *  — factors in the funnel/pipeline flow, the POD-confirmation disclaimer,
 *  and STK payment totals from the full Order 360 Control Tower, condensed
 *  to a summary rather than reproducing every tab. Everything past this
 *  summary (Action Items, per-stage backlogs, returns, van-level STK usage,
 *  critical findings) lives one click away on the full page. */
export function OrderFulfillmentTab({ period }: { period: PeriodSelection }) {
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
          console.error("Operations: failed to load Order 360 data", err);
          setStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [period]);

  const requestedMonths = resolvePeriodMonths(period).map((m) => `${m.year}-${String(m.monthIndex + 1).padStart(2, "0")}`);
  const hasData = data ? requestedMonths.some((m) => data.availableMonths.includes(m)) : false;

  return (
    <div id="order-fulfillment" className="@container flex flex-col gap-4">
      <SectionCard
        title="Order Fulfillment"
        accent="purple"
        action={
          <Link href="/order-360" className="text-xs font-semibold text-primary-blue hover:underline">
            Open Order 360 Control Tower →
          </Link>
        }
      >
        {status === "loading" ? (
          <p className="text-xs text-muted">Loading order pipeline…</p>
        ) : status === "error" || !data ? (
          <p className="text-xs text-muted">Couldn&apos;t load Order 360 data for this period.</p>
        ) : !hasData ? (
          <p className="text-xs text-muted">
            Order 360 data hasn&apos;t synced for this period yet. Most recent synced month: {data.availableMonths[data.availableMonths.length - 1] ?? "none"}.
          </p>
        ) : (
          <OrderFulfillmentSummary data={data} />
        )}
      </SectionCard>
    </div>
  );
}

function OrderFulfillmentSummary({ data }: { data: Order360Response }) {
  const deliveredCount = data.funnel[data.funnel.length - 1]?.count ?? 0;
  const deliveredPct = data.meta.totalOrders > 0 ? (deliveredCount / data.meta.totalOrders) * 100 : null;
  const openBacklogCount = BACKLOG_STAGES.reduce((sum, stage) => sum + data.backlog[stage].length, 0);
  const openBacklogValue = BACKLOG_STAGES.reduce((sum, stage) => sum + data.backlog[stage].reduce((s, r) => s + r.amount, 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 @sm:grid-cols-5">
        <KpiCard accent="revenue" label="Total Orders" value={formatNumber(data.meta.totalOrders)} sublabel={formatCompact(data.meta.totalValue)} />
        <KpiCard accent="growth" label="Fully Delivered" value={formatNumber(deliveredCount)} sublabel={formatPercent(deliveredPct)} />
        <KpiCard accent="quarter" label="Open Backlog" value={formatNumber(openBacklogCount)} sublabel="Across 5 gates" />
        <KpiCard accent="mission" label="Value Tied Up" value={formatCompact(openBacklogValue)} sublabel="Stuck in pipeline" />
        <KpiCard accent="coverage" label="POD/Payment Confirmed" value={formatPercent(data.meta.podConfirmedPct)} sublabel={`${formatNumber(data.meta.podConfirmedCount)} of ${formatNumber(deliveredCount)}`} />
      </div>

      {data.meta.podUnconfirmedCount > 0 ? (
        <div className="rounded-lg border border-accent-amber/40 bg-accent-amber-soft px-3 py-2 text-xs text-accent-amber">
          <span className="font-semibold">Disclaimer: </span>
          {formatNumber(data.meta.podUnconfirmedCount)} of {formatNumber(deliveredCount)} orders marked &quot;Delivered&quot; have no POD or
          payment record on file — likely a credit sale or an unconfirmed/lost delivery Order 360 can&apos;t tell apart from Pine&apos;s data
          alone. Treat as needing manual verification, not a confirmed count.
        </div>
      ) : null}

      <div>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Pipeline flow</h4>
        <div className="flex flex-wrap items-center gap-2">
          {data.funnel.map((stage, i) => (
            <span key={stage.stage} className="flex items-center gap-2">
              <span className="rounded-full bg-background-elevated px-3 py-1.5 text-xs font-semibold text-brand-navy">
                {formatNumber(stage.count)} <span className="font-normal text-muted">{stage.stage}</span>
              </span>
              {i < data.funnel.length - 1 ? <span className="text-muted">→</span> : null}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
        <KpiCard accent="growth" label="STK Confirmed" value={formatNumber(data.payments.stkCount)} sublabel={`${formatCompact(data.payments.stkValuePaid)} processed`} />
        <KpiCard accent="quarter" label="No Confirmed STK" value={formatNumber(data.payments.noStkCount)} />
      </div>
    </div>
  );
}
