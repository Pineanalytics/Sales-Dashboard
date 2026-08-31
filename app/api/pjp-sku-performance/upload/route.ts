import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface PjpSkuPerformanceUploadRow {
  distributor: string;
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
    typeof row.distributor === "string" &&
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

  let body: { rows?: unknown; month?: unknown; distributor?: unknown };
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
  const distributor = typeof body.distributor === "string" && /^\d+$/.test(body.distributor) ? body.distributor : null;
  if (distributor && rows.some((row) => row.distributor !== distributor)) {
    return NextResponse.json({ error: "Every row must match the requested distributor." }, { status: 400 });
  }
  const uniqueKeys = new Set<string>();
  const duplicateKeys = new Set<string>();
  for (const row of rows) {
    const key = `${row.distributor}\u0000${row.pjp}\u0000${row.skuCode}`;
    if (uniqueKeys.has(key)) duplicateKeys.add(`${row.distributor}/${row.pjp}/${row.skuCode}`);
    uniqueKeys.add(key);
  }
  if (duplicateKeys.size > 0) {
    return NextResponse.json(
      {
        error: "The PJP x SKU payload contains duplicate source keys.",
        duplicateCount: duplicateKeys.size,
        examples: Array.from(duplicateKeys).slice(0, 5),
      },
      { status: 400 }
    );
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        // Scoped to this batch's own distributor(s), not just the month —
        // see the matching comment in app/api/sales-returns/upload/route.ts
        // for why (this table is shared across branches too). Explicit
        // distributor makes an empty current-month replacement safe.
        const distributors = distributor
          ? [distributor]
          : Array.from(new Set(rows.map((row) => row.distributor)));
        // A five-minute task can overlap its previous run (or a manual run).
        // Serialize only the same branch/month replacement so two transactions
        // cannot both delete the snapshot and then race to insert identical
        // unique keys. Different branches and months remain parallel.
        for (const branch of [...distributors].sort()) {
          const lockKey = `pjp-sku:${month.toISOString()}:${branch}`;
          await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
        }
        if (distributors.length > 0) {
          await tx.pjpSkuPerformance.deleteMany({ where: { month, distributor: { in: distributors } } });
        }
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
