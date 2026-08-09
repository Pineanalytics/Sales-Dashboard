import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// TEMPORARY diagnostic route — API-key-gated, read-only, removed once its
// one-off question is answered. Same pattern used earlier this session
// (app/api/debug/team-leader-check, since removed) — investigating why TL
// Ranking's Full Month Target totals (728.3M) don't tie out to Sales
// Performance vs Target's totals (377.4M) the way the cascade is supposed to.
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

  const supervisorName = req.nextUrl.searchParams.get("supervisor");
  if (!supervisorName) return NextResponse.json({ error: '"supervisor" query param is required.' }, { status: 400 });

  const supervisor = await prisma.supervisor.findUnique({ where: { name: supervisorName } });
  if (!supervisor) return NextResponse.json({ found: false });

  const assignments = await prisma.teamLeaderAssignment.findMany({
    where: { active: true, salesRole: "PRIMARY", supervisorId: supervisor.id },
    select: { teamLeaderId: true, employeeCode: true, employeeName: true, principal: true, contributionPct: true },
  });
  const teamLeaderIds = [...new Set(assignments.map((a) => a.teamLeaderId))];
  const teamLeaders = await prisma.teamLeader.findMany({ where: { id: { in: teamLeaderIds } }, select: { id: true, name: true } });
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));

  const principals = [...new Set(assignments.map((a) => a.principal))];
  const targets = await prisma.target.findMany({ where: { principal: { in: principals } }, select: { principal: true, year: true, month: true, valueTarget: true } });
  const contributions = await prisma.repContribution.findMany({ where: { principal: { in: principals } }, select: { principal: true, employeeCode: true, sharePct: true, teamLeaderId: true } });

  // For each (principal, employeeCode) under this Supervisor, how many DISTINCT
  // active Team Leaders is that rep assigned under? >1 means the cascade's
  // per-(teamLeaderId, principal) grouping counts that rep's full share once for
  // EACH Team Leader they're under, inflating the Supervisor's summed total
  // beyond the principal's real 100%.
  const teamLeadersByPrincipalRep = new Map<string, Set<string>>();
  for (const a of assignments) {
    const key = `${a.principal}|${a.employeeCode}`;
    const set = teamLeadersByPrincipalRep.get(key) ?? new Set<string>();
    set.add(a.teamLeaderId);
    teamLeadersByPrincipalRep.set(key, set);
  }
  const matrixReps = Array.from(teamLeadersByPrincipalRep.entries())
    .filter(([, tls]) => tls.size > 1)
    .map(([key, tls]) => {
      const [principal, employeeCode] = key.split("|");
      return { principal, employeeCode, teamLeaderNames: Array.from(tls).map((id) => teamLeaderNameById.get(id) ?? id) };
    });

  // Declared contributionPct sum per principal (should be ~1.0 if fully declared,
  // schema comment says this is validated only in the admin UI, not DB-enforced).
  const declaredSumByPrincipal = new Map<string, number>();
  const declaredCountByPrincipal = new Map<string, number>();
  for (const a of assignments) {
    if (a.contributionPct == null) continue;
    declaredSumByPrincipal.set(a.principal, (declaredSumByPrincipal.get(a.principal) ?? 0) + a.contributionPct);
    declaredCountByPrincipal.set(a.principal, (declaredCountByPrincipal.get(a.principal) ?? 0) + 1);
  }

  return NextResponse.json({
    found: true,
    supervisorId: supervisor.id,
    activeAssignmentCount: assignments.length,
    distinctTeamLeaders: teamLeaders.map((tl) => tl.name),
    distinctPrincipals: principals,
    targetsForThesePrincipals: targets,
    matrixRepCount: matrixReps.length,
    matrixReps: matrixReps.slice(0, 30),
    declaredContributionPctSumByPrincipal: Array.from(declaredSumByPrincipal.entries()).map(([principal, sum]) => ({
      principal,
      declaredSum: sum,
      declaredRepCount: declaredCountByPrincipal.get(principal),
      totalRepsUnderThisSupervisorForPrincipal: assignments.filter((a) => a.principal === principal).length,
    })),
    computedSharePctSumByPrincipal: principals.map((p) => ({
      principal: p,
      sum: contributions.filter((c) => c.principal === p).reduce((s, c) => s + c.sharePct, 0),
      rowCount: contributions.filter((c) => c.principal === p).length,
    })),
  });
}
