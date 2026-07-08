import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import type { PLLineType } from "@/lib/types";

export const runtime = "nodejs";

// Serverless functions have a hard execution-time limit (Netlify: ~10-26s) — doing
// one round-trip per row (as the original version did) takes minutes for a
// thousand-plus-row P&L sync and gets killed mid-request, returning an HTML
// timeout page instead of JSON. Batched raw-SQL upserts turn that into a handful
// of round-trips. Chunk size stays comfortably under Postgres's parameter-count
// limit (chunk * 11 params/row).
const CHUNK_SIZE = 500;

async function upsertChunk(rows: PLUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.principal}, ${row.accountCode}, ${row.accountName}, ${row.lineType}, ${row.amount}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "PLEntry" (id, year, month, "monthIndex", principal, "accountCode", "accountName", "lineType", amount, "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, month, principal, "accountCode", "lineType")
    DO UPDATE SET
      "monthIndex" = EXCLUDED."monthIndex",
      "accountName" = EXCLUDED."accountName",
      amount = EXCLUDED.amount,
      "updatedAt" = now()
  `;
}

const VALID_LINE_TYPES: PLLineType[] = ["REVENUE", "COGS", "EXPENSE", "OTHER_INCOME"];

interface PLUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  accountCode: string;
  accountName: string;
  lineType: PLLineType;
  amount: number;
}

/** Same shared-secret pattern as /api/upload — scripts/pl-bridge can't hold a
 *  browser session, so it authenticates with the x-upload-api-key header instead. */
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

function isValidRow(row: unknown): row is PLUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.year === "string" &&
    typeof r.month === "string" &&
    typeof r.monthIndex === "number" &&
    typeof r.principal === "string" &&
    typeof r.accountCode === "string" &&
    typeof r.accountName === "string" &&
    typeof r.lineType === "string" &&
    VALID_LINE_TYPES.includes(r.lineType as PLLineType) &&
    typeof r.amount === "number"
  );
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload P&L data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload P&L data." }, { status: 403 });
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
    return NextResponse.json({ error: "One or more rows are missing required fields or have an invalid lineType." }, { status: 400 });
  }

  try {
    const validRows = rows as PLUploadRow[];
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      await upsertChunk(validRows.slice(i, i + CHUNK_SIZE));
    }
    return NextResponse.json({ count: validRows.length }, { status: 200 });
  } catch (err) {
    console.error("Failed to upsert P&L rows", err);
    return NextResponse.json({ error: "Failed to save P&L data." }, { status: 500 });
  }
}
