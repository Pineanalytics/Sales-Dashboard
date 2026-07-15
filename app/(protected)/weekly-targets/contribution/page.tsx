import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getUnassignedRevenueReps } from "@/lib/repContribution";

export const dynamic = "force-dynamic";

export default async function ContributionByRepPage() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) {
    redirect("/");
  }
  const isAdmin = session.user.role === "ADMIN";

  const contributions = await prisma.repContribution.findMany({
    where: isAdmin ? {} : { teamLeaderId: session.user.teamLeaderId },
    orderBy: [{ principal: "asc" }, { sharePct: "desc" }],
  });
  const teamLeaders = await prisma.teamLeader.findMany();
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const unassigned = isAdmin ? await getUnassignedRevenueReps() : [];

  const byPrincipal = new Map<string, typeof contributions>();
  for (const c of contributions) {
    const list = byPrincipal.get(c.principal) ?? [];
    list.push(c);
    byPrincipal.set(c.principal, list);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/weekly-targets" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to Weekly Targets
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Contribution by Rep</h1>
        <p className="mt-1 text-sm text-white/70">
          Each rep&apos;s share of a Principal&apos;s trailing revenue (from Journey Plan actuals), among reps assigned to that Principal. Used to split
          Monthly/Weekly/Daily targets down to individual reps.
        </p>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {unassigned.length > 0 ? (
          <div className="rounded-xl border-l-4 border-l-accent-amber bg-surface px-4 py-3 text-sm text-accent-amber shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {unassigned.length} rep(s) have recorded revenue under a Principal but aren&apos;t assigned to it on{" "}
            <Link href="/admin/team-leaders" className="underline">
              Team Leaders
            </Link>{" "}
            — their revenue isn&apos;t represented in any split below. Largest:{" "}
            {unassigned
              .slice(0, 3)
              .map((u) => `${u.employeeName} (${u.principal})`)
              .join(", ")}
            .
          </div>
        ) : null}

        {contributions.length === 0 ? (
          <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] text-sm text-muted">
            No Contribution data yet — it&apos;s computed automatically at the end of every JP Adherence sync, once reps are assigned on{" "}
            <Link href="/admin/team-leaders" className="text-primary-blue hover:underline">
              Team Leaders
            </Link>
            .
          </div>
        ) : (
          Array.from(byPrincipal.entries()).map(([principal, reps]) => (
            <div key={principal} className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <div className="p-6 pb-0">
                <h2 className="text-lg font-semibold text-primary-blue">{principal}</h2>
              </div>
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium">Rep</th>
                      <th className="px-6 py-3 text-left font-medium">Team Leader</th>
                      <th className="px-6 py-3 text-right font-medium">Revenue</th>
                      <th className="px-6 py-3 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reps.map((r) => (
                      <tr key={r.id}>
                        <td className="px-6 py-3 border-b border-border/60">
                          {r.employeeName} <span className="text-muted">({r.employeeCode})</span>
                        </td>
                        <td className="px-6 py-3 border-b border-border/60">{r.teamLeaderId ? teamLeaderNameById.get(r.teamLeaderId) ?? "—" : "—"}</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right">{r.quarterRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-6 py-3 border-b border-border/60 text-right font-medium">{(r.sharePct * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
