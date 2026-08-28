import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface PjpSkuPerformanceUploadRow {
  pjp: string;
  route: string;
  skuCode: string;
  skuDesc: string;
  ecoMtd: number;
  skuSales: number;
  pcs: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is PjpSkuPerformanceUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.pjp === "string" &&
    typeof row.route === "string" &&
    typeof row.skuCode === "string" &&
    typeof row.skuDesc === "string" &&
    typeof row.ecoMtd === "number" &&
    typeof row.skuSales === "number" &&
    typeof row.pcs === "number"
  );
}

/** Replaces one month's worth of PJP x SKU performance rows — a full-month
 *  recompute every run (see scripts/db-bridge/sales-returns/pjpSkuQuery.ts),
 *  not a per-day append like /api/sales-returns/upload. API-key-only, same
 *  UPLOAD_API_KEY shared secret as the rest of this bridge — never
 *  session-authenticated. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { rows?: unknown; month?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array and a "month" date.' }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || !body.rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more PJP x SKU performance rows are invalid." }, { status: 400 });
  }
  const month = typeof body.month === "string" ? new Date(body.month) : null;
  if (!month || Number.isNaN(month.getTime())) {
    return NextResponse.json({ error: '"month" must be a valid ISO date (the month\'s first day).' }, { status: 400 });
  }

  const rows = body.rows as PjpSkuPerformanceUploadRow[];
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.pjpSkuPerformance.deleteMany({ where: { month } });
        for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
          await tx.pjpSkuPerformance.createMany({
            data: rows.slice(index, index + CHUNK_SIZE).map((row) => ({ ...row, month })),
          });
        }
      },
      { timeout: 60_000 }
    );
    return NextResponse.json({ count: rows.length });
  } catch (error) {
    console.error("Failed to replace PJP x SKU performance rows", error);
    return NextResponse.json({ error: "Failed to save PJP x SKU performance data." }, { status: 500 });
  }
}
