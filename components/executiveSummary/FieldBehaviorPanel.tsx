"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { BinaryToggle } from "@/components/ui/BinaryToggle";
import { formatNumber, formatPercent, strikeRateTier, tierTextClass } from "@/lib/format";
import { summarizeCoverageForPeriod, type PeriodSelection, type RoleCategory } from "@/lib/timeIntelligence";
import { periodToDateRange } from "@/lib/executiveSummary";
import type { ActiveUniverseStatus, UniverseTier } from "@/lib/outletUniverse/query";
import type { Dataset } from "@/lib/types";

type FieldRole = "Primary Sales" | "Secondary Sales";
const ROLE_CATEGORY: Record<FieldRole, RoleCategory> = { "Primary Sales": "primary", "Secondary Sales": "secondary" };
const FIELD_ROLE_OPTIONS = [
  { value: "Primary Sales", label: "Primary" },
  { value: "Secondary Sales", label: "Secondary" },
] as const;

function StubTile({ label, href, note }: { label: string; href: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex h-full flex-col justify-between gap-1 rounded-xl border-t-4 border-t-border bg-surface p-3.5 shadow-[0_1px_3px_rgba(11,61,53,0.06)] ring-1 ring-black/[0.06] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(11,61,53,0.12)] hover:-translate-y-0.5"
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
function JpAdherenceTile({ selectedPrincipalKey, period, role }: { selectedPrincipalKey: string | null; period: PeriodSelection; role: FieldRole }) {
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
      const params = new URLSearchParams({ from: range.dateFrom, to: range.dateTo, role });
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
  }, [period, selectedPrincipalKey, role]);

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

type UniverseState = { status: "loading" } | { status: "error" } | { status: "idle"; data: ActiveUniverseStatus };

/** The current active universe from the unified Active Outlet build: every principal's
 *  distinct outlets (or the selected principal brand), as of the last compile — not a
 *  monthly average, and not narrowed by the page's period. */
function useActiveUniverse(selectedPrincipalKey: string | null): UniverseState {
  const [state, setState] = useState<UniverseState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const params = new URLSearchParams();
      if (selectedPrincipalKey) params.set("principalKey", selectedPrincipalKey);
      try {
        const res = await fetch(`/api/outlet-universe/status?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as ActiveUniverseStatus & { error?: string };
        if (!res.ok) throw new Error(body.error || "Failed to load the active universe.");
        if (!controller.signal.aborted) setState({ status: "idle", data: body });
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Executive summary: failed to load the active universe", err);
          setState({ status: "error" });
        }
      }
    })();
    return () => controller.abort();
  }, [selectedPrincipalKey]);

  return state;
}

type UniverseRole = "Primary Sales" | "Secondary Sales";

/** Opens the Active Outlet module on its outlet listing, filtered to dormant outlets (optionally one role / principal brand). */
function dormantHref(selectedPrincipalKey: string | null, role?: UniverseRole): string {
  const params = new URLSearchParams({ tab: "active-outlets", view: "general", status: "inactive", list: "1" });
  if (role) params.set("role", role);
  if (selectedPrincipalKey) params.set("principalKey", selectedPrincipalKey);
  return `/coverage?${params.toString()}`;
}

const pctOf = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

function ActiveUniverseTile({ universe, selectedPrincipalKey }: { universe: UniverseState; selectedPrincipalKey: string | null }) {
  if (universe.status === "loading") return <LoadingTile label="Active Universe" />;
  if (universe.status === "error") {
    return <StubTile label="Active Universe" href="/coverage?tab=active-outlets" note="Couldn't load — see the Active Outlet report" />;
  }
  const { all } = universe.data;
  return (
    <Link href={selectedPrincipalKey ? `/coverage?tab=active-outlets&principalKey=${encodeURIComponent(selectedPrincipalKey)}` : "/coverage?tab=active-outlets"} className="block h-full">
      <KpiCard
        accent="quarter"
        size="md"
        label="Active Universe"
        value={formatNumber(all.active)}
        sublabel={`Distinct outlets bought in the last ${universe.data.activeWindowDays} days · ${pctOf(all.active, all.known)} of ${formatNumber(all.known)} known`}
      />
    </Link>
  );
}

function SplitRow({ label, hint, primary, secondary, href }: { label: string; hint: string; primary: number; secondary: number; href?: { primary: string; secondary: string } }) {
  const cell = "px-3 py-2 text-right tabular-nums";
  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-2">
        <span className="font-medium text-brand-navy">{label}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </td>
      <td className={cell}>
        {href ? <Link href={href.primary} className="font-semibold text-accent-red hover:underline">{formatNumber(primary)} →</Link> : formatNumber(primary)}
      </td>
      <td className={cell}>
        {href ? <Link href={href.secondary} className="font-semibold text-accent-red hover:underline">{formatNumber(secondary)} →</Link> : formatNumber(secondary)}
      </td>
    </tr>
  );
}

/** Active universe split Primary / Secondary: actively buying, buying at least twice a month, dormant. */
function ActiveUniverseSplit({ universe, selectedPrincipalKey }: { universe: UniverseState; selectedPrincipalKey: string | null }) {
  if (universe.status !== "idle") return null;
  const { data } = universe;
  const p: UniverseTier = data.primary;
  const s: UniverseTier = data.secondary;
  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pt-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Active universe by sales role</h3>
        <Link href={dormantHref(selectedPrincipalKey)} className="text-[11px] font-semibold text-primary-blue hover:underline">
          View all {formatNumber(data.all.dormant)} dormant outlets →
        </Link>
      </div>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th className="px-3 py-1 text-left font-medium" />
            <th className="px-3 py-1 text-right font-medium">Primary</th>
            <th className="px-3 py-1 text-right font-medium">Secondary</th>
          </tr>
        </thead>
        <tbody>
          <SplitRow label="Actively buying" hint={`Bought in the last ${data.activeWindowDays} days`} primary={p.active} secondary={s.active} />
          <SplitRow
            label={`Buying ${data.frequentMinDays}+ times a month`}
            hint={`Bought on ${data.frequentMinDays}+ separate days in the last ${data.frequentWindowDays} days`}
            primary={p.frequent}
            secondary={s.frequent}
          />
          <SplitRow
            label="Dormant"
            hint={`No purchase in ${data.activeWindowDays}+ days — open the flagged list`}
            primary={p.dormant}
            secondary={s.dormant}
            href={{ primary: dormantHref(selectedPrincipalKey, "Primary Sales"), secondary: dormantHref(selectedPrincipalKey, "Secondary Sales") }}
          />
        </tbody>
      </table>
      <p className="px-3 pb-3 pt-1 text-[11px] text-muted">
        Dormant outlets are flagged <strong>Lapsed</strong> ({data.activeWindowDays}–{data.lostAfterDays - 1} days: {formatNumber(data.all.lapsed)}), <strong>Lost</strong> ({data.lostAfterDays}+ days: {formatNumber(data.all.lost)}) or no purchase this year ({formatNumber(data.all.noPurchase)}).
        An outlet reached through both roles counts in both columns. Leverage and EABL DMS count as Primary.
      </p>
    </div>
  );
}

/** /api/timestamps/summary has no date-range support at all — its source
 *  table (RepCall) is fully replaced on every sync and only ever holds the
 *  current calendar month, so a real QTD/YTD rollup isn't possible without a
 *  new monthly-history table (a separate ETL project). This deliberately
 *  always fetches the real current month, not the page's selected period,
 *  and labels itself accordingly rather than silently showing a number that
 *  doesn't match what QTD/YTD implies. */
function TimeManagementTile({ selectedPrincipalKey, role }: { selectedPrincipalKey: string | null; role: FieldRole }) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [avgIntervalMins, setAvgIntervalMins] = useState<number | null>(null);
  const [outletsCovered, setOutletsCovered] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const now = new Date();
      const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const params = new URLSearchParams({ month, role });
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
  }, [selectedPrincipalKey, role]);

  if (status === "loading") return <LoadingTile label="Time Management" />;
  if (status === "error") {
    return <StubTile label="Time Management" href="/coverage?tab=timestamps" note="Couldn't load — see full report" />;
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
  // Every tile's source data is genuinely split by sales role (RepCall,
  // ActiveOutletMonthly, JP Adherence's roster all carry it); showing a
  // blended Primary+Secondary figure was never quite right for either team,
  // so this switches the whole panel instead of adding a 5th "combined" tile.
  const [role, setRole] = useState<FieldRole>("Primary Sales");
  const coverage = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey, ROLE_CATEGORY[role]);
  const universe = useActiveUniverse(selectedPrincipalKey);

  return (
    <div id="field-behavior" className="@container h-full">
      <SectionCard title="Field & Rep Behavior" accent="green" action={<BinaryToggle value={role} options={FIELD_ROLE_OPTIONS} onChange={setRole} />}>
        {/* Container-relative, not viewport-relative — see StockRiskPanel's
            matching comment; this panel is paired half-width the same way. */}
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-4">
          <KpiCard
            accent="coverage"
            label="Strike Rate"
            value={<span className={tierTextClass[strikeRateTier(coverage.productivityPct)]}>{formatPercent(coverage.productivityPct)}</span>}
            sublabel={`${formatNumber(coverage.productiveCalls)} of ${formatNumber(coverage.coverage)} calls`}
          />
          <JpAdherenceTile selectedPrincipalKey={selectedPrincipalKey} period={period} role={role} />
          <TimeManagementTile selectedPrincipalKey={selectedPrincipalKey} role={role} />
          <ActiveUniverseTile universe={universe} selectedPrincipalKey={selectedPrincipalKey} />
        </div>
        <ActiveUniverseSplit universe={universe} selectedPrincipalKey={selectedPrincipalKey} />
      </SectionCard>
    </div>
  );
}
