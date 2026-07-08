import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// Same batched-raw-SQL-upsert pattern as /api/pl/upload — see that route's
// comment for why (Netlify's serverless execution-time limit vs. one round-trip
// per row).
const CHUNK_SIZE = 500;

interface SalesUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  location: string;
  principal: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
}

async function upsertChunk(rows: SalesUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.location}, ${row.principal}, ${row.revenue}, ${row.cogs}, ${row.grossProfit}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "SalesRecord" (id, year, month, "monthIndex", location, principal, revenue, cogs, "grossProfit", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, month, principal)
    DO UPDATE SET
      "monthIndex" = EXCLUDED."monthIndex",
      location = EXCLUDED.location,
      revenue = EXCLUDED.revenue,
      cogs = EXCLUDED.cogs,
      "grossProfit" = EXCLUDED."grossProfit",
      "updatedAt" = now()
  `;
}

/** Same shared-secret pattern as /api/upload and /api/pl/upload — scripts/
 *  db-bridge can't hold a browser session, so it authenticates with the
 *  x-upload-api-key header instead. */
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

function isValidRow(row: unknown): row is SalesUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.year === "string" &&
    typeof r.month === "string" &&
    typeof r.monthIndex === "number" &&
    typeof r.location === "string" &&
    typeof r.principal === "string" &&
    typeof r.revenue === "number" &&
    typeof r.cogs === "number" &&
    typeof r.grossProfit === "number"
  );
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload Sales data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload Sales data." }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a \"rows\" array." }, { status: 400 });
  }

  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "\"rows\" must be a non-empty array." }, { status: 400 });
  }
  if (!rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more rows are missing required fields." }, { status: 400 });
  }

  try {
    const validRows = rows as SalesUploadRow[];
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      await upsertChunk(validRows.slice(i, i + CHUNK_SIZE));
    }
    return NextResponse.json({ count: validRows.length }, { status: 200 });
  } catch (err) {
    console.error("Failed to upsert Sales rows", err);
    return NextResponse.json({ error: "Failed to save Sales data." }, { status: 500 });
  }
}
