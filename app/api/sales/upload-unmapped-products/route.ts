import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ReplacementPeriod } from "@/lib/salesReplacement";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface UnmappedProductSalesUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  itemNo: string;
  itemDescription: string;
  warehouseCode: string;
  revenue: number;
  grossMargin: number;
  quantity: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRow(value: unknown): value is UnmappedProductSalesUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.year) && isText(row.month) && isNumber(row.monthIndex) && Number.isInteger(row.monthIndex) && row.monthIndex >= 0 && row.monthIndex <= 11 &&
    isText(row.itemNo) && isText(row.itemDescription) && typeof row.warehouseCode === "string" &&
    isNumber(row.revenue) && isNumber(row.grossMargin) && isNumber(row.quantity)
  );
}

function isPeriod(value: unknown): value is ReplacementPeriod {
  if (!value || typeof value !== "object") return false;
  const period = value as Record<string, unknown>;
  return isText(period.year) && Number.isInteger(period.monthIndex) && (period.monthIndex as number) >= 0 && (period.monthIndex as number) <= 11;
}

function uniquePeriods(periods: ReplacementPeriod[]): ReplacementPeriod[] {
  return Array.from(new Map(periods.map((period) => [`${period.year}|${period.monthIndex}`, period])).values());
}

async function insertChunk(db: Prisma.TransactionClient, rows: UnmappedProductSalesUploadRow[]) {
  const values = rows.map((row) => Prisma.sql`(
    ${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.itemNo}, ${row.itemDescription}, ${row.warehouseCode},
    ${row.revenue}, ${row.grossMargin}, ${row.quantity}, now(), now()
  )`);
  await db.$executeRaw`
    INSERT INTO "UnmappedProductSale" (id, year, month, "monthIndex", "itemNo", "itemDescription", "warehouseCode", revenue, "grossMargin", quantity, "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
  `;
}

/** Complete-replacement receiver for SAP Item Codes that are not yet in Product
 * Master. It accepts an empty rows array so a month can be cleared once every
 * SAP line is mapped, but only inside the explicitly supplied complete periods. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });

  let body: { rows?: unknown; replacePeriods?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with "rows" and "replacePeriods" arrays.' }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || !Array.isArray(body.replacePeriods) || !body.rows.every(isRow) || !body.replacePeriods.every(isPeriod)) {
    return NextResponse.json({ error: "Unmapped-product rows or replacement periods are invalid." }, { status: 400 });
  }

  const periods = uniquePeriods(body.replacePeriods as ReplacementPeriod[]);
  if (periods.length === 0) return NextResponse.json({ error: "At least one complete replacement period is required." }, { status: 400 });
  const periodKeys = new Set(periods.map((period) => `${period.year}|${period.monthIndex}`));
  const rows = body.rows as UnmappedProductSalesUploadRow[];
  if (rows.some((row) => !periodKeys.has(`${row.year}|${row.monthIndex}`))) {
    return NextResponse.json({ error: "Every row must belong to a supplied complete replacement period." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.unmappedProductSale.deleteMany({ where: { OR: periods.map((period) => ({ year: period.year, monthIndex: period.monthIndex })) } });
      for (let index = 0; index < rows.length; index += CHUNK_SIZE) await insertChunk(tx, rows.slice(index, index + CHUNK_SIZE));
    }, { timeout: 120_000 });
    return NextResponse.json({ rows: rows.length, replacePeriods: periods.length }, { status: 200 });
  } catch (error) {
    console.error("Failed to replace unmapped product sales", error);
    return NextResponse.json({ error: "Failed to save unmapped product sales." }, { status: 500 });
  }
}
