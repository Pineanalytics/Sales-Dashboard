import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalidateDatasetCache } from "@/lib/datasetStore";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface MonthlyCustomerSalesUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  brand: string;
  sapName: string;
  customerName: string;
  cases: number;
  revenue: number;
  grossProfit: number;
}

interface DailyCustomerSalesUploadRow {
  date: string;
  principal: string;
  brand: string;
  sapName: string;
  customerName: string;
  cases: number;
  revenue: number;
  grossProfit: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMonthlyRow(value: unknown): value is MonthlyCustomerSalesUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.year) && isText(row.month) && Number.isInteger(row.monthIndex) && isText(row.principal) && isText(row.brand) && isText(row.sapName) && isText(row.customerName) &&
    isNumber(row.cases) && isNumber(row.revenue) && isNumber(row.grossProfit)
  );
}

function isDailyRow(value: unknown): value is DailyCustomerSalesUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.date) && isText(row.principal) && isText(row.brand) && isText(row.sapName) && isText(row.customerName) &&
    isNumber(row.cases) && isNumber(row.revenue) && isNumber(row.grossProfit)
  );
}

async function upsertMonthlyChunk(rows: MonthlyCustomerSalesUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.principal}, ${row.brand}, ${row.sapName}, ${row.customerName}, ${row.cases}, ${row.revenue}, ${row.grossProfit}, now(), now())`
  );
  await prisma.$executeRaw`
    INSERT INTO "BrandCustomerActual" (id, year, month, "monthIndex", principal, brand, "sapName", "customerName", cases, revenue, "grossProfit", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, month, principal, brand, "sapName", "customerName")
    DO UPDATE SET
      "monthIndex" = EXCLUDED."monthIndex",
      cases = EXCLUDED.cases,
      revenue = EXCLUDED.revenue,
      "grossProfit" = EXCLUDED."grossProfit",
      "updatedAt" = now()
  `;
}

async function upsertDailyChunk(rows: DailyCustomerSalesUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.date}::date, ${row.principal}, ${row.brand}, ${row.sapName}, ${row.customerName}, ${row.cases}, ${row.revenue}, ${row.grossProfit}, now(), now())`
  );
  await prisma.$executeRaw`
    INSERT INTO "DailyBrandCustomerActual" (id, date, principal, brand, "sapName", "customerName", cases, revenue, "grossProfit", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (date, principal, brand, "sapName", "customerName")
    DO UPDATE SET
      cases = EXCLUDED.cases,
      revenue = EXCLUDED.revenue,
      "grossProfit" = EXCLUDED."grossProfit",
      "updatedAt" = now()
  `;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with "monthlyRows" and "dailyRows" arrays.' }, { status: 400 });
  }

  const monthlyRows = (body as { monthlyRows?: unknown })?.monthlyRows;
  const dailyRows = (body as { dailyRows?: unknown })?.dailyRows;
  if (!Array.isArray(monthlyRows) || !Array.isArray(dailyRows) || !monthlyRows.every(isMonthlyRow) || !dailyRows.every(isDailyRow)) {
    return NextResponse.json({ error: "One or more Brand&Customer SAP sales rows are invalid." }, { status: 400 });
  }

  try {
    for (let index = 0; index < monthlyRows.length; index += CHUNK_SIZE) await upsertMonthlyChunk(monthlyRows.slice(index, index + CHUNK_SIZE));
    for (let index = 0; index < dailyRows.length; index += CHUNK_SIZE) await upsertDailyChunk(dailyRows.slice(index, index + CHUNK_SIZE));
    invalidateDatasetCache();
    return NextResponse.json({ monthlyRows: monthlyRows.length, dailyRows: dailyRows.length }, { status: 200 });
  } catch (err) {
    console.error("Failed to upsert Brand&Customer SAP sales rows", err);
    return NextResponse.json({ error: "Failed to save Brand&Customer SAP sales data." }, { status: 500 });
  }
}
