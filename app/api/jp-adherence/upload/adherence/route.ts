import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// Both tables are regenerated fresh from the same rolling 90-day lookback
// every sync — full replace, same rationale as JourneyPlanRow.
const CHUNK_SIZE = 500;

interface DailyUploadRow {
  date: string;
  monthLabel: string;
  employeeCode: string;
  employeeName: string;
  userGroup: string;
  salesRole: string;
  costCentre: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  visitedNotPlanned: number;
  totalActualVisits: number;
  status: string;
}

interface DetailUploadRow {
  date: string;
  monthLabel: string;
  day: string;
  employeeCode: string;
  employeeName: string;
  userGroup: string;
  salesRole: string;
  costCentre: string;
  principalCostCentre: string;
  customerId: string;
  customerName: string;
  territory: string;
  plannedFlag: boolean;
  visitedFlag: boolean;
  productiveFlag: boolean;
  visitType: string;
  revenue: number;
  qty: number;
  jpStatus: string;
  latitude: number | null;
  longitude: number | null;
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

function isValidDailyRow(row: unknown): row is DailyUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    typeof r.monthLabel === "string" &&
    typeof r.employeeCode === "string" &&
    typeof r.employeeName === "string" &&
    typeof r.userGroup === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.costCentre === "string" &&
    typeof r.outletsPlanned === "number" &&
    typeof r.outletsVisited === "number" &&
    typeof r.jpAdherencePct === "number" &&
    typeof r.productiveOutlets === "number" &&
    typeof r.strikeRatePct === "number" &&
    typeof r.plannedNotVisited === "number" &&
    typeof r.visitedNotPlanned === "number" &&
    typeof r.totalActualVisits === "number" &&
    typeof r.status === "string"
  );
}

function isValidDetailRow(row: unknown): row is DetailUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    typeof r.monthLabel === "string" &&
    typeof r.day === "string" &&
    typeof r.employeeCode === "string" &&
    typeof r.employeeName === "string" &&
    typeof r.userGroup === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.costCentre === "string" &&
    typeof r.principalCostCentre === "string" &&
    typeof r.customerId === "string" &&
    typeof r.customerName === "string" &&
    typeof r.territory === "string" &&
    typeof r.plannedFlag === "boolean" &&
    typeof r.visitedFlag === "boolean" &&
    typeof r.productiveFlag === "boolean" &&
    typeof r.visitType === "string" &&
    typeof r.revenue === "number" &&
    typeof r.qty === "number" &&
    typeof r.jpStatus === "string" &&
    (r.latitude === null || typeof r.latitude === "number") &&
    (r.longitude === null || typeof r.longitude === "number")
  );
}

async function insertDailyChunk(tx: Prisma.TransactionClient, rows: DailyUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${new Date(r.date)}, ${r.monthLabel}, ${r.employeeCode}, ${r.employeeName}, ${r.userGroup}, ${r.salesRole}, ${r.costCentre}, ${r.outletsPlanned}, ${r.outletsVisited}, ${r.jpAdherencePct}, ${r.productiveOutlets}, ${r.strikeRatePct}, ${r.plannedNotVisited}, ${r.visitedNotPlanned}, ${r.totalActualVisits}, ${r.status}, now())`
  );
  await tx.$executeRaw`
    INSERT INTO "JPAdherenceDaily" (id, date, "monthLabel", "employeeCode", "employeeName", "userGroup", "salesRole", "costCentre", "outletsPlanned", "outletsVisited", "jpAdherencePct", "productiveOutlets", "strikeRatePct", "plannedNotVisited", "visitedNotPlanned", "totalActualVisits", status, "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (date, "employeeCode") DO NOTHING
  `;
}

async function insertDetailChunk(tx: Prisma.TransactionClient, rows: DetailUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${new Date(r.date)}, ${r.monthLabel}, ${r.day}, ${r.employeeCode}, ${r.employeeName}, ${r.userGroup}, ${r.salesRole}, ${r.costCentre}, ${r.principalCostCentre}, ${r.customerId}, ${r.customerName}, ${r.territory}, ${r.plannedFlag}, ${r.visitedFlag}, ${r.productiveFlag}, ${r.visitType}, ${r.revenue}, ${r.qty}, ${r.jpStatus}, ${r.latitude}, ${r.longitude}, now())`
  );
  await tx.$executeRaw`
    INSERT INTO "JPAdherenceDetail" (id, date, "monthLabel", day, "employeeCode", "employeeName", "userGroup", "salesRole", "costCentre", "principalCostCentre", "customerId", "customerName", territory, "plannedFlag", "visitedFlag", "productiveFlag", "visitType", revenue, qty, "jpStatus", latitude, longitude, "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (date, "employeeCode", "customerId") DO NOTHING
  `;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload JP Adherence data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload JP Adherence data." }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with "daily" and "detail" arrays.' }, { status: 400 });
  }

  const daily = (body as { daily?: unknown })?.daily;
  const detail = (body as { detail?: unknown })?.detail;
  if (!Array.isArray(daily) || !Array.isArray(detail)) {
    return NextResponse.json({ error: '"daily" and "detail" must both be arrays.' }, { status: 400 });
  }
  if (!daily.every(isValidDailyRow)) {
    return NextResponse.json({ error: "One or more daily summary rows are missing required fields." }, { status: 400 });
  }
  if (!detail.every(isValidDetailRow)) {
    return NextResponse.json({ error: "One or more detail rows are missing required fields." }, { status: 400 });
  }

  const replace = (body as { replace?: unknown })?.replace !== false;

  try {
    const validDaily = daily as DailyUploadRow[];
    const validDetail = detail as DetailUploadRow[];
    await prisma.$transaction(
      async (tx) => {
        if (replace) {
          await tx.$executeRaw`DELETE FROM "JPAdherenceDaily"`;
          await tx.$executeRaw`DELETE FROM "JPAdherenceDetail"`;
        }
        for (let i = 0; i < validDaily.length; i += CHUNK_SIZE) {
          await insertDailyChunk(tx, validDaily.slice(i, i + CHUNK_SIZE));
        }
        for (let i = 0; i < validDetail.length; i += CHUNK_SIZE) {
          await insertDetailChunk(tx, validDetail.slice(i, i + CHUNK_SIZE));
        }
      },
      { timeout: 30000 }
    );
    return NextResponse.json({ dailyCount: validDaily.length, detailCount: validDetail.length, replaced: replace }, { status: 200 });
  } catch (err) {
    console.error("Failed to replace JP Adherence rows", err);
    return NextResponse.json({ error: "Failed to save JP Adherence data." }, { status: 500 });
  }
}
