"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { AchievementBadge } from "@/components/ui/Badge";
import { formatCompact } from "@/lib/format";
import type { RepRevenueInput, TlRankingRow, SupervisorRankingResult, ManagerRankingResult, UnmatchedRep } from "@/lib/tlRanking";

type TlRankingResponse =
  | { mode: "flat"; rankings: TlRankingRow[]; unmatchedReps: UnmatchedRep[] }
  | { mode: "hierarchy"; managerRanking: ManagerRankingResult; supervisorRanking: SupervisorRankingResult; unmatchedReps: UnmatchedRep[] };

interface RankRowShape {
  key: string;
  name: string;
  mtdTarget: number;
  mtdRevenue: number;
  achievedPct: number | null;
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
 *  grouping is meaningful for a single-TL view. The heavy Excel-derived
 *  rep-revenue aggregation (summarizeBrandCustomerByRep) already ran client-side
 *  against the Zustand-held dataset (see the caller); this component only calls
 *  the Prisma-only half via /api/dashboard/tl-ranking. */
export function TlRankingTable({
  repRevenue,
  principalFilter,
  year,
  monthLabel,
}: {
  repRevenue: RepRevenueInput[];
  principalFilter: string | null;
  year: string;
  monthLabel: string;
}) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [result, setResult] = useState<TlRankingResponse | null>(null);
  const [level, setLevel] = useState<"supervisor" | "manager">("supervisor");
  const [expandedSupervisors, setExpandedSupervisors] = useState<Set<string>>(new Set());
  const [expandedManagers, setExpandedManagers] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch("/api/dashboard/tl-ranking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repRevenue, principalFilter, year, monthLabel }),
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
    // repRevenue is recomputed fresh each render from the dataset — stringify so the
    // effect only re-fires when its actual contents change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(repRevenue), principalFilter, year, monthLabel]);

  if (status === "loading") return <SectionCard title="TL Ranking">Loading…</SectionCard>;
  if (status === "error" || !result) return <SectionCard title="TL Ranking">Couldn&apos;t load TL Ranking.</SectionCard>;

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSet(next);
  }

  if (result.mode === "flat") {
    const totalTarget = result.rankings.reduce((s, r) => s + r.mtdTarget, 0);
    const totalRevenue = result.rankings.reduce((s, r) => s + r.mtdRevenue, 0);
    const totalPct = totalTarget > 0 ? (totalRevenue / totalTarget) * 100 : null;
    return (
      <SectionCard title="TL Ranking" accent="blue">
        <TableWrap>
          <Thead>
            <Th>Team Leader</Th>
            <Th align="right">MTD Target</Th>
            <Th align="right">MTD Revenue</Th>
            <Th align="center">Achieved vs MTD</Th>
          </Thead>
          <tbody>
            {result.rankings.map((r) => (
              <RankRow key={r.teamLeaderId} row={{ key: r.teamLeaderId, name: r.teamLeaderName, mtdTarget: r.mtdTarget, mtdRevenue: r.mtdRevenue, achievedPct: r.achievedPct }} depth={0} expandable={false} expanded={false} />
            ))}
            <TotalRow>
              <Td>Total Sales</Td>
              <Td align="right">{formatCompact(totalTarget)}</Td>
              <Td align="right">{formatCompact(totalRevenue)}</Td>
              <Td align="center">
                <AchievementBadge pct={totalPct} />
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
        <UnmatchedNote unmatchedReps={result.unmatchedReps} />
      </SectionCard>
    );
  }

  const { managerRanking, supervisorRanking } = result;
  const isManagerLevel = level === "manager" && managerRanking.rankings.length > 0;

  const totalTarget = supervisorRanking.rankings.reduce((s, r) => s + r.mtdTarget, 0) + supervisorRanking.unassignedTeamLeaders.reduce((s, r) => s + r.mtdTarget, 0);
  const totalRevenue = supervisorRanking.rankings.reduce((s, r) => s + r.mtdRevenue, 0) + supervisorRanking.unassignedTeamLeaders.reduce((s, r) => s + r.mtdRevenue, 0);
  const totalPct = totalTarget > 0 ? (totalRevenue / totalTarget) * 100 : null;

  return (
    <SectionCard
      title="TL Ranking"
      accent="blue"
      action={
        managerRanking.rankings.length > 0 ? (
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
        ) : undefined
      }
    >
      <TableWrap>
        <Thead>
          <Th>{isManagerLevel ? "Manager" : "Sales Supervisor"}</Th>
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
                      row={{ key: m.managerId, name: m.managerName, mtdTarget: m.mtdTarget, mtdRevenue: m.mtdRevenue, achievedPct: m.achievedPct }}
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
                                row={{ key: sKey, name: s.supervisorName, mtdTarget: s.mtdTarget, mtdRevenue: s.mtdRevenue, achievedPct: s.achievedPct }}
                                depth={1}
                                expandable
                                expanded={sExpanded}
                                onToggle={() => toggle(expandedSupervisors, setExpandedSupervisors, sKey)}
                              />
                              {sExpanded
                                ? s.teamLeaders.map((tl) => (
                                    <RankRow key={`${sKey}|${tl.teamLeaderId}`} row={{ key: tl.teamLeaderId, name: tl.teamLeaderName, mtdTarget: tl.mtdTarget, mtdRevenue: tl.mtdRevenue, achievedPct: tl.achievedPct }} depth={2} expandable={false} expanded={false} />
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
                      row={{ key: s.supervisorId, name: s.supervisorName, mtdTarget: s.mtdTarget, mtdRevenue: s.mtdRevenue, achievedPct: s.achievedPct }}
                      depth={0}
                      expandable
                      expanded={sExpanded}
                      onToggle={() => toggle(expandedSupervisors, setExpandedSupervisors, s.supervisorId)}
                    />
                    {sExpanded
                      ? s.teamLeaders.map((tl) => (
                          <RankRow key={`${s.supervisorId}|${tl.teamLeaderId}`} row={{ key: tl.teamLeaderId, name: tl.teamLeaderName, mtdTarget: tl.mtdTarget, mtdRevenue: tl.mtdRevenue, achievedPct: tl.achievedPct }} depth={1} expandable={false} expanded={false} />
                        ))
                      : null}
                  </Fragment>
                );
              })}
          {!isManagerLevel && supervisorRanking.unassignedTeamLeaders.length > 0
            ? supervisorRanking.unassignedTeamLeaders.map((tl) => (
                <RankRow key={tl.teamLeaderId} row={{ key: tl.teamLeaderId, name: `${tl.teamLeaderName} (no Supervisor)`, mtdTarget: tl.mtdTarget, mtdRevenue: tl.mtdRevenue, achievedPct: tl.achievedPct }} depth={0} expandable={false} expanded={false} />
              ))
            : null}
          <TotalRow>
            <Td>Total Sales</Td>
            <Td align="right">{formatCompact(totalTarget)}</Td>
            <Td align="right">{formatCompact(totalRevenue)}</Td>
            <Td align="center">
              <AchievementBadge pct={totalPct} />
            </Td>
          </TotalRow>
        </tbody>
      </TableWrap>
      <UnmatchedNote unmatchedReps={result.unmatchedReps} />
    </SectionCard>
  );
}

function UnmatchedNote({ unmatchedReps }: { unmatchedReps: UnmatchedRep[] }) {
  if (unmatchedReps.length === 0) return null;
  return (
    <p className="mt-3 text-[13px] text-accent-amber">
      {unmatchedReps.length} rep(s) with revenue don&apos;t match any Team Leader roster entry (by SAP Name or Employee Name) — largest:{" "}
      {unmatchedReps
        .slice(0, 3)
        .map((u) => `${u.salesEmployee} (${formatCompact(u.revenue)})`)
        .join(", ")}
      .
    </p>
  );
}
