import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// TEMPORARY diagnostic route — API-key-gated, read-only, removed once its
// one-off question is answered. Same pattern used earlier this session.
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

  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: '"name" query param is required.' }, { status: 400 });

  const tl = await prisma.teamLeader.findUnique({ where: { name } });
  if (!tl) return NextResponse.json({ found: false });

  const assignments = await prisma.teamLeaderAssignment.findMany({ where: { teamLeaderId: tl.id } });
  const activeAssignments = assignments.filter((a) => a.active);
  const weeklyTargets = await prisma.weeklyTarget.findMany({ where: { teamLeaderId: tl.id } });
  const totalWeeklyTargetValue = weeklyTargets.reduce((s, w) => s + w.targetValue, 0);

  return NextResponse.json({
    found: true,
    teamLeaderId: tl.id,
    totalAssignments: assignments.length,
    activeAssignments: activeAssignments.length,
    activeAssignmentDetails: activeAssignments.map((a) => ({ employeeCode: a.employeeCode, employeeName: a.employeeName, principal: a.principal, supervisorId: a.supervisorId })),
    inactiveAssignmentDetails: assignments.filter((a) => !a.active).map((a) => ({ employeeCode: a.employeeCode, employeeName: a.employeeName, principal: a.principal })),
    weeklyTargetRowCount: weeklyTargets.length,
    totalWeeklyTargetValue,
    weeklyTargetSample: weeklyTargets.slice(0, 5).map((w) => ({ principal: w.principal, weekLabel: w.weekLabel, targetValue: w.targetValue })),
  });
}
