"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatNumber, formatPercent, strikeRateTier, tierTextClass } from "@/lib/format";
import { summarizeCoverageForPeriod, resolvePeriodMonths, type PeriodSelection } from "@/lib/timeIntelligence";
import { periodToDateRange, averageActiveOutletsForPeriod, type ActiveOutletsMonthlyRow } from "@/lib/executiveSummary";
import type { Dataset } from "@/lib/types";

function StubTile({ label, href, note }: { label: string; href: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex h-full flex-col justify-between gap-1 rounded-xl border-t-4 border-t-border bg-surface p-3.5 shadow-sm ring-1 ring-border/60 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5"
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="text-sm font-semibold text-muted-strong">View full report →</span>
      <span className="text-[11px] text-muted">{note}</span>
    </Link>
  );
}

function LoadingTile({ label }: { label: string }) {
  return <KpiCard accent="coverage" size="md" label={label} value="…" />;
}

/** `/api/jp-adherence` already accepts a `from`/`to` date range (same shape
 *  as /api/order-360 — see periodToDateRange's own doc comment), so this
 *  reuses it directly rather than adding a new endpoint. `principal` is the
 *  raw label, matching how every other panel on this page already passes
 *  `selectedPrincipalKey` straight through (the route normalizes internally). */
function JpAdherenceTile({ selectedPrincipalKey, period }: { selectedPrincipalKey: string | null; period: PeriodSelection }) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [pct, setPct] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const range = periodToDateRange(period);
      if (!range) {
        setStatus("error");
        return;
      }
      const params = new URLSearchParams({ from: range.dateFrom, to: range.dateTo });
      if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
      try {
        const res = await fetch(`/api/jp-adherence?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as { kpis?: { jpAdherencePct: number } | null; error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load JP Adherence data.");
        if (controller.signal.aborted) return;
        setPct(body.kpis?.jpAdherencePct ?? null);
        setStatus("idle");
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Executive summary: failed to load JP Adherence data", err);
          setStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [period, selectedPrincipalKey]);

  if (status === "loading") return <LoadingTile label="JP Adherence" />;
  if (status === "error" || pct === null) {
    return <StubTile label="JP Adherence" href="/jp-adherence" note="Couldn't load for this selection — see full report" />;
  }
  return (
    <KpiCard
      accent="coverage"
      label="JP Adherence"
      value={<span className={tierTextClass[strikeRateTier(pct)]}>{formatPercent(pct)}</span>}
      sublabel="Outlets visited vs. planned"
    />
  );
}

/** /api/active-outlets returns a `monthly` array (year/monthIndex/principal/
 *  distinctOutlets) with no date-range query param, so this fetches once per
 *  principal and rolls the selected period's months up client-side via
 *  averageActiveOutletsForPeriod — averaged, not summed, since distinctOutlets
 *  is a per-month unique-outlet count (see that function's own doc comment
 *  for why summing would double-count repeat outlets across months). There is
 *  no addressable "universe" denominator outside the Mars-specific
 *  principal-kpis module, so this deliberately shows a reach count, not a
 *  coverage percentage. */
function UniverseStatusTile({ selectedPrincipalKey, period }: { selectedPrincipalKey: string | null; period: PeriodSelection }) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [monthly, setMonthly] = useState<ActiveOutletsMonthlyRow[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const params = new URLSearchParams();
      if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
      try {
        const res = await fetch(`/api/active-outlets?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as { monthly?: ActiveOutletsMonthlyRow[]; error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load Active Outlets data.");
        if (controller.signal.aborted) return;
        setMonthly(body.monthly ?? []);
        setStatus("idle");
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Executive summary: failed to load Active Outlets data", err);
          setStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [selectedPrincipalKey]);

  if (status === "loading") return <LoadingTile label="Universe Status" />;
  if (status === "error") {
    return <StubTile label="Universe Status" href="/active-outlets" note="Couldn't load for this selection — see full report" />;
  }
  const avgOutlets = averageActiveOutletsForPeriod(monthly, resolvePeriodMonths(period));
  if (avgOutlets === null) {
    return <StubTile label="Universe Status" href="/active-outlets" note="No data for this period — see full report" />;
  }
  return (
    <KpiCard
      accent="quarter"
      label="Universe Status"
      value={formatNumber(avgOutlets)}
      sublabel="Avg. active outlets/month — no company-wide universe target exists outside Mars"
    />
  );
}

/** /api/timestamps/summary has no date-range support at all — its source
 *  table (RepCall) is fully replaced on every sync and only ever holds the
 *  current calendar month, so a real QTD/YTD rollup isn't possible without a
 *  new monthly-history table (a separate ETL project). This deliberately
 *  always fetches the real current month, not the page's selected period,
 *  and labels itself accordingly rather than silently showing a number that
 *  doesn't match what QTD/YTD implies. */
function TimeManagementTile({ selectedPrincipalKey }: { selectedPrincipalKey: string | null }) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [avgIntervalMins, setAvgIntervalMins] = useState<number | null>(null);
  const [outletsCovered, setOutletsCovered] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const now = new Date();
      const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const params = new URLSearchParams({ month });
      if (selectedPrincipalKey) params.set("principal", selectedPrincipalKey);
      try {
        const res = await fetch(`/api/timestamps/summary?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as { overall?: { avgIntervalMins: number | null; outletsCovered: number } | null; error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load Timestamps data.");
        if (controller.signal.aborted) return;
        setAvgIntervalMins(body.overall?.avgIntervalMins ?? null);
        setOutletsCovered(body.overall?.outletsCovered ?? null);
        setStatus("idle");
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Executive summary: failed to load Timestamps data", err);
          setStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [selectedPrincipalKey]);

  if (status === "loading") return <LoadingTile label="Time Management" />;
  if (status === "error") {
    return <StubTile label="Time Management" href="/timestamps" note="Couldn't load — see full report" />;
  }
  return (
    <KpiCard
      accent="growth"
      label="Time Management"
      value={avgIntervalMins !== null ? `${avgIntervalMins.toFixed(0)}m` : "N/A"}
      sublabel={`Avg. gap between calls · ${outletsCovered !== null ? formatNumber(outletsCovered) : "—"} outlets · this month only`}
    />
  );
}

export function FieldBehaviorPanel({
  dataset,
  selectedPrincipalKey,
  period,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}) {
  const coverage = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey);

  return (
    <div id="field-behavior" className="@container">
      <SectionCard title="Field & Rep Behavior" accent="green">
        {/* Container-relative, not viewport-relative — see StockRiskPanel's
            matching comment; this panel is paired half-width the same way. */}
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
          <KpiCard
            accent="coverage"
            label="Strike Rate"
            value={<span className={tierTextClass[strikeRateTier(coverage.productivityPct)]}>{formatPercent(coverage.productivityPct)}</span>}
            sublabel={`${formatNumber(coverage.productiveCalls)} of ${formatNumber(coverage.coverage)} calls`}
          />
          <JpAdherenceTile selectedPrincipalKey={selectedPrincipalKey} period={period} />
          <TimeManagementTile selectedPrincipalKey={selectedPrincipalKey} />
          <UniverseStatusTile selectedPrincipalKey={selectedPrincipalKey} period={period} />
        </div>
      </SectionCard>
    </div>
  );
}
