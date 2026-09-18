"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatPercent, achievementTier, tierTextClass } from "@/lib/format";
import { summarizeSalesByPrincipal, CANONICAL_MONTHS, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import type { PrincipalRevenueInput, TlRankingRow, SupervisorRankingResult, ManagerRankingResult, UnattributedPrincipal } from "@/lib/tlRanking";

type TlRankingResponse =
  | { mode: "flat"; rankings: TlRankingRow[]; unattributedPrincipals: UnattributedPrincipal[] }
  | { mode: "hierarchy"; managerRanking: ManagerRankingResult; supervisorRanking: SupervisorRankingResult; unattributedPrincipals: UnattributedPrincipal[] };

function flattenRankings(result: TlRankingResponse): TlRankingRow[] {
  if (result.mode === "flat") return result.rankings;
  return [...result.supervisorRanking.rankings.flatMap((s) => s.teamLeaders), ...result.supervisorRanking.unassignedTeamLeaders];
}

function TeamLeaderStatCard({ label, row, accent }: { label: string; row: TlRankingRow; accent: "revenue" | "growth" }) {
  return (
    <KpiCard
      accent={accent}
      label={label}
      value={row.teamLeaderName}
      size="md"
      sublabel={
        <span className={tierTextClass[achievementTier(row.achievedPct)]}>
          {formatPercent(row.achievedPct)} of {formatCompact(row.mtdTarget)} — {formatCompact(row.mtdRevenue)} MTD revenue
        </span>
      }
    />
  );
}

/** MTD-only target-attainment ranking, reusing POST /api/dashboard/tl-ranking
 *  (lib/tlRanking.ts's buildTlRanking) exactly as-is — the same data already
 *  shown on /dashboard, so this adds no new access exposure. Deliberately
 *  NOT a strike-rate/SFE score: no rep-level rollup to Team Leader exists
 *  today, and building one would mean pulling currently-ADMIN-only
 *  PerformanceTracker rep data into this page's broader viewer audience.
 *  Always uses the real current calendar month — achievedPct is inherently
 *  MTD (target prorated by elapsed days), not QTD/YTD-able. */
export function TeamLeaderPerformancePanel({ dataset, selectedPrincipalKey }: { dataset: Dataset; selectedPrincipalKey: string | null }) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [rankings, setRankings] = useState<TlRankingRow[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const now = new Date();
      const year = String(now.getUTCFullYear());
      const monthLabel = CANONICAL_MONTHS[now.getUTCMonth()];
      const currentMonthPeriod: PeriodSelection = { kind: "MONTH", year, month: monthLabel };
      const principalRevenue: PrincipalRevenueInput[] = Array.from(summarizeSalesByPrincipal(dataset, currentMonthPeriod).values()).map((r) => ({
        principal: r.principal,
        revenue: r.revenue,
      }));
      const principalFilters = selectedPrincipalKey ? [selectedPrincipalKey] : [];
      try {
        const res = await fetch("/api/dashboard/tl-ranking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ principalRevenue, principalFilters, year, monthLabel }),
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await res.json()) as TlRankingResponse & { error?: string };
        if (!res.ok) throw new Error((body as { error?: string }).error || "Failed to load Team Leader ranking.");
        if (controller.signal.aborted) return;
        setRankings(flattenRankings(body));
        setStatus("idle");
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Executive summary: failed to load Team Leader ranking", err);
          setStatus("error");
        }
      }
    })();
    return () => controller.abort();
  }, [dataset, selectedPrincipalKey]);

  const ranked = [...rankings].sort((a, b) => {
    if (a.achievedPct === null) return 1;
    if (b.achievedPct === null) return -1;
    return b.achievedPct - a.achievedPct;
  });
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return (
    <div id="team-leader-performance" className="@container">
      <SectionCard title="Team Leader Performance" accent="purple" action={<span className="text-xs text-muted">MTD target attainment — not a strike-rate/SFE score</span>}>
        {status === "loading" ? (
          <p className="text-xs text-muted">Loading Team Leader ranking…</p>
        ) : status === "error" ? (
          <p className="text-xs text-muted">Couldn&apos;t load Team Leader ranking.</p>
        ) : !best || best.achievedPct === null ? (
          <p className="text-xs text-muted">No Team Leaders with a resolvable MTD target for this selection.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
            <TeamLeaderStatCard label="Best" row={best} accent="revenue" />
            {worst ? <TeamLeaderStatCard label="Worst" row={worst} accent="growth" /> : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
