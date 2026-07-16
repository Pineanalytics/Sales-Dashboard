import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { fetchAllInChunks } from "@/lib/prismaPagination";

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
    const [journeyPlan, adherenceDaily, monthlySplit] = await Promise.all([
      fetchAllInChunks((page) =>
        prisma.journeyPlanRow.findMany({ orderBy: [{ date: "asc" }, { employeeCode: "asc" }, { routeSeq: "asc" }, { id: "asc" }], ...page })
      ),
      fetchAllInChunks((page) =>
        prisma.jPAdherenceDaily.findMany({ orderBy: [{ date: "asc" }, { employeeCode: "asc" }, { id: "asc" }], ...page })
      ),
      fetchAllInChunks((page) =>
        prisma.jPMonthlySplitRow.findMany({ orderBy: [{ monthIndex: "asc" }, { costCentre: "asc" }, { id: "asc" }], ...page })
      ),
    ]);
    return NextResponse.json({ journeyPlan, adherenceDaily, monthlySplit });
  } catch (err) {
    console.error("Failed to load JP Adherence data", err);
    return NextResponse.json({ error: "Failed to load JP Adherence data." }, { status: 500 });
  }
}
