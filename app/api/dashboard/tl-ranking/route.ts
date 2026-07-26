import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { buildTlRanking, type RepRevenueInput } from "@/lib/tlRanking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The heavy Excel-derived rep-revenue aggregation (summarizeBrandCustomerByRep)
 *  already runs client-side against the Zustand-held Dataset — duplicating that
 *  dataset-loading here would mean two sources of truth for the same numbers. This
 *  route only does the Prisma-only half: joining that revenue to Team Leaders and
 *  their WeeklyTarget sum for the given month. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { repRevenue, principalFilter, year, monthLabel } = body as {
    repRevenue?: RepRevenueInput[];
    principalFilter?: string | null;
    year?: string;
    monthLabel?: string;
  };
  if (!Array.isArray(repRevenue) || !year || !monthLabel) {
    return NextResponse.json({ error: "\"repRevenue\", \"year\", and \"monthLabel\" are required." }, { status: 400 });
  }

  const [assignments, teamLeaders, weeklyTargets] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({
      select: { teamLeaderId: true, employeeName: true, sapName: true, principal: true, active: true },
    }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.weeklyTarget.findMany({
      where: { year, monthLabel },
      select: { teamLeaderId: true, targetValue: true },
    }),
  ]);

  const result = buildTlRanking(repRevenue, assignments, teamLeaders, weeklyTargets, principalFilter ?? null);
  return NextResponse.json(result);
}
