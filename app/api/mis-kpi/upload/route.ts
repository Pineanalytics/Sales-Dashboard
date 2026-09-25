import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { lockSalesReturnsUpload } from "@/lib/salesReturnsUploadLock";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface MisKpiValueUploadRow {
  distributor: string;
  pjp: string;
  year: string;
  jcno: string;
  kpiId: string;
  kpiDesc: string;
  value: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is MisKpiValueUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.distributor === "string" &&
    typeof row.pjp === "string" &&
    typeof row.year === "string" &&
    typeof row.jcno === "string" &&
    typeof row.kpiId === "string" &&
    typeof row.kpiDesc === "string" &&
    typeof row.value === "number"
  );
}

/** Replaces one exact (distributor, year, jcno) partition of Centegy's own
 *  pre-computed KPI values — a full recompute of that one JC every run (see
 *  scripts/db-bridge/sales-returns/misKpiQuery.ts), not a per-day append.
 *  API-key-only, same UPLOAD_API_KEY shared secret as the rest of this
 *  bridge — never session-authenticated. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { rows?: unknown; distributor?: unknown; year?: unknown; jcno?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array.' }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || !body.rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more MIS KPI value rows are invalid." }, { status: 400 });
  }
  const distributor = typeof body.distributor === "string" && /^\d+$/.test(body.distributor) ? body.distributor : null;
  const year = typeof body.year === "string" ? body.year : null;
  const jcno = typeof body.jcno === "string" ? body.jcno : null;
  if (!distributor || !year || !jcno) return NextResponse.json({ error: '"distributor", "year", and "jcno" are all required.' }, { status: 400 });

  const rows = body.rows as MisKpiValueUploadRow[];
  if (rows.some((row) => row.distributor !== distributor || row.year !== year || row.jcno !== jcno)) {
    return NextResponse.json({ error: "Every row must match the requested distributor/year/jcno." }, { status: 400 });
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await lockSalesReturnsUpload(tx, `mis-kpi:${year}-${jcno}`, [distributor]);
        await tx.misKpiValue.deleteMany({ where: { distributor, year, jcno } });
        for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
          await tx.misKpiValue.createMany({ data: rows.slice(index, index + CHUNK_SIZE) });
        }
      },
      { maxWait: 120_000, timeout: 120_000 }
    );
    return NextResponse.json({ count: rows.length });
  } catch (error) {
    console.error("Failed to replace MIS KPI value rows", error);
    return NextResponse.json({ error: "Failed to save MIS KPI value data." }, { status: 500 });
  }
}
