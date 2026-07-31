import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface MonthlyRepSalesUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  location: string;
  principal: string;
  sapName: string;
  employeeCode: string | null;
  employeeName: string | null;
  volume: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
}

interface DailyRepSalesUploadRow {
  date: string;
  location: string;
  principal: string;
  sapName: string;
  employeeCode: string | null;
  employeeName: string | null;
  volume: number;
  revenue: number;
  cogs: number;
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

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMonthlyRow(value: unknown): value is MonthlyRepSalesUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.year) && isText(row.month) && Number.isInteger(row.monthIndex) && isText(row.location) && isText(row.principal) && isText(row.sapName) &&
    isNullableText(row.employeeCode) && isNullableText(row.employeeName) && isNumber(row.volume) && isNumber(row.revenue) && isNumber(row.cogs) && isNumber(row.grossProfit)
  );
}

function isDailyRow(value: unknown): value is DailyRepSalesUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.date) && isText(row.location) && isText(row.principal) && isText(row.sapName) && isNullableText(row.employeeCode) && isNullableText(row.employeeName) &&
    isNumber(row.volume) && isNumber(row.revenue) && isNumber(row.cogs) && isNumber(row.grossProfit)
  );
}

async function upsertMonthlyChunk(rows: MonthlyRepSalesUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.location}, ${row.principal}, ${row.sapName}, ${row.employeeCode}, ${row.employeeName}, ${row.volume}, ${row.revenue}, ${row.cogs}, ${row.grossProfit}, now(), now())`
  );
  await prisma.$executeRaw`
    INSERT INTO "SalesRepActual" (id, year, month, "monthIndex", location, principal, "sapName", "employeeCode", "employeeName", volume, revenue, cogs, "grossProfit", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, month, principal, "sapName")
    DO UPDATE SET
      "monthIndex" = EXCLUDED."monthIndex",
      location = EXCLUDED.location,
      "employeeCode" = EXCLUDED."employeeCode",
      "employeeName" = EXCLUDED."employeeName",
      volume = EXCLUDED.volume,
      revenue = EXCLUDED.revenue,
      cogs = EXCLUDED.cogs,
      "grossProfit" = EXCLUDED."grossProfit",
      "updatedAt" = now()
  `;
}

async function upsertDailyChunk(rows: DailyRepSalesUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.date}::date, ${row.location}, ${row.principal}, ${row.sapName}, ${row.employeeCode}, ${row.employeeName}, ${row.volume}, ${row.revenue}, ${row.cogs}, ${row.grossProfit}, now(), now())`
  );
  await prisma.$executeRaw`
    INSERT INTO "DailySalesRepActual" (id, date, location, principal, "sapName", "employeeCode", "employeeName", volume, revenue, cogs, "grossProfit", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (date, principal, "sapName")
    DO UPDATE SET
      location = EXCLUDED.location,
      "employeeCode" = EXCLUDED."employeeCode",
      "employeeName" = EXCLUDED."employeeName",
      volume = EXCLUDED.volume,
      revenue = EXCLUDED.revenue,
      cogs = EXCLUDED.cogs,
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
    return NextResponse.json({ error: "One or more rep-level SAP sales rows are invalid." }, { status: 400 });
  }

  try {
    for (let index = 0; index < monthlyRows.length; index += CHUNK_SIZE) await upsertMonthlyChunk(monthlyRows.slice(index, index + CHUNK_SIZE));
    for (let index = 0; index < dailyRows.length; index += CHUNK_SIZE) await upsertDailyChunk(dailyRows.slice(index, index + CHUNK_SIZE));
    const unmatchedMonthlyRows = (monthlyRows as MonthlyRepSalesUploadRow[]).filter((row) => !row.employeeCode).length;
    return NextResponse.json({ monthlyRows: monthlyRows.length, dailyRows: dailyRows.length, unmatchedMonthlyRows }, { status: 200 });
  } catch (err) {
    console.error("Failed to upsert rep-level SAP sales rows", err);
    return NextResponse.json({ error: "Failed to save rep-level SAP sales data." }, { status: 500 });
  }
}
