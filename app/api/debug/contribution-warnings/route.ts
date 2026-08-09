import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { validateContributionTotals } from "@/lib/repContribution";

export const runtime = "nodejs";

// TEMPORARY diagnostic route — API-key-gated, read-only, removed once its
// one-off question is answered. Mirrors exactly what /admin/team-leaders
// already computes (validateContributionTotals) so the user can see the full
// list without paging through the roster UI principal by principal.
function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  const assignments = await prisma.teamLeaderAssignment.findMany({
    where: { active: true },
    select: { principal: true, active: true, contributionPct: true, employeeCode: true, employeeName: true, teamLeaderId: true },
  });
  const teamLeaders = await prisma.teamLeader.findMany({ select: { id: true, name: true } });
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));

  const warnings = validateContributionTotals(assignments);

  const detail = warnings.map((w) => ({
    principal: w.principal,
    totalPct: w.totalPct,
    reps: assignments
      .filter((a) => a.principal === w.principal && a.contributionPct != null)
      .map((a) => ({ employeeName: a.employeeName, teamLeaderName: teamLeaderNameById.get(a.teamLeaderId) ?? a.teamLeaderId, contributionPct: a.contributionPct })),
  }));

  return NextResponse.json({ warningCount: warnings.length, warnings: detail });
}
