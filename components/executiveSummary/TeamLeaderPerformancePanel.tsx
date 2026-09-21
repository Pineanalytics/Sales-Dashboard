"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatCompact, formatPercent } from "@/lib/format";
import { summarizeSalesByPrincipal, CANONICAL_MONTHS, type PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import type { PrincipalRevenueInput, TlCompositeRow, SupervisorRankingResult, ManagerRankingResult, UnattributedPrincipal } from "@/lib/tlRanking";

type TlRankingResponse =
  | { mode: "flat"; rankings: TlCompositeRow[]; unattributedPrincipals: UnattributedPrincipal[] }
  | { mode: "hierarchy"; managerRanking: ManagerRankingResult; supervisorRanking: SupervisorRankingResult; unattributedPrincipals: UnattributedPrincipal[] };

function flattenRankings(result: TlRankingResponse): TlCompositeRow[] {
  if (result.mode === "flat") return result.rankings;
  // buildSupervisorRanking/buildManagerRanking only know about the base
  // TlRankingRow shape, but the route passes composite-scored rows through
  // them, so the nested teamLeaders rows still carry the composite fields at
  // runtime — safe to widen back to TlCompositeRow here.
  return [...result.supervisorRanking.rankings.flatMap((s) => s.teamLeaders), ...result.supervisorRanking.unassignedTeamLeaders] as TlCompositeRow[];
}

function scoreTier(score: number | null): "good" | "warn" | "bad" {
  if (score === null) return "warn";
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

const SCORE_TEXT_CLASS = { good: "text-accent-green", warn: "text-accent-amber", bad: "text-accent-red" } as const;

function TeamLeaderStatCard({ label, row, accent }: { label: string; row: TlCompositeRow; accent: "revenue" | "growth" }) {
  return (
    <KpiCard
      accent={accent}
      label={label}
      value={row.teamLeaderName}
      size="md"
      sublabel={
        <span className={SCORE_TEXT_CLASS[scoreTier(row.compositeScore)]}>
          {row.compositeScore !== null ? `${row.compositeScore.toFixed(1)} composite score` : "Composite score unavailable"} — {formatPercent(row.achievedPct)} of{" "}
          {formatCompact(row.mtdTarget)} target
        </span>
      }
    />
  );
}

/** Composite ranking — Target Attainment 35% + Strike Rate 25% + Distribution
 *  20% + JP Adherence 20% (see lib/tlRanking.ts's computeTlCompositeScores),
 *  reusing POST /api/dashboard/tl-ranking as before, plus the three extra
 *  metric inputs the route now also fetches. All four are already broadly
 *  visible elsewhere in the app (Rep Performance, JP Adherence) — never the
 *  ADMIN-only PerformanceTracker scorecard. Always uses the real current
 *  calendar month — every component here is inherently MTD, not QTD/YTD-able. */
export function TeamLeaderPerformancePanel({ dataset, selectedPrincipalKey }: { dataset: Dataset; selectedPrincipalKey: string | null }) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [rankings, setRankings] = useState<TlCompositeRow[]>([]);

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
    if (a.compositeScore === null && b.compositeScore === null) return b.mtdRevenue - a.mtdRevenue;
    if (a.compositeScore === null) return 1;
    if (b.compositeScore === null) return -1;
    return b.compositeScore - a.compositeScore;
  });
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  return (
    <div id="team-leader-performance" className="@container h-full">
      <SectionCard
        title="Team Leader Performance"
        accent="purple"
        action={<span className="text-xs text-muted">Composite: Target 35% · Strike Rate 25% · Distribution 20% · JP Adherence 20%</span>}
      >
        {status === "loading" ? (
          <p className="text-xs text-muted">Loading Team Leader ranking…</p>
        ) : status === "error" ? (
          <p className="text-xs text-muted">Couldn&apos;t load Team Leader ranking.</p>
        ) : !best || best.compositeScore === null ? (
          <p className="text-xs text-muted">No Team Leaders with a resolvable composite score for this selection.</p>
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
