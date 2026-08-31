import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECONCILIATION_DAYS = 62;

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function parseDateOnly(value: string | null): Date | null {
  if (!value || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDistributor(value: string | null): value is string {
  return Boolean(value && /^\d+$/.test(value));
}

interface DailySummaryRow {
  date: string;
  rowCount: bigint | number;
  invoiceCount: bigint | number;
  saleQtyPieces: number | null;
  freeQtyPieces: number | null;
  grossSale: number | null;
  netSale: number | null;
  totalDiscount: number | null;
}

/** Returns the VPS's exact per-day SalesReturnLine signature for one branch.
 * The Centegy bridge compares this with the same aggregates from SQL Server,
 * then repairs only the oldest mismatch on each five-minute pass. */
export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  const distributor = req.nextUrl.searchParams.get("distributor");
  const from = parseDateOnly(req.nextUrl.searchParams.get("from"));
  const to = parseDateOnly(req.nextUrl.searchParams.get("to"));
  if (!isDistributor(distributor) || !from || !to || from > to) {
    return NextResponse.json(
      { error: 'Numeric "distributor" and valid inclusive "from"/"to" dates are required.' },
      { status: 400 }
    );
  }
  const control = await prisma.salesReturnsControl.findUnique({
    where: { distributor },
    select: { desiredMode: true },
  });
  if (control?.desiredMode === "CATCHUP") {
    return NextResponse.json(
      { error: "Smart historical reconciliation is stopped for this branch. Run the normal catchup window instead." },
      { status: 409 }
    );
  }
  const dayCount = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (dayCount > MAX_RECONCILIATION_DAYS) {
    return NextResponse.json({ error: `Reconciliation window cannot exceed ${MAX_RECONCILIATION_DAYS} days.` }, { status: 400 });
  }
  const endExclusive = new Date(to.getTime() + 86_400_000);

  const rows = await prisma.$queryRaw<DailySummaryRow[]>(Prisma.sql`
    SELECT
      TO_CHAR("deliveryDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      COUNT(*) AS "rowCount",
      COUNT(DISTINCT "invoiceNo") AS "invoiceCount",
      COALESCE(SUM("saleQtyPieces"), 0) AS "saleQtyPieces",
      COALESCE(SUM("freeQtyPieces"), 0) AS "freeQtyPieces",
      COALESCE(SUM("grossSale"), 0) AS "grossSale",
      COALESCE(SUM("netSale"), 0) AS "netSale",
      COALESCE(SUM("totalDiscount"), 0) AS "totalDiscount"
    FROM "SalesReturnLine"
    WHERE "storageLocation" = ${distributor}
      AND "deliveryDate" >= ${from}
      AND "deliveryDate" < ${endExclusive}
    GROUP BY TO_CHAR("deliveryDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    ORDER BY date
  `);

  return NextResponse.json({
    distributor,
    days: rows.map((row) => ({
      date: row.date,
      rowCount: Number(row.rowCount),
      invoiceCount: Number(row.invoiceCount),
      saleQtyPieces: Number(row.saleQtyPieces ?? 0),
      freeQtyPieces: Number(row.freeQtyPieces ?? 0),
      grossSale: Number(row.grossSale ?? 0),
      netSale: Number(row.netSale ?? 0),
      totalDiscount: Number(row.totalDiscount ?? 0),
    })),
  });
}

/** Records a successful source check after any required repair and
 * verification have completed. This heartbeat advances even on a no-change
 * run, so a quiet trading period is distinguishable from a dead scheduler. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const distributor = typeof body?.distributor === "string" ? body.distributor : null;
  const latestSourceDate = typeof body?.latestSourceDate === "string" ? body.latestSourceDate : null;
  const latestDate = parseDateOnly(latestSourceDate);
  if (!isDistributor(distributor) || !latestDate) {
    return NextResponse.json({ error: 'Numeric "distributor" and valid "latestSourceDate" are required.' }, { status: 400 });
  }

  const bridge = `sales-returns:${distributor}`;
  await prisma.syncWatermark.upsert({
    where: { bridge },
    create: { bridge, lastIncrementalAt: latestDate },
    update: { lastIncrementalAt: latestDate },
  });
  return NextResponse.json({ ok: true });
}

