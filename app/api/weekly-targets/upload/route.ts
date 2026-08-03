import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recomputeRepContribution, recomputeDailyTargets } from "@/lib/repContribution";

export const runtime = "nodejs";

interface WeeklyUploadRow {
  teamLeaderName: string;
  principal: string;
  year: string;
  monthLabel: string;
  weekLabel: string;
  weekStartDate: string; // ISO date
  targetValue: number;
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

function isWeeklyRow(value: unknown): value is WeeklyUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.teamLeaderName) &&
    isText(row.principal) &&
    isText(row.year) &&
    isText(row.monthLabel) &&
    isText(row.weekLabel) &&
    isText(row.weekStartDate) &&
    !Number.isNaN(new Date(row.weekStartDate as string).getTime()) &&
    typeof row.targetValue === "number" &&
    Number.isFinite(row.targetValue)
  );
}

const CHUNK_SIZE = 500;
// Distinguishes an imported figure from a live edit in lastModifiedBy — a Team
// Leader's own save (weekly-targets/actions.ts) sets this to their email instead.
const IMPORT_SOURCE_LABEL = "Target_Management_System.xlsm import";

async function upsertWeeklyChunk(rows: (WeeklyUploadRow & { teamLeaderId: string })[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.teamLeaderId}, ${row.principal}, ${row.year}, ${row.monthLabel}, ${row.weekLabel}, ${new Date(row.weekStartDate)}, ${row.targetValue}, ${IMPORT_SOURCE_LABEL}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "WeeklyTarget" (id, "teamLeaderId", principal, year, "monthLabel", "weekLabel", "weekStartDate", "targetValue", "lastModifiedBy", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("teamLeaderId", principal, "weekStartDate")
    DO UPDATE SET
      year = EXCLUDED.year,
      "monthLabel" = EXCLUDED."monthLabel",
      "weekLabel" = EXCLUDED."weekLabel",
      "targetValue" = EXCLUDED."targetValue",
      "lastModifiedBy" = EXCLUDED."lastModifiedBy",
      "updatedAt" = now()
  `;
}

/** Receives the workbook's own "Weekly" sheet — real, business-authored
 *  per-(Team Leader, Principal, Week) projections (confirmed non-default:
 *  151/704 rows diverge from the naive Monthly pro-rata split, 34 carry the
 *  workbook's own Last Modified/Modified By stamps), not a computed
 *  reference. Upserts WeeklyTarget on its existing (teamLeaderId, principal,
 *  weekStartDate) unique key — the same rows a Team Leader edits by hand via
 *  /weekly-targets, so this import and manual edits share one source of
 *  truth. Requires every named Team Leader to already exist (the Roster
 *  upload in the same import run creates them first). */
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
  if (!rows.every(isWeeklyRow)) {
    return NextResponse.json({ error: "One or more Weekly rows are invalid." }, { status: 400 });
  }
  const validRows = rows as WeeklyUploadRow[];

  try {
    const teamLeaderNames = Array.from(new Set(validRows.map((r) => r.teamLeaderName.trim())));
    const teamLeaders = await prisma.teamLeader.findMany({ where: { name: { in: teamLeaderNames } }, select: { id: true, name: true } });
    const teamLeaderByName = new Map(teamLeaders.map((tl) => [tl.name, tl.id]));
    const missing = teamLeaderNames.filter((name) => !teamLeaderByName.has(name));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Unknown Team Leader(s): ${missing.join(", ")}. Import the Roster first.` }, { status: 400 });
    }

    const withTeamLeaderId = validRows.map((row) => ({ ...row, teamLeaderId: teamLeaderByName.get(row.teamLeaderName.trim())! }));
    for (let i = 0; i < withTeamLeaderId.length; i += CHUNK_SIZE) {
      await upsertWeeklyChunk(withTeamLeaderId.slice(i, i + CHUNK_SIZE));
    }

    const contribution = await recomputeRepContribution();
    const daily = await recomputeDailyTargets();
    return NextResponse.json({ weeklyTargets: validRows.length, contribution, daily }, { status: 200 });
  } catch (err) {
    console.error("Failed to import Weekly Targets", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to save Weekly Target data.", detail }, { status: 500 });
  }
}
