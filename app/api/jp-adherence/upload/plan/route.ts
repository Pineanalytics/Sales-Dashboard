import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// JourneyPlanRow only regenerates on jp-adherence's weekly full-resync pass
// (see scripts/db-bridge/jp-adherence/run.ts's header comment) — replaces
// rather than upserts, same rationale as RepCall (a planned row that falls
// out of the window must disappear, not linger under a stale key), but the
// delete is scoped to windowStart..now instead of the whole table, so it
// doesn't depend on every sync being a full resync.
const CHUNK_SIZE = 500;

interface JourneyPlanUploadRow {
  costCentreGroup: string;
  principalCostCentre: string;
  salesRole: string;
  userGroup: string;
  employeeCode: string;
  employeeName: string;
  monthLabel: string;
  day: string;
  date: string;
  weekOfMonth: number;
  dayIndex: number;
  routeSeq: number;
  customerId: string;
  customerName: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  visitsPerWeek: number;
  minOutletsTarget: number;
  dayOutletCount: number;
  status: string;
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
    typeof r.costCentreGroup === "string" &&
    typeof r.principalCostCentre === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.userGroup === "string" &&
    typeof r.employeeCode === "string" &&
    typeof r.employeeName === "string" &&
    typeof r.monthLabel === "string" &&
    typeof r.day === "string" &&
    typeof r.date === "string" &&
    typeof r.weekOfMonth === "number" &&
    typeof r.dayIndex === "number" &&
    typeof r.routeSeq === "number" &&
    typeof r.customerId === "string" &&
    typeof r.customerName === "string" &&
    typeof r.territory === "string" &&
    (r.latitude === null || typeof r.latitude === "number") &&
    (r.longitude === null || typeof r.longitude === "number") &&
    typeof r.visitsPerWeek === "number" &&
    typeof r.minOutletsTarget === "number" &&
    typeof r.dayOutletCount === "number" &&
    typeof r.status === "string"
  );
}

async function insertChunk(tx: Prisma.TransactionClient, rows: JourneyPlanUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${r.costCentreGroup}, ${r.principalCostCentre}, ${r.salesRole}, ${r.userGroup}, ${r.employeeCode}, ${r.employeeName}, ${r.monthLabel}, ${r.day}, ${new Date(r.date)}, ${r.weekOfMonth}, ${r.dayIndex}, ${r.routeSeq}, ${r.customerId}, ${r.customerName}, ${r.territory}, ${r.latitude}, ${r.longitude}, ${r.visitsPerWeek}, ${r.minOutletsTarget}, ${r.dayOutletCount}, ${r.status}, now())`
  );

  await tx.$executeRaw`
    INSERT INTO "JourneyPlanRow" (id, "costCentreGroup", "principalCostCentre", "salesRole", "userGroup", "employeeCode", "employeeName", "monthLabel", day, date, "weekOfMonth", "dayIndex", "routeSeq", "customerId", "customerName", territory, latitude, longitude, "visitsPerWeek", "minOutletsTarget", "dayOutletCount", status, "createdAt")
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
  if (windowStartRaw !== undefined && typeof windowStartRaw !== "string") {
    return NextResponse.json({ error: '"windowStart" must be an ISO date string when present.' }, { status: 400 });
  }
  const windowStart = typeof windowStartRaw === "string" ? new Date(windowStartRaw) : null;

  try {
    const validRows = rows as JourneyPlanUploadRow[];
    await prisma.$transaction(
      async (tx) => {
        if (windowStart) {
          await tx.$executeRaw`DELETE FROM "JourneyPlanRow" WHERE date >= ${windowStart}`;
        }
        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
          await insertChunk(tx, validRows.slice(i, i + CHUNK_SIZE));
        }
      },
      { timeout: 30000 }
    );
    return NextResponse.json({ count: validRows.length, windowStart: windowStart?.toISOString() ?? null }, { status: 200 });
  } catch (err) {
    console.error("Failed to replace JourneyPlanRow rows", err);
    return NextResponse.json({ error: "Failed to save Journey Plan data." }, { status: 500 });
  }
}
