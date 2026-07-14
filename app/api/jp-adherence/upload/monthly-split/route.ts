import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// Regenerated fresh from the rolling 90-day lookback every sync — full
// replace, same rationale as JourneyPlanRow (reflects only the trailing
// window, not a persistent YTD history).
const CHUNK_SIZE = 500;

interface MonthlySplitUploadRow {
  monthLabel: string;
  monthIndex: number;
  year: string;
  costCentre: string;
  salesRole: string;
  employeeCode: string;
  employeeName: string;
  activityStatus: string;
  coverage: number;
  productive: number;
  productivityPct: number;
  revenue: number;
  qty: number;
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

function isValidRow(row: unknown): row is MonthlySplitUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.monthLabel === "string" &&
    typeof r.monthIndex === "number" &&
    typeof r.year === "string" &&
    typeof r.costCentre === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.employeeCode === "string" &&
    typeof r.employeeName === "string" &&
    typeof r.activityStatus === "string" &&
    typeof r.coverage === "number" &&
    typeof r.productive === "number" &&
    typeof r.productivityPct === "number" &&
    typeof r.revenue === "number" &&
    typeof r.qty === "number"
  );
}

async function insertChunk(tx: Prisma.TransactionClient, rows: MonthlySplitUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${r.monthLabel}, ${r.monthIndex}, ${r.year}, ${r.costCentre}, ${r.salesRole}, ${r.employeeCode}, ${r.employeeName}, ${r.activityStatus}, ${r.coverage}, ${r.productive}, ${r.productivityPct}, ${r.revenue}, ${r.qty}, now())`
  );
  await tx.$executeRaw`
    INSERT INTO "JPMonthlySplitRow" (id, "monthLabel", "monthIndex", year, "costCentre", "salesRole", "employeeCode", "employeeName", "activityStatus", coverage, productive, "productivityPct", revenue, qty, "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("monthLabel", "costCentre", "salesRole", "employeeCode", "activityStatus") DO NOTHING
  `;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload Monthly Split data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload Monthly Split data." }, { status: 403 });
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
    return NextResponse.json({ error: "One or more Monthly Split rows are missing required fields." }, { status: 400 });
  }

  const replace = (body as { replace?: unknown })?.replace !== false;

  try {
    const validRows = rows as MonthlySplitUploadRow[];
    await prisma.$transaction(
      async (tx) => {
        if (replace) {
          await tx.$executeRaw`DELETE FROM "JPMonthlySplitRow"`;
        }
        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
          await insertChunk(tx, validRows.slice(i, i + CHUNK_SIZE));
        }
      },
      { timeout: 30000 }
    );
    return NextResponse.json({ count: validRows.length, replaced: replace }, { status: 200 });
  } catch (err) {
    console.error("Failed to replace JPMonthlySplitRow rows", err);
    return NextResponse.json({ error: "Failed to save Monthly Split data." }, { status: 500 });
  }
}
