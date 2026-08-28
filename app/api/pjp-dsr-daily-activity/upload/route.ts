import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface PjpDsrDailyActivityUploadRow {
  date: string;
  pjp: string;
  route: string;
  dsr: string;
  dsrName: string;
  transactionCount: number;
  outletsVisited: number;
  handheldTransactionCount: number;
  firstEntryTime: string | null;
  lastEntryTime: string | null;
  activeSpanMinutes: number | null;
  avgGapMinutes: number | null;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is PjpDsrDailyActivityUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  const nullableNumber = (v: unknown) => v === null || typeof v === "number";
  return (
    typeof row.date === "string" &&
    typeof row.pjp === "string" &&
    typeof row.route === "string" &&
    typeof row.dsr === "string" &&
    typeof row.dsrName === "string" &&
    typeof row.transactionCount === "number" &&
    typeof row.outletsVisited === "number" &&
    typeof row.handheldTransactionCount === "number" &&
    nullableString(row.firstEntryTime) &&
    nullableString(row.lastEntryTime) &&
    nullableNumber(row.activeSpanMinutes) &&
    nullableNumber(row.avgGapMinutes)
  );
}

/** Replaces a bounded delivery-date window, same pattern as
 *  /api/sales-returns/upload and /api/outlet-sku-daily-sales/upload.
 *  API-key-only (`UPLOAD_API_KEY`) — never session-authenticated. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { rows?: unknown; windowStart?: unknown; windowEnd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array.' }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || !body.rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more PJP/DSR daily activity rows are invalid." }, { status: 400 });
  }

  const parseDate = (value: unknown) => (typeof value === "string" ? new Date(value) : null);
  const windowStart = parseDate(body.windowStart);
  const windowEnd = parseDate(body.windowEnd);
  if ((windowStart && Number.isNaN(windowStart.getTime())) || (windowEnd && Number.isNaN(windowEnd.getTime()))) {
    return NextResponse.json({ error: "Window dates must be valid ISO timestamps." }, { status: 400 });
  }

  const rows = body.rows as PjpDsrDailyActivityUploadRow[];
  try {
    await prisma.$transaction(
      async (tx) => {
        if (windowStart && windowEnd) {
          await tx.pjpDsrDailyActivity.deleteMany({ where: { date: { gte: windowStart, lt: windowEnd } } });
        }
        for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
          await tx.pjpDsrDailyActivity.createMany({
            data: rows.slice(index, index + CHUNK_SIZE).map((row) => ({
              ...row,
              sourceRowKey: `${row.pjp}|${row.dsr}|${row.date}`,
              date: new Date(row.date),
              firstEntryTime: row.firstEntryTime ? new Date(row.firstEntryTime) : null,
              lastEntryTime: row.lastEntryTime ? new Date(row.lastEntryTime) : null,
            })),
          });
        }
      },
      { timeout: 60_000 }
    );
    return NextResponse.json({ count: rows.length });
  } catch (error) {
    console.error("Failed to replace PJP/DSR daily activity rows", error);
    return NextResponse.json({ error: "Failed to save PJP/DSR daily activity data." }, { status: 500 });
  }
}
