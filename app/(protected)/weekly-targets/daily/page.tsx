import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { DailyProjectionTable, type DailyProjectionRow } from "@/components/weeklyTargets/DailyProjectionTable";

export const dynamic = "force-dynamic";

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function DailyProjectionPage() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) {
    redirect("/");
  }
  const isAdmin = session.user.role === "ADMIN";

  const [dailyTargets, teamLeaders] = await Promise.all([
    prisma.dailyTarget.findMany({
      where: isAdmin ? {} : { teamLeaderId: session.user.teamLeaderId ?? "" },
      orderBy: [{ date: "asc" }, { employeeName: "asc" }],
    }),
    prisma.teamLeader.findMany(),
  ]);
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));

  const rows: DailyProjectionRow[] = dailyTargets.map((r) => ({
    id: r.id,
    date: dateKey(r.date),
    employeeCode: r.employeeCode,
    employeeName: r.employeeName,
    principal: r.principal,
    teamLeaderName: teamLeaderNameById.get(r.teamLeaderId) ?? "—",
    targetValue: r.targetValue,
    sharePctUsed: r.sharePctUsed,
    weekdayWeightUsed: r.weekdayWeightUsed,
  }));

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/weekly-targets" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to Weekly Targets
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Daily Projection</h1>
        <p className="mt-1 text-sm text-white/70">
          Each Weekly Target, split down to Rep × Day using Contribution-by-Rep and each rep&apos;s own preceding-week visit pattern.
          Recomputed automatically every JP Adherence sync.
        </p>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {rows.length === 0 ? (
          <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] text-sm text-muted">
            No Daily Projection data yet — it&apos;s generated automatically once Weekly Targets have real values and the next JP Adherence sync runs.
          </div>
        ) : (
          <DailyProjectionTable rows={rows} />
        )}
      </div>
    </div>
  );
}
