import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// JourneyPlanRow is now an authoritative business upload (scripts/jp-adherence/
// import-plan.ts), not a derived/synced table — replaces rather than upserts, so
// a row dropped from a re-uploaded month doesn't linger under a stale key. The
// delete needs BOTH bounds (windowStart..windowEnd), not just windowStart: unlike
// the trailing-sync routes elsewhere in this app (which always upload "from
// windowStart to now"), a Journey Plan upload can cover any past or future month —
// a one-sided delete would wipe every later month too when re-uploading an
// earlier one.
const CHUNK_SIZE = 1000;

interface JourneyPlanUploadRow {
  date: string;
  day: string;
  employeeCode: string;
  employeeName: string;
  customerId: string;
  customerName: string;
  region: string;
  teamLeader: string;
  routeName: string;
  subRegion: string;
  salesRole: string;
  channel: string;
  monthLabel: string;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(row: unknown): row is JourneyPlanUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    typeof r.day === "string" &&
    typeof r.employeeCode === "string" &&
    typeof r.employeeName === "string" &&
    typeof r.customerId === "string" &&
    typeof r.customerName === "string" &&
    typeof r.region === "string" &&
    typeof r.teamLeader === "string" &&
    typeof r.routeName === "string" &&
    typeof r.subRegion === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.channel === "string" &&
    typeof r.monthLabel === "string"
  );
}

async function insertChunk(tx: Prisma.TransactionClient, rows: JourneyPlanUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${new Date(r.date)}, ${r.day}, ${r.employeeCode}, ${r.employeeName}, ${r.customerId}, ${r.customerName}, ${r.region}, ${r.teamLeader}, ${r.routeName}, ${r.subRegion}, ${r.salesRole}, ${r.channel}, ${r.monthLabel}, now())`
  );

  await tx.$executeRaw`
    INSERT INTO "JourneyPlanRow" (id, date, day, "employeeCode", "employeeName", "customerId", "customerName", region, "teamLeader", "routeName", "subRegion", "salesRole", channel, "monthLabel", "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (date, "employeeCode", "customerId") DO NOTHING
  `;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload Journey Plan data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload Journey Plan data." }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "rows" array.' }, { status: 400 });
  }

  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: '"rows" must be an array.' }, { status: 400 });
  }
  if (!rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more Journey Plan rows are missing required fields." }, { status: 400 });
  }

  const windowStartRaw = (body as { windowStart?: unknown })?.windowStart;
  const windowEndRaw = (body as { windowEnd?: unknown })?.windowEnd;
  if (windowStartRaw !== undefined && typeof windowStartRaw !== "string") {
    return NextResponse.json({ error: '"windowStart" must be an ISO date string when present.' }, { status: 400 });
  }
  if (windowEndRaw !== undefined && typeof windowEndRaw !== "string") {
    return NextResponse.json({ error: '"windowEnd" must be an ISO date string when present.' }, { status: 400 });
  }
  const windowStart = typeof windowStartRaw === "string" ? new Date(windowStartRaw) : null;
  const windowEnd = typeof windowEndRaw === "string" ? new Date(windowEndRaw) : null;
  if ((windowStart && !windowEnd) || (!windowStart && windowEnd)) {
    return NextResponse.json({ error: '"windowStart" and "windowEnd" must be provided together.' }, { status: 400 });
  }

  try {
    const validRows = rows as JourneyPlanUploadRow[];
    await prisma.$transaction(
      async (tx) => {
        if (windowStart && windowEnd) {
          await tx.$executeRaw`DELETE FROM "JourneyPlanRow" WHERE date >= ${windowStart} AND date < ${windowEnd}`;
        }
        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
          await insertChunk(tx, validRows.slice(i, i + CHUNK_SIZE));
        }
      },
      { timeout: 60000 }
    );
    return NextResponse.json(
      { count: validRows.length, windowStart: windowStart?.toISOString() ?? null, windowEnd: windowEnd?.toISOString() ?? null },
      { status: 200 }
    );
  } catch (err) {
    console.error("Failed to replace JourneyPlanRow rows", err);
    return NextResponse.json({ error: "Failed to save Journey Plan data." }, { status: 500 });
  }
}
