import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { fetchAllInChunks } from "@/lib/prismaPagination";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// JPAdherenceDetail is deliberately NOT fetched here — it's the one table
// structurally larger than anything Active Outlets/Timestamps produce
// (multi-month x many-outlet explosion). It has its own lazy route
// (app/api/jp-adherence/detail), fetched only when a user drills into a
// specific rep-day on the page.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId);
    const journeyPlanWhere = scope ? { principalCostCentre: { in: scope.principals }, employeeCode: { in: scope.employeeCodes } } : {};
    const costCentreWhere = scope ? { costCentre: { in: scope.principals }, employeeCode: { in: scope.employeeCodes } } : {};
    // Ordered by id (the indexed primary key) for all three — the page re-sorts
    // everything client-side anyway, and none of these tables have an index covering
    // their old sort columns, which would force a re-sort of the whole table on every
    // chunk otherwise.
    const masterWhere = scope ? { employeeCode: { in: scope.employeeCodes } } : {};
    const [journeyPlan, adherenceDaily, monthlySplit, employeeMaster] = await Promise.all([
      fetchAllInChunks((page) => prisma.journeyPlanRow.findMany({ where: journeyPlanWhere, orderBy: { id: "asc" }, ...page })),
      fetchAllInChunks((page) => prisma.jPAdherenceDaily.findMany({ where: costCentreWhere, orderBy: { id: "asc" }, ...page })),
      fetchAllInChunks((page) => prisma.jPMonthlySplitRow.findMany({ where: costCentreWhere, orderBy: { id: "asc" }, ...page })),
      prisma.employeeMaster.findMany({
        where: masterWhere,
        select: { employeeCode: true, salesRole: true, contributions: { select: { principal: true } } },
      }),
    ]);
    return NextResponse.json({ journeyPlan, adherenceDaily, monthlySplit, employeeMaster });
  } catch (err) {
    console.error("Failed to load JP Adherence data", err);
    return NextResponse.json({ error: "Failed to load JP Adherence data." }, { status: 500 });
  }
}
