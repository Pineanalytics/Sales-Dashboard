"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown20Regular, ChevronRight20Regular, FullScreenMaximize20Regular } from "@fluentui/react-icons";
import { RankingDrilldown } from "@/components/dashboard/RankingDrilldown";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { AchievementBadge } from "@/components/ui/Badge";
import { formatCompact } from "@/lib/format";
import type { Dataset } from "@/lib/types";
import type { PrincipalRevenueInput, TlRankingRow, SupervisorRankingResult, ManagerRankingResult, UnattributedPrincipal } from "@/lib/tlRanking";

type TlRankingResponse =
  | { mode: "flat"; rankings: TlRankingRow[]; unattributedPrincipals: UnattributedPrincipal[] }
  | { mode: "hierarchy"; managerRanking: ManagerRankingResult; supervisorRanking: SupervisorRankingResult; unattributedPrincipals: UnattributedPrincipal[] };

interface RankRowShape {
  key: string;
  name: string;
  monthlyTarget: number;
  mtdTarget: number;
  mtdRevenue: number;
  achievedPct: number | null;
  /** Omitted at Manager depth (ManagerRankingRow carries no principals field of
   *  its own — a Manager can span many Supervisors' worth of principals, too
   *  many to usefully list inline). Present at Supervisor and Team Leader depth. */
  principals?: string[];
}

/** Comma-joined, truncated to 3 with a "+N more" suffix — the full list is
 *  still reachable via the native title tooltip on hover. */
function PrincipalList({ principals }: { principals: string[] | undefined }) {
  if (!principals || principals.length === 0) return <span className="text-muted">—</span>;
  const shown = principals.slice(0, 3).join(", ");
  const extra = principals.length - 3;
  return (
    <span title={principals.join(", ")} className="text-[13px] text-muted-strong">
      {shown}
      {extra > 0 ? ` +${extra} more` : ""}
    </span>
  );
}

/** One ranking row, optionally expandable to show its nested rows indented
 *  underneath — reused for every level (Manager -> Supervisor -> Team Leader) so
 *  "best performed to poorest" reads the same at each tier. */
function RankRow({ row, depth, expandable, expanded, onToggle }: { row: RankRowShape; depth: number; expandable: boolean; expanded: boolean; onToggle?: () => void }) {
  return (
    <tr>
      <Td>
        <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
          {expandable ? (
            <button onClick={onToggle} className="text-muted-strong hover:text-primary-blue" aria-label={expanded ? "Collapse" : "Expand"}>
              {expanded ? <ChevronDown20Regular className="h-4 w-4" /> : <ChevronRight20Regular className="h-4 w-4" />}
            </button>
          ) : (
            <span className="inline-block h-4 w-4" />
          )}
          <span className={depth === 0 ? "font-semibold text-brand-navy" : ""}>{row.name}</span>
        </div>
      </Td>
      <Td>
        <PrincipalList principals={row.principals} />
      </Td>
      <Td align="right">{formatCompact(row.monthlyTarget)}</Td>
      <Td align="right">{formatCompact(row.mtdTarget)}</Td>
      <Td align="right">{formatCompact(row.mtdRevenue)}</Td>
      <Td align="center">
        <AchievementBadge pct={row.achievedPct} />
      </Td>
    </tr>
  );
}

/** MTD Target vs MTD Revenue, ranked from best to poorest performance — grouped by
 *  Sales Supervisor by default (several Team Leaders can share one Supervisor; see
 *  lib/tlRanking.ts's buildSupervisorRanking), with Team Leader detail nested
 *  underneath each Supervisor row rather than as the primary grouping. A Manager
 *  tab rolls up one tier further. A scoped session (Team Leader, principal-scoped
 *  Viewer) gets the original flat Team-Leader-only view instead — no supervisor
 *  grouping is meaningful for a single-TL view. Revenue is attributed by which
 *  principal a Team Leader heads (Principal.teamLeaderId), not by rep — see
 *  lib/tlRanking.ts's buildTlRanking. The principal-level MTD revenue
 *  (dataset.monthlySales, via summarizeSalesByPrincipal) is computed client-side
 *  against the Zustand-held dataset (see the caller); this component only calls
 *  the Prisma-only half via /api/dashboard/tl-ranking. */
export function TlRankingTable({
  principalRevenue,
  principalFilter,
  year,
  monthLabel,
  dataset,
}: {
  principalRevenue: PrincipalRevenueInput[];
  principalFilter: string | null;
  year: string;
  monthLabel: string;
  dataset: Dataset;
}) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [result, setResult] = useState<TlRankingResponse | null>(null);
  const [level, setLevel] = useState<"supervisor" | "manager">("supervisor");
  const [expandedSupervisors, setExpandedSupervisors] = useState<Set<string>>(new Set());
  const [expandedManagers, setExpandedManagers] = useState<Set<string>>(new Set());
  const [unassignedSupervisorsExpanded, setUnassignedSupervisorsExpanded] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch("/api/dashboard/tl-ranking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ principalRevenue, principalFilter, year, monthLabel }),
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load TL Ranking.");
        if (!cancelled) {
          setResult(body);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // principalRevenue is recomputed fresh each render from the dataset — stringify so
    // the effect only re-fires when its actual contents change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(principalRevenue), principalFilter, year, monthLabel]);

  if (status === "loading") return <SectionCard title="Sales Supervisor Ranking">Loading…</SectionCard>;
  if (status === "error" || !result) return <SectionCard title="Sales Supervisor Ranking">Couldn&apos;t load Sales Supervisor Ranking.</SectionCard>;

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSet(next);
  }

  if (result.mode === "flat") {
    const totalMonthlyTarget = result.rankings.reduce((s, r) => s + r.monthlyTarget, 0);
    const totalTarget = result.rankings.reduce((s, r) => s + r.mtdTarget, 0);
    const totalRevenue = result.rankings.reduce((s, r) => s + r.mtdRevenue, 0);
    const totalPct = totalTarget > 0 ? (totalRevenue / totalTarget) * 100 : null;
    return (
      <SectionCard title="Team Leader Ranking" accent="blue">
        <TableWrap>
          <Thead>
            <Th>Team Leader</Th>
            <Th>Principal(s)</Th>
            <Th align="right">Full Month Target</Th>
            <Th align="right">MTD Target</Th>
            <Th align="right">MTD Revenue</Th>
            <Th align="center">Achieved vs MTD</Th>
          </Thead>
          <tbody>
            {result.rankings.map((r) => (
              <RankRow
                key={r.teamLeaderId}
                row={{ key: r.teamLeaderId, name: r.teamLeaderName, monthlyTarget: r.monthlyTarget, mtdTarget: r.mtdTarget, mtdRevenue: r.mtdRevenue, achievedPct: r.achievedPct, principals: r.principals }}
                depth={0}
                expandable={false}
                expanded={false}
              />
            ))}
            <TotalRow>
              <Td>Total Sales</Td>
              <Td>—</Td>
              <Td align="right">{formatCompact(totalMonthlyTarget)}</Td>
              <Td align="right">{formatCompact(totalTarget)}</Td>
              <Td align="right">{formatCompact(totalRevenue)}</Td>
              <Td align="center">
                <AchievementBadge pct={totalPct} />
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
        <UnattributedNote unattributedPrincipals={result.unattributedPrincipals} />
      </SectionCard>
    );
  }

  const { managerRanking, supervisorRanking } = result;
  const isManagerLevel = level === "manager" && managerRanking.rankings.length > 0;

  const totalMonthlyTarget =
    supervisorRanking.rankings.reduce((s, r) => s + r.monthlyTarget, 0) + supervisorRanking.unassignedTeamLeaders.reduce((s, r) => s + r.monthlyTarget, 0);
  const totalTarget = supervisorRanking.rankings.reduce((s, r) => s + r.mtdTarget, 0) + supervisorRanking.unassignedTeamLeaders.reduce((s, r) => s + r.mtdTarget, 0);
  const totalRevenue = supervisorRanking.rankings.reduce((s, r) => s + r.mtdRevenue, 0) + supervisorRanking.unassignedTeamLeaders.reduce((s, r) => s + r.mtdRevenue, 0);
  const totalPct = totalTarget > 0 ? (totalRevenue / totalTarget) * 100 : null;
  const unassignedSupervisorSummary = supervisorRanking.unassignedTeamLeaders.reduce(
    (summary, teamLeader) => ({
      monthlyTarget: summary.monthlyTarget + teamLeader.monthlyTarget,
      mtdTarget: summary.mtdTarget + teamLeader.mtdTarget,
      mtdRevenue: summary.mtdRevenue + teamLeader.mtdRevenue,
    }),
    { monthlyTarget: 0, mtdTarget: 0, mtdRevenue: 0 }
  );
  const unassignedSupervisorPrincipals = Array.from(new Set(supervisorRanking.unassignedTeamLeaders.flatMap((tl) => tl.principals))).sort();
  const unassignedSupervisorPct =
    unassignedSupervisorSummary.mtdTarget > 0 ? (unassignedSupervisorSummary.mtdRevenue / unassignedSupervisorSummary.mtdTarget) * 100 : null;

  return (
    <SectionCard
      title="Sales Supervisor Ranking"
      accent="blue"
      action={
        <div className="flex items-center gap-2">
          {managerRanking.rankings.length > 0 ? (
            <div className="inline-flex gap-0.5 rounded-full bg-background-elevated p-0.5">
              {(["supervisor", "manager"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${level === l ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"}`}
              >
                {l === "supervisor" ? "By Supervisor" : "By Manager"}
              </button>
              ))}
            </div>
          ) : null}
          <button onClick={() => setDrillOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-brand-navy hover:bg-background-elevated">
            <FullScreenMaximize20Regular className="h-4 w-4" /> Full analysis
          </button>
        </div>
      }
    >
      <TableWrap>
        <Thead>
          <Th>{isManagerLevel ? "Manager" : "Sales Supervisor"}</Th>
          <Th>Principal(s)</Th>
          <Th align="right">Full Month Target</Th>
          <Th align="right">MTD Target</Th>
          <Th align="right">MTD Revenue</Th>
          <Th align="center">Achieved vs MTD</Th>
        </Thead>
        <tbody>
          {isManagerLevel
            ? managerRanking.rankings.map((m) => {
                const mExpanded = expandedManagers.has(m.managerId);
                return (
                  <Fragment key={m.managerId}>
                    <RankRow
                      row={{ key: m.managerId, name: m.managerName, monthlyTarget: m.monthlyTarget, mtdTarget: m.mtdTarget, mtdRevenue: m.mtdRevenue, achievedPct: m.achievedPct }}
                      depth={0}
                      expandable
                      expanded={mExpanded}
                      onToggle={() => toggle(expandedManagers, setExpandedManagers, m.managerId)}
                    />
                    {mExpanded
                      ? m.supervisors.map((s) => {
                          const sKey = `${m.managerId}|${s.supervisorId}`;
                          const sExpanded = expandedSupervisors.has(sKey);
                          return (
                            <Fragment key={sKey}>
                              <RankRow
                                row={{ key: sKey, name: s.supervisorName, monthlyTarget: s.monthlyTarget, mtdTarget: s.mtdTarget, mtdRevenue: s.mtdRevenue, achievedPct: s.achievedPct, principals: s.principals }}
                                depth={1}
                                expandable
                                expanded={sExpanded}
                                onToggle={() => toggle(expandedSupervisors, setExpandedSupervisors, sKey)}
                              />
                              {sExpanded
                                ? s.teamLeaders.map((tl) => (
                                    <RankRow
                                      key={`${sKey}|${tl.teamLeaderId}`}
                                      row={{ key: tl.teamLeaderId, name: tl.teamLeaderName, monthlyTarget: tl.monthlyTarget, mtdTarget: tl.mtdTarget, mtdRevenue: tl.mtdRevenue, achievedPct: tl.achievedPct, principals: tl.principals }}
                                      depth={2}
                                      expandable={false}
                                      expanded={false}
                                    />
                                  ))
                                : null}
                            </Fragment>
                          );
                        })
                      : null}
                  </Fragment>
                );
              })
            : supervisorRanking.rankings.map((s) => {
                const sExpanded = expandedSupervisors.has(s.supervisorId);
                return (
                  <Fragment key={s.supervisorId}>
                    <RankRow
                      row={{ key: s.supervisorId, name: s.supervisorName, monthlyTarget: s.monthlyTarget, mtdTarget: s.mtdTarget, mtdRevenue: s.mtdRevenue, achievedPct: s.achievedPct, principals: s.principals }}
                      depth={0}
                      expandable
                      expanded={sExpanded}
                      onToggle={() => toggle(expandedSupervisors, setExpandedSupervisors, s.supervisorId)}
                    />
                    {sExpanded
                      ? s.teamLeaders.map((tl) => (
                          <RankRow
                            key={`${s.supervisorId}|${tl.teamLeaderId}`}
                            row={{ key: tl.teamLeaderId, name: tl.teamLeaderName, monthlyTarget: tl.monthlyTarget, mtdTarget: tl.mtdTarget, mtdRevenue: tl.mtdRevenue, achievedPct: tl.achievedPct, principals: tl.principals }}
                            depth={1}
                            expandable={false}
                            expanded={false}
                          />
                        ))
                      : null}
                  </Fragment>
                );
              })}
          {!isManagerLevel && supervisorRanking.unassignedTeamLeaders.length > 0
            ? (
                <Fragment>
                  <RankRow
                    row={{
                      key: "unassigned-supervisor",
                      name: "Needs Sales Supervisor assignment",
                      monthlyTarget: unassignedSupervisorSummary.monthlyTarget,
                      mtdTarget: unassignedSupervisorSummary.mtdTarget,
                      mtdRevenue: unassignedSupervisorSummary.mtdRevenue,
                      achievedPct: unassignedSupervisorPct,
                      principals: unassignedSupervisorPrincipals,
                    }}
                    depth={0}
                    expandable
                    expanded={unassignedSupervisorsExpanded}
                    onToggle={() => setUnassignedSupervisorsExpanded((expanded) => !expanded)}
                  />
                  {unassignedSupervisorsExpanded
                    ? supervisorRanking.unassignedTeamLeaders.map((tl) => (
                        <RankRow
                          key={tl.teamLeaderId}
                          row={{ key: tl.teamLeaderId, name: tl.teamLeaderName, monthlyTarget: tl.monthlyTarget, mtdTarget: tl.mtdTarget, mtdRevenue: tl.mtdRevenue, achievedPct: tl.achievedPct, principals: tl.principals }}
                          depth={1}
                          expandable={false}
                          expanded={false}
                        />
                      ))
                    : null}
                </Fragment>
              )
            : null}
          <TotalRow>
            <Td>Total Sales</Td>
            <Td>—</Td>
            <Td align="right">{formatCompact(totalMonthlyTarget)}</Td>
            <Td align="right">{formatCompact(totalTarget)}</Td>
            <Td align="right">{formatCompact(totalRevenue)}</Td>
            <Td align="center">
              <AchievementBadge pct={totalPct} />
            </Td>
          </TotalRow>
        </tbody>
      </TableWrap>
      <UnattributedNote unattributedPrincipals={result.unattributedPrincipals} />
      {drillOpen ? (
        <RankingDrilldown
          dataset={dataset}
          year={year}
          monthLabel={monthLabel}
          initialLevel={isManagerLevel ? "manager" : "supervisor"}
          supervisorRanking={supervisorRanking}
          managerRanking={managerRanking}
          onClose={() => setDrillOpen(false)}
        />
      ) : null}
    </SectionCard>
  );
}

function UnattributedNote({ unattributedPrincipals }: { unattributedPrincipals: UnattributedPrincipal[] }) {
  if (unattributedPrincipals.length === 0) return null;
  return (
    <p className="mt-3 text-[13px] text-accent-amber">
      {unattributedPrincipals.length} principal(s) with revenue have no active Team Leader owner (see Admin → Principals) — largest:{" "}
      {unattributedPrincipals
        .slice(0, 3)
        .map((u) => `${u.principal} (${formatCompact(u.revenue)})`)
        .join(", ")}
      .
    </p>
  );
}
