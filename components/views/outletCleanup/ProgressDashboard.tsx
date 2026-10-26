"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import type { ProgressReport } from "@/lib/outletCleanup/progress";
import type { TeamProgress } from "@/lib/outletCleanup/progressRank";

type Payload = ProgressReport & { actor: { role: string; isAdmin: boolean; name: string | null } };

function Bar({ value, marker, tone = "bg-primary-blue" }: { value: number; marker?: number; tone?: string }) {
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-background-elevated" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      {marker !== undefined && marker < 100 ? <div className="absolute top-0 h-full w-0.5 bg-brand-orange" style={{ left: `${marker}%` }} title={`Target ${marker}%`} /> : null}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-navy">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

const monthLabel = (period: string) => new Date(`${period}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

/** Progress on the cleanup and the assignment of reps, the signed-in person's own teams, and the leaderboard of all team leaders against the month's target. */
export function ProgressDashboard({ onOpenOutlets }: { onOpenOutlets: (state: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/outlet-cleanup/progress", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the progress.");
        if (!cancelled) setData(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <SectionCard title="Progress"><p className="text-sm text-muted-strong">{error}</p></SectionCard>;
  if (!data) return <SectionCard title="Progress"><p className="text-sm text-muted">Loading…</p></SectionCard>;

  const { totals, mine, teams, period } = data;
  const mineNames = new Set(mine.map((t) => t.teamLeader));
  const ownTeam: TeamProgress | null = data.actor.role === "TEAM_LEADER" ? mine[0] ?? null : null;
  const scopeLabel = data.actor.isAdmin || data.actor.role === "HOD" || data.actor.role === "DIRECTOR" ? "All teams" : data.actor.role === "SUPERVISOR" ? "Your teams" : "Your team";
  const target = ownTeam?.targetPct ?? data.defaultTargetPct;
  const toDo = Math.max(0, totals.outlets - totals.reviewed);

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title={`${scopeLabel}: cleanup progress`} action={<span className="text-xs text-muted">Target by the end of {monthLabel(period)}: {target}% of outlets reviewed</span>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Outlets reviewed" value={`${totals.pctReviewed}%`} sub={`${formatNumber(totals.reviewed)} of ${formatNumber(totals.outlets)} outlets`} />
          <Tile label="Still to review" value={formatNumber(toDo)} sub={ownTeam ? `${ownTeam.attainment}% of your target reached${ownTeam.rank ? ` · rank ${ownTeam.rank} of ${teams.length}` : ""}` : undefined} />
          <Tile label="Missing GPS" value={formatNumber(totals.missingGeo)} sub={`${formatNumber(totals.geoTagged)} tagged so far`} />
          <Tile label="Reps validated" value={formatNumber(totals.repsValidated)} sub={`${formatNumber(totals.validated)} outlets validated by admin · ${formatNumber(totals.disowned)} marked open`} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Tile label="Active outlets" value={formatNumber(totals.active)} sub="Bought in the last 90 days" />
          <Tile label="Dormant outlets" value={formatNumber(totals.dormant)} sub="No purchase in 90 days, or none on record" />
          <Tile label="Distinct shops" value={formatNumber(totals.shops)} sub={`${formatNumber(Math.max(0, totals.outlets - totals.shops))} outlets are duplicates of another`} />
        </div>
        <p className="mt-3 text-xs text-muted">The targeted universe is every outlet in your scope, active and dormant, counted once even when several teams sell to it ({formatNumber(totals.teamOutletRows)} team-outlet rows in the table below because a shared outlet counts for each of its teams).</p>
        <div className="mt-4">
          <Bar value={totals.pctReviewed} marker={target} />
          <p className="mt-1 text-xs text-muted">The orange mark is the target.</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => onOpenOutlets("todo")} className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow">Continue cleaning</button>
          {totals.missingGeo > 0 ? <button onClick={() => onOpenOutlets("needs-geo")} className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Outlets to tag ({formatNumber(totals.missingGeo)})</button> : null}
        </div>
      </SectionCard>

      <SectionCard title="Leaderboard" action={<span className="text-xs text-muted">Ranked on the share of the target reached, then outlets reviewed</span>}>
        <TableWrap>
          <Thead>
            <Th>#</Th>
            <Th>Team leader</Th>
            <Th align="right">Outlets</Th>
            <Th align="right">Active</Th>
            <Th align="right">Dormant</Th>
            <Th align="right">Reviewed</Th>
            <Th>Progress against target</Th>
            <Th align="right">% reviewed</Th>
            <Th align="right">Target</Th>
            <Th align="right">GPS missing</Th>
            <Th align="right">Reps validated</Th>
          </Thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.teamLeader} className={mineNames.has(team.teamLeader) ? "bg-accent-blue-soft/60" : undefined}>
                <Td>{team.rank}</Td>
                <Td>{team.teamLeader}{mineNames.has(team.teamLeader) ? <span className="ml-2 text-[10px] font-semibold uppercase text-primary-blue">{data.actor.role === "TEAM_LEADER" ? "you" : "yours"}</span> : null}</Td>
                <Td align="right">{formatNumber(team.outlets)}</Td>
                <Td align="right">{formatNumber(team.active)}</Td>
                <Td align="right">{formatNumber(team.dormant)}</Td>
                <Td align="right">{formatNumber(team.reviewed)}</Td>
                <Td><div className="w-40"><Bar value={team.attainment} tone={team.attainment >= 100 ? "bg-accent-green" : team.attainment >= 50 ? "bg-primary-blue" : "bg-brand-orange"} /></div></Td>
                <Td align="right">{team.pctReviewed}%</Td>
                <Td align="right">{team.targetPct}%</Td>
                <Td align="right">{formatNumber(team.missingGeo)}</Td>
                <Td align="right">{formatNumber(team.repsValidated)}</Td>
              </tr>
            ))}
            {teams.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-muted">No team has outlets in the universe yet.</td></tr>
            ) : null}
          </tbody>
        </TableWrap>
        <p className="mt-3 text-xs text-muted">An outlet counts as reviewed once it has been saved in the cleanup (identification, location, rep, duplicate call) or marked open. An outlet several teams sell to counts for each of those teams, so these rows add up to more than the distinct total above.</p>
      </SectionCard>
    </div>
  );
}
