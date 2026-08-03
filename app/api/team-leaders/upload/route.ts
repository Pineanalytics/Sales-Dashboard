import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";

export const runtime = "nodejs";

interface RosterUploadRow {
  employeeCode: string;
  employeeName: string;
  sapName: string | null;
  channel: string | null;
  teamLeaderName: string;
  principal: string;
  contributionPct: number | null;
  active: boolean;
  salesRole: "PRIMARY" | "SECONDARY";
  company: string | null;
  costCenter: string | null;
  absolutePrincipal: string | null;
  workGroup: string | null;
  region: string | null;
  subRegion: string | null;
  supervisor: string | null;
  costCenterCount: number | null;
  salesPoint: string | null;
  route: string | null;
  location: string | null;
  sourceContributionPct: number | null;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value));
}

function isRosterRow(value: unknown): value is RosterUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.employeeCode) &&
    isText(row.employeeName) &&
    isNullableText(row.sapName) &&
    isNullableText(row.channel) &&
    isText(row.teamLeaderName) &&
    isText(row.principal) &&
    isNullableNumber(row.contributionPct) &&
    typeof row.active === "boolean" &&
    (row.salesRole === "PRIMARY" || row.salesRole === "SECONDARY") &&
    isNullableText(row.company) &&
    isNullableText(row.costCenter) &&
    isNullableText(row.absolutePrincipal) &&
    isNullableText(row.workGroup) &&
    isNullableText(row.region) &&
    isNullableText(row.subRegion) &&
    isNullableText(row.supervisor) &&
    isNullableInt(row.costCenterCount) &&
    isNullableText(row.salesPoint) &&
    isNullableText(row.route) &&
    isNullableText(row.location) &&
    isNullableNumber(row.sourceContributionPct)
  );
}

const CHUNK_SIZE = 500;

async function upsertAssignmentsChunk(rows: (RosterUploadRow & { teamLeaderId: string })[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.teamLeaderId}, ${row.employeeCode}, ${row.employeeName}, ${row.principal}, ${row.channel}, ${row.sapName}, ${row.contributionPct}, ${row.active}, ${row.salesRole}, ${row.region}, ${row.subRegion}, ${row.supervisor}, ${row.workGroup}, ${row.company}, ${row.costCenter}, ${row.absolutePrincipal}, ${row.costCenterCount}, ${row.salesPoint}, ${row.route}, ${row.location}, ${row.sourceContributionPct}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "TeamLeaderAssignment"
      (id, "teamLeaderId", "employeeCode", "employeeName", principal, channel, "sapName", "contributionPct", active, "salesRole", region, "subRegion", supervisor, "workGroup", company, "costCenter", "absolutePrincipal", "costCenterCount", "salesPoint", route, location, "sourceContributionPct", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("teamLeaderId", "employeeCode", principal)
    DO UPDATE SET
      "employeeName" = EXCLUDED."employeeName",
      channel = EXCLUDED.channel,
      "sapName" = EXCLUDED."sapName",
      "contributionPct" = EXCLUDED."contributionPct",
      active = EXCLUDED.active,
      "salesRole" = EXCLUDED."salesRole",
      region = EXCLUDED.region,
      "subRegion" = EXCLUDED."subRegion",
      supervisor = EXCLUDED.supervisor,
      "workGroup" = EXCLUDED."workGroup",
      company = EXCLUDED.company,
      "costCenter" = EXCLUDED."costCenter",
      "absolutePrincipal" = EXCLUDED."absolutePrincipal",
      "costCenterCount" = EXCLUDED."costCenterCount",
      "salesPoint" = EXCLUDED."salesPoint",
      route = EXCLUDED.route,
      location = EXCLUDED.location,
      "sourceContributionPct" = EXCLUDED."sourceContributionPct",
      "updatedAt" = now()
  `;
}

/** Receives a vetted Roster import from Target_Management_System.xlsm
 *  (scripts/target-management/import.ts) — upserts TeamLeader (find-or-create
 *  by name, handles newly-added Team Leaders) then TeamLeaderAssignment rows
 *  on (teamLeaderId, employeeCode, principal), the same unique key the admin
 *  UI's createAssignmentAction already uses. Every field this route writes is
 *  fully replaced from the workbook on every run — re-running after a new
 *  workbook version is always safe and idempotent, matching how the Target
 *  bulk upload (admin/targets/actions.ts) already behaves. A row missing from
 *  a new workbook version is left untouched (no auto-deactivation) — cleaned
 *  up manually via the existing Deactivate action if needed. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array.' }, { status: 400 });
  }

  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '"rows" must be a non-empty array.' }, { status: 400 });
  }
  if (!rows.every(isRosterRow)) {
    return NextResponse.json({ error: "One or more Roster rows are invalid." }, { status: 400 });
  }
  const validRows = rows as RosterUploadRow[];

  try {
    const teamLeaderNames = Array.from(new Set(validRows.map((r) => r.teamLeaderName.trim())));
    const existing = await prisma.teamLeader.findMany({ where: { name: { in: teamLeaderNames } }, select: { id: true, name: true } });
    const teamLeaderByName = new Map(existing.map((tl) => [tl.name, tl.id]));
    for (const name of teamLeaderNames) {
      if (teamLeaderByName.has(name)) continue;
      const created = await prisma.teamLeader.create({ data: { name } });
      teamLeaderByName.set(name, created.id);
    }

    const withTeamLeaderId = validRows.map((row) => ({ ...row, teamLeaderId: teamLeaderByName.get(row.teamLeaderName.trim())! }));
    for (let i = 0; i < withTeamLeaderId.length; i += CHUNK_SIZE) {
      await upsertAssignmentsChunk(withTeamLeaderId.slice(i, i + CHUNK_SIZE));
    }

    const contribution = await recomputeRepContribution();
    const daily = await recomputeDailyTargets();
    return NextResponse.json(
      { teamLeaders: teamLeaderNames.length, assignments: validRows.length, contribution, daily },
      { status: 200 }
    );
  } catch (err) {
    console.error("Failed to import Roster", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to save Roster data.", detail }, { status: 500 });
  }
}
