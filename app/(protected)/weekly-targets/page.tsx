import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { getWeeksInMonth, ensureWeeklyTargetGrid, getWeeklyRollupByPrincipalMonth, classifyMonthlyVariance } from "@/lib/weeklyTargets";
import { saveWeeklyTargetsAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground text-right outline-none focus:border-secondary-blue";

export default async function WeeklyTargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; year?: string; month?: string; teamLeader?: string }>;
}) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) {
    redirect("/");
  }
  const isAdmin = session.user.role === "ADMIN";

  if (!isAdmin && !session.user.teamLeaderId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <p className="max-w-md text-center text-sm text-muted-strong">
          Your login isn&apos;t linked to a Team Leader profile yet. Ask an administrator to link it from{" "}
          <span className="font-medium text-primary-blue">Manage Users</span>.
        </p>
      </div>
    );
  }

  const today = new Date();
  const { error, success, year: yearParam, month: monthParam, teamLeader: teamLeaderParam } = await searchParams;
  const year = yearParam || String(today.getUTCFullYear());
  const month = monthParam && CANONICAL_MONTHS.includes(monthParam) ? monthParam : CANONICAL_MONTHS[today.getUTCMonth()];
  const monthIndex = CANONICAL_MONTHS.indexOf(month);

  const allTeamLeaders = await prisma.teamLeader.findMany({ orderBy: { name: "asc" } });
  const visibleTeamLeaders = isAdmin ? allTeamLeaders : allTeamLeaders.filter((tl) => tl.id === session.user.teamLeaderId);

  if (visibleTeamLeaders.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <p className="max-w-md text-center text-sm text-muted-strong">
          No Team Leaders exist yet. Add one from{" "}
          <Link href="/admin/team-leaders" className="font-medium text-primary-blue hover:underline">
            Team Leaders
          </Link>
          .
        </p>
      </div>
    );
  }

  const selectedTeamLeaderId =
    teamLeaderParam && visibleTeamLeaders.some((tl) => tl.id === teamLeaderParam) ? teamLeaderParam : visibleTeamLeaders[0].id;
  const selectedTeamLeader = visibleTeamLeaders.find((tl) => tl.id === selectedTeamLeaderId)!;

  const assignments = await prisma.teamLeaderAssignment.findMany({
    where: { teamLeaderId: selectedTeamLeaderId },
    orderBy: { principal: "asc" },
  });
  const principals = Array.from(new Set(assignments.map((a) => a.principal)));

  // Backfills any missing WeeklyTarget rows for the grid actually being viewed —
  // other team leaders' grids get backfilled the first time someone opens theirs.
  await ensureWeeklyTargetGrid(principals.map((principal) => ({ teamLeaderId: selectedTeamLeaderId, principal })));

  const weeks = getWeeksInMonth(Number(year), monthIndex);
  const weekStartDates = weeks.map((w) => w.weekStartDate);

  const rows = await prisma.weeklyTarget.findMany({
    where: { teamLeaderId: selectedTeamLeaderId, weekStartDate: { in: weekStartDates } },
  });
  const rowByPrincipalWeek = new Map(rows.map((r) => [`${r.principal}|${r.weekStartDate.toISOString()}`, r]));

  // Filled/Pending/%Done — replicates the source workbook's Dashboard sheet,
  // scoped to every visible Team Leader (all of them for Admin, just their own for
  // a Team Leader login) across the whole grid window, not just the visible month.
  const summaryRows = await prisma.weeklyTarget.findMany({
    where: { teamLeaderId: { in: visibleTeamLeaders.map((tl) => tl.id) } },
    select: { teamLeaderId: true, targetValue: true },
  });
  const summaryByLeader = new Map<string, { total: number; filled: number; sum: number }>();
  for (const r of summaryRows) {
    const s = summaryByLeader.get(r.teamLeaderId) ?? { total: 0, filled: 0, sum: 0 };
    s.total += 1;
    if (r.targetValue > 0) s.filled += 1;
    s.sum += r.targetValue;
    summaryByLeader.set(r.teamLeaderId, s);
  }
  const overallTotal = summaryRows.length;
  const overallFilled = summaryRows.filter((r) => r.targetValue > 0).length;
  const overallPending = overallTotal - overallFilled;
  const overallSum = summaryRows.reduce((s, r) => s + r.targetValue, 0);

  const rollup = await getWeeklyRollupByPrincipalMonth(year);
  const monthlyTargets = await prisma.target.findMany({ where: { year, month, principal: { in: principals } } });
  const monthlyTargetByPrincipal = new Map(monthlyTargets.map((t) => [t.principal, t]));

  const monthOptions = CANONICAL_MONTHS;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to dashboard
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Weekly Targets</h1>
        <p className="mt-1 text-sm text-white/70">
          Revenue projections per Team Leader × Principal × Week. Rows come from the{" "}
          <Link href="/admin/team-leaders" className="text-white underline decoration-white/40 hover:decoration-white">
            Team Leader assignments
          </Link>{" "}
          fact table.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/weekly-targets/contribution" className="text-white underline decoration-white/40 hover:decoration-white">
            Contribution by Rep →
          </Link>
          <Link href="/weekly-targets/daily" className="text-white underline decoration-white/40 hover:decoration-white">
            Daily Projection →
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? (
          <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {success}
          </p>
        ) : null}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Weeks", value: overallTotal },
            { label: "Filled", value: overallFilled },
            { label: "Pending", value: overallPending },
            { label: "Total Target", value: overallSum.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <div className="text-[13px] text-muted">{k.label}</div>
              <div className="mt-1 text-xl font-bold text-primary-blue">{k.value}</div>
            </div>
          ))}
        </div>

        {isAdmin && visibleTeamLeaders.length > 1 ? (
          <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold text-primary-blue">Team Leader summary</h2>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">Team Leader</th>
                    <th className="px-6 py-3 text-right font-medium">Total Weeks</th>
                    <th className="px-6 py-3 text-right font-medium">Filled</th>
                    <th className="px-6 py-3 text-right font-medium">Pending</th>
                    <th className="px-6 py-3 text-right font-medium">% Done</th>
                    <th className="px-6 py-3 text-right font-medium">Total Target</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTeamLeaders.map((tl) => {
                    const s = summaryByLeader.get(tl.id) ?? { total: 0, filled: 0, sum: 0 };
                    const pct = s.total > 0 ? (s.filled / s.total) * 100 : 0;
                    return (
                      <tr key={tl.id}>
                        <td className="px-6 py-3 border-b border-border/60">
                          <Link
                            href={`/weekly-targets?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}&teamLeader=${tl.id}`}
                            className="text-primary-blue hover:underline"
                          >
                            {tl.name}
                          </Link>
                        </td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">{s.total}</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">{s.filled}</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">{s.total - s.filled}</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">{pct.toFixed(1)}%</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">{s.sum.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-wrap items-center gap-4">
          {isAdmin ? (
            <div className="flex items-center gap-2 text-[13px]">
              {visibleTeamLeaders.map((tl) => (
                <Link
                  key={tl.id}
                  href={`/weekly-targets?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}&teamLeader=${tl.id}`}
                  className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                    tl.id === selectedTeamLeaderId
                      ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white"
                      : "bg-background-elevated text-muted-strong hover:bg-accent-blue-soft"
                  }`}
                >
                  {tl.name}
                </Link>
              ))}
            </div>
          ) : (
            <span className="text-sm font-medium text-foreground">{selectedTeamLeader.name}</span>
          )}
        </div>

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-primary-blue">
            {selectedTeamLeader.name} — {month} {year}
          </h2>
          <div className="flex items-center gap-2 text-[13px]">
            {monthOptions.map((m) => (
              <Link
                key={m}
                href={`/weekly-targets?year=${encodeURIComponent(year)}&month=${encodeURIComponent(m)}&teamLeader=${selectedTeamLeaderId}`}
                className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                  m === month ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white" : "bg-background-elevated text-muted-strong hover:bg-accent-blue-soft"
                }`}
              >
                {m.slice(0, 3)}
              </Link>
            ))}
          </div>
        </div>

        {principals.length === 0 ? (
          <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] text-sm text-muted">
            {selectedTeamLeader.name} has no Principal assignments yet — add some on{" "}
            <Link href="/admin/team-leaders" className="text-primary-blue hover:underline">
              Team Leaders
            </Link>
            .
          </div>
        ) : (
          <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <form action={saveWeeklyTargetsAction}>
              <input type="hidden" name="teamLeaderId" value={selectedTeamLeaderId} />
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="month" value={month} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium">Principal</th>
                      {weeks.map((w) => (
                        <th key={w.weekLabel} className="px-3 py-3 text-right font-medium whitespace-nowrap">
                          {w.weekLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {principals.map((principal) => (
                      <tr key={principal}>
                        <td className="px-6 py-3 border-b border-border/60 font-medium">{principal}</td>
                        {weeks.map((w) => {
                          const row = rowByPrincipalWeek.get(`${principal}|${w.weekStartDate.toISOString()}`);
                          return (
                            <td key={w.weekLabel} className="px-3 py-2 border-b border-border/60 text-right">
                              {row ? (
                                <input
                                  type="number"
                                  step="any"
                                  name={`cell__${row.id}`}
                                  defaultValue={row.targetValue || ""}
                                  className={inputClass}
                                />
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-6 pt-4">
                <button
                  type="submit"
                  className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
                >
                  Save changes
                </button>
              </div>
            </form>
          </div>
        )}

        {principals.length > 0 ? (
          <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold text-primary-blue">Monthly roll-up — {month} {year}</h2>
              <p className="mt-1 text-[13px] text-muted">
                Sum of this month&apos;s Weekly Targets across every Team Leader serving each Principal, compared against the admin-entered Monthly Target.
              </p>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">Principal</th>
                    <th className="px-6 py-3 text-right font-medium">Weekly Sum</th>
                    <th className="px-6 py-3 text-right font-medium">Monthly Target</th>
                    <th className="px-6 py-3 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {principals.map((principal) => {
                    const weeklySum = rollup.get(`${principal}|${month}`) ?? 0;
                    const monthlyTarget = monthlyTargetByPrincipal.get(principal);
                    const monthlyValue = monthlyTarget?.valueTarget ?? null;
                    const varianceStatus = classifyMonthlyVariance(monthlyValue, weeklySum);
                    const status =
                      varianceStatus === "no-target"
                        ? { label: "No Monthly Target set — set it on Targets", className: "text-muted" }
                        : varianceStatus === "match"
                          ? { label: "Matches", className: "text-accent-green" }
                          : { label: "Variance", className: "text-accent-amber" };
                    return (
                      <tr key={principal}>
                        <td className="px-6 py-3 border-b border-border/60">{principal}</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">{weeklySum.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">
                          {monthlyValue === null ? "—" : monthlyValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className={`px-6 py-3 border-b border-border/60 font-medium ${status.className}`}>{status.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
