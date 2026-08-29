import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface OutletSkuDailySalesUploadRow {
  distributor: string;
  distributorName: string;
  pjp: string;
  dsrName: string;
  outletCode: string;
  outletName: string;
  date: string;
  channel: string;
  category: string;
  brand: string;
  sku: string;
  skuDesc: string;
  pcs: number;
  amount: number;
  discount: number;
  discountPercent: number | null;
  netSales: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is OutletSkuDailySalesUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.distributor === "string" &&
    typeof row.distributorName === "string" &&
    typeof row.pjp === "string" &&
    typeof row.dsrName === "string" &&
    typeof row.outletCode === "string" &&
    typeof row.outletName === "string" &&
    typeof row.date === "string" &&
    typeof row.channel === "string" &&
    typeof row.category === "string" &&
    typeof row.brand === "string" &&
    typeof row.sku === "string" &&
    typeof row.skuDesc === "string" &&
    typeof row.pcs === "number" &&
    typeof row.amount === "number" &&
    typeof row.discount === "number" &&
    (row.discountPercent === null || typeof row.discountPercent === "number") &&
    typeof row.netSales === "number"
  );
}

/** Replaces a bounded delivery-date window, same pattern as
 *  /api/sales-returns/upload. API-key-only (`UPLOAD_API_KEY`) — never
 *  session-authenticated. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { rows?: unknown; windowStart?: unknown; windowEnd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array.' }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || !body.rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more Outlet x SKU daily sales rows are invalid." }, { status: 400 });
  }

  const parseDate = (value: unknown) => (typeof value === "string" ? new Date(value) : null);
  const windowStart = parseDate(body.windowStart);
  const windowEnd = parseDate(body.windowEnd);
  if ((windowStart && Number.isNaN(windowStart.getTime())) || (windowEnd && Number.isNaN(windowEnd.getTime()))) {
    return NextResponse.json({ error: "Window dates must be valid ISO timestamps." }, { status: 400 });
  }

  const rows = body.rows as OutletSkuDailySalesUploadRow[];
  try {
    await prisma.$transaction(
      async (tx) => {
        // Scoped to this batch's own distributor(s), not just the date
        // window — see the matching comment in
        // app/api/sales-returns/upload/route.ts for why (this table is
        // shared across branches too). Skipped when rows is empty, same
        // reasoning as that route.
        if (windowStart && windowEnd && rows.length > 0) {
          const distributors = Array.from(new Set(rows.map((row) => row.distributor)));
          await tx.outletSkuDailySales.deleteMany({
            where: { date: { gte: windowStart, lt: windowEnd }, distributor: { in: distributors } },
          });
        }
        for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
          await tx.outletSkuDailySales.createMany({
            data: rows.slice(index, index + CHUNK_SIZE).map((row) => ({
              ...row,
              sourceRowKey: `${row.distributor}|${row.pjp}|${row.dsrName}|${row.outletCode}|${row.sku}|${row.date}`,
              date: new Date(row.date),
            })),
          });
        }
      },
      { timeout: 60_000 }
    );
    return NextResponse.json({ count: rows.length });
  } catch (error) {
    console.error("Failed to replace Outlet x SKU daily sales rows", error);
    return NextResponse.json({ error: "Failed to save Outlet x SKU daily sales data." }, { status: 500 });
  }
}
