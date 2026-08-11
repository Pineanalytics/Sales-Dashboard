import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { decodeDataset } from "@/lib/snapshotCodec";

export const runtime = "nodejs";

// TEMPORARY diagnostic route — API-key-gated, read-only, removed once its
// one-off question is answered. Investigating reported TL Ranking MTD Revenue
// misattribution (Erick/EABL-Nyahururu overstated, Richard/EABL-Nyeri
// understated) - checking for rep-name collisions across different Team
// Leaders/principals, since buildTlRanking's resolveTeamLeaderId only
// disambiguates by principal when a principalFilter is actually passed (never
// true for the "All Principals" TL Ranking view), and repRevenue itself is
// summed by rep NAME ALONE across every principal when no principal is
// selected - a name shared by two different real people on two different
// principals would glom their revenue into one bucket and hand it all to
// whichever Team Leader's assignment record matches first.
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

  const [assignments, teamLeaders, snapshot] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({
      where: { active: true },
      select: { teamLeaderId: true, employeeName: true, sapName: true, principal: true, salesRole: true },
    }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.snapshot.findFirst({ orderBy: { uploadedAt: "desc" } }),
  ]);
  if (!snapshot) return NextResponse.json({ error: "No snapshot found." }, { status: 404 });
  const dataset = decodeDataset(snapshot.data);

  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));

  // Group assignments by the name a Brand&Customer row would actually be
  // matched on (sapName preferred, else employeeName - mirrors resolveTeamLeaderId).
  const byMatchName = new Map<string, { teamLeaderId: string; teamLeaderName: string; principal: string; employeeName: string; sapName: string | null }[]>();
  for (const a of assignments) {
    const matchName = (a.sapName || a.employeeName).trim().toLowerCase();
    if (!matchName) continue;
    const list = byMatchName.get(matchName) ?? [];
    list.push({ teamLeaderId: a.teamLeaderId, teamLeaderName: teamLeaderNameById.get(a.teamLeaderId) ?? a.teamLeaderId, principal: a.principal, employeeName: a.employeeName, sapName: a.sapName });
    byMatchName.set(matchName, list);
  }

  // Names that resolve to more than one DISTINCT Team Leader - genuine
  // collisions that resolveTeamLeaderId(name, ..., principalFilter=null) can't
  // disambiguate.
  const collisions = Array.from(byMatchName.entries())
    .filter(([, rows]) => new Set(rows.map((r) => r.teamLeaderId)).size > 1)
    .map(([name, rows]) => ({ name, teamLeaders: rows }));

  // For each colliding name, how much MTD revenue does that exact salesEmployee
  // string actually carry, broken down by principal - shows where the money
  // really belongs vs where it's currently being dumped.
  const revenueByNameAndPrincipal = new Map<string, Map<string, number>>();
  for (const r of dataset.monthlyBrandCustomer) {
    const key = r.salesEmployee.trim().toLowerCase();
    const byPrincipal = revenueByNameAndPrincipal.get(key) ?? new Map<string, number>();
    byPrincipal.set(r.principal, (byPrincipal.get(r.principal) ?? 0) + r.revenue);
    revenueByNameAndPrincipal.set(key, byPrincipal);
  }

  const collisionDetail = collisions.map((c) => ({
    name: c.name,
    teamLeaders: c.teamLeaders,
    revenueByPrincipal: Object.fromEntries(revenueByNameAndPrincipal.get(c.name) ?? []),
  }));

  // Specifically check Erick's and Richard's own rosters for any name that
  // collides elsewhere.
  const erickId = teamLeaders.find((tl) => tl.name === "Erick")?.id;
  const richardId = teamLeaders.find((tl) => tl.name === "Richard")?.id;
  const erickAssignments = assignments.filter((a) => a.teamLeaderId === erickId);
  const richardAssignments = assignments.filter((a) => a.teamLeaderId === richardId);

  return NextResponse.json({
    totalCollisions: collisions.length,
    collisionDetail: collisionDetail.slice(0, 40),
    erickAssignmentCount: erickAssignments.length,
    richardAssignmentCount: richardAssignments.length,
    erickAssignments: erickAssignments.map((a) => ({ employeeName: a.employeeName, sapName: a.sapName, principal: a.principal, salesRole: a.salesRole })),
    richardAssignments: richardAssignments.map((a) => ({ employeeName: a.employeeName, sapName: a.sapName, principal: a.principal, salesRole: a.salesRole })),
  });
}
