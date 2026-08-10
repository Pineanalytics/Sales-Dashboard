import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { recomputeRepContribution, recomputeDailyTargets } from "@/lib/repContribution";

export const runtime = "nodejs";

// TEMPORARY, one-off, API-key-gated route — deactivates a caller-supplied list
// of (employeeCode, principal, teamLeaderName) triples, exactly mirroring
// deactivateAssignmentAction's own logic (active -> false, audit log entry,
// same recompute) in app/(protected)/admin/team-leaders/actions.ts, so this
// runs through no different a path than clicking Deactivate in the UI 102
// times would. User-confirmed cleanup of stale roster rows the 2026-08 CSV
// refresh doesn't touch (imports are additive-only, by design - see
// upsertRosterRows). Removed once this one-off cleanup is done.
function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

interface DeactivateKey {
  employeeCode: string;
  principal: string;
  teamLeaderName: string;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const { keys, userEmail } = body as { keys?: DeactivateKey[]; userEmail?: string };
  if (!Array.isArray(keys) || keys.length === 0 || !userEmail) {
    return NextResponse.json({ error: '"keys" (non-empty array) and "userEmail" are required.' }, { status: 400 });
  }

  const teamLeaderNames = [...new Set(keys.map((k) => k.teamLeaderName))];
  const teamLeaders = await prisma.teamLeader.findMany({ where: { name: { in: teamLeaderNames } }, select: { id: true, name: true } });
  const teamLeaderIdByName = new Map(teamLeaders.map((tl) => [tl.name, tl.id]));

  const deactivated: DeactivateKey[] = [];
  const notFound: DeactivateKey[] = [];
  const alreadyInactive: DeactivateKey[] = [];

  for (const key of keys) {
    const teamLeaderId = teamLeaderIdByName.get(key.teamLeaderName);
    if (!teamLeaderId) {
      notFound.push(key);
      continue;
    }
    const existing = await prisma.teamLeaderAssignment.findUnique({
      where: { teamLeaderId_employeeCode_principal: { teamLeaderId, employeeCode: key.employeeCode, principal: key.principal } },
    });
    if (!existing) {
      notFound.push(key);
      continue;
    }
    if (!existing.active) {
      alreadyInactive.push(key);
      continue;
    }

    await prisma.teamLeaderAssignment.update({ where: { id: existing.id }, data: { active: false } });
    await prisma.teamLeaderAssignmentAuditLog.create({
      data: {
        userEmail,
        action: "DEACTIVATE",
        teamLeaderId: existing.teamLeaderId,
        principal: existing.principal,
        employeeCode: existing.employeeCode,
        changes: { active: { old: true, new: false } },
      },
    });
    deactivated.push(key);
  }

  const contribution = await recomputeRepContribution();
  const daily = await recomputeDailyTargets();

  return NextResponse.json({
    requested: keys.length,
    deactivatedCount: deactivated.length,
    notFound,
    alreadyInactive,
    contribution,
    daily,
  });
}
