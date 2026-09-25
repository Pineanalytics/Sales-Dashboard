import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { historicalSalesReturnsUploadBlocked } from "@/lib/salesReturnsControl";
import { lockSalesReturnsUpload } from "@/lib/salesReturnsUploadLock";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface VisitSummaryUploadRow {
  distributor: string;
  route: string;
  transactionDate: string;
  visitSequence: number;
  customerCode: string;
  visitStartAt: string;
  visitEndAt: string;
  startLatitude: number | null;
  startLongitude: number | null;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is VisitSummaryUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.distributor === "string" &&
    typeof row.route === "string" &&
    typeof row.transactionDate === "string" &&
    typeof row.visitSequence === "number" &&
    typeof row.customerCode === "string" &&
    typeof row.visitStartAt === "string" &&
    typeof row.visitEndAt === "string" &&
    (row.startLatitude === null || typeof row.startLatitude === "number") &&
    (row.startLongitude === null || typeof row.startLongitude === "number")
  );
}

/** Replaces a bounded transaction-date window, same pattern as
 *  /api/outlet-sku-daily-sales/upload. API-key-only (`UPLOAD_API_KEY`) —
 *  never session-authenticated. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { rows?: unknown; windowStart?: unknown; windowEnd?: unknown; distributor?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array.' }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || !body.rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more visit-summary rows are invalid." }, { status: 400 });
  }

  const parseDate = (value: unknown) => (typeof value === "string" ? new Date(value) : null);
  const windowStart = parseDate(body.windowStart);
  const windowEnd = parseDate(body.windowEnd);
  if ((windowStart && Number.isNaN(windowStart.getTime())) || (windowEnd && Number.isNaN(windowEnd.getTime()))) {
    return NextResponse.json({ error: "Window dates must be valid ISO timestamps." }, { status: 400 });
  }

  const rows = body.rows as VisitSummaryUploadRow[];
  const distributor = typeof body.distributor === "string" && /^\d+$/.test(body.distributor) ? body.distributor : null;
  if (distributor && rows.some((row) => row.distributor !== distributor)) {
    return NextResponse.json({ error: "Every row must match the requested distributor." }, { status: 400 });
  }
  if (await historicalSalesReturnsUploadBlocked(distributor, windowStart)) {
    return NextResponse.json(
      { error: "Historical Sales & Returns reconciliation is stopped for this branch. Normal yesterday-and-today sync remains allowed." },
      { status: 409 }
    );
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        const distributors = distributor ? [distributor] : Array.from(new Set(rows.map((row) => row.distributor)));
        await lockSalesReturnsUpload(tx, "visit-summary", distributors);
        if (windowStart && windowEnd && distributors.length > 0) {
          await tx.visitSummaryRecord.deleteMany({
            where: { transactionDate: { gte: windowStart, lt: windowEnd }, distributor: { in: distributors } },
          });
        }
        for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
          await tx.visitSummaryRecord.createMany({
            data: rows.slice(index, index + CHUNK_SIZE).map((row) => ({
              distributor: row.distributor,
              route: row.route,
              transactionDate: new Date(row.transactionDate),
              visitSequence: row.visitSequence,
              customerCode: row.customerCode,
              visitStartAt: new Date(row.visitStartAt),
              visitEndAt: new Date(row.visitEndAt),
              startLatitude: row.startLatitude,
              startLongitude: row.startLongitude,
              sourceRowKey: `${row.distributor}|${row.route}|${row.customerCode}|${row.transactionDate}|${row.visitSequence}`,
            })),
          });
        }
      },
      { maxWait: 120_000, timeout: 120_000 }
    );
    return NextResponse.json({ count: rows.length });
  } catch (error) {
    console.error("Failed to replace visit-summary rows", error);
    return NextResponse.json({ error: "Failed to save visit-summary data." }, { status: 500 });
  }
}
