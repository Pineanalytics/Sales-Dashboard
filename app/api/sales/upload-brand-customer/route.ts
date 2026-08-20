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

/** A month sent by the SAP sync as a complete replacement, rather than a
 * partial patch. Customer/brand rows can disappear when an invoice is
 * corrected or reversed; those old rows must be removed before the refreshed
 * detail is saved or the Customer & Brand total will drift above SalesRecord. */
interface ReplacementPeriod {
  year: string;
  monthIndex: number;
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

function isReplacementPeriod(value: unknown): value is ReplacementPeriod {
  if (typeof value !== "object" || value === null) return false;
  const period = value as Record<string, unknown>;
  return isText(period.year) && typeof period.monthIndex === "number" && Number.isInteger(period.monthIndex) && period.monthIndex >= 0 && period.monthIndex <= 11;
}

function uniqueReplacementPeriods(periods: ReplacementPeriod[]): ReplacementPeriod[] {
  return Array.from(new Map(periods.map((period) => [`${period.year}|${period.monthIndex}`, period])).values());
}

function periodDateRange(period: ReplacementPeriod) {
  const start = new Date(Date.UTC(Number(period.year), period.monthIndex, 1));
  const end = new Date(Date.UTC(Number(period.year), period.monthIndex + 1, 1));
  return { start, end };
}

async function upsertMonthlyChunk(db: Prisma.TransactionClient, rows: MonthlyCustomerSalesUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.principal}, ${row.brand}, ${row.sapName}, ${row.customerName}, ${row.cases}, ${row.revenue}, ${row.grossProfit}, now(), now())`
  );
  await db.$executeRaw`
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

async function upsertDailyChunk(db: Prisma.TransactionClient, rows: DailyCustomerSalesUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.date}::date, ${row.principal}, ${row.brand}, ${row.sapName}, ${row.customerName}, ${row.cases}, ${row.revenue}, ${row.grossProfit}, now(), now())`
  );
  await db.$executeRaw`
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
  const monthlyReplacePeriods = (body as { monthlyReplacePeriods?: unknown })?.monthlyReplacePeriods;
  const dailyReplacePeriods = (body as { dailyReplacePeriods?: unknown })?.dailyReplacePeriods;
  if (!Array.isArray(monthlyRows) || !Array.isArray(dailyRows) || !monthlyRows.every(isMonthlyRow) || !dailyRows.every(isDailyRow)) {
    return NextResponse.json({ error: "One or more Brand&Customer SAP sales rows are invalid." }, { status: 400 });
  }
  if (
    (monthlyReplacePeriods !== undefined && (!Array.isArray(monthlyReplacePeriods) || !monthlyReplacePeriods.every(isReplacementPeriod))) ||
    (dailyReplacePeriods !== undefined && (!Array.isArray(dailyReplacePeriods) || !dailyReplacePeriods.every(isReplacementPeriod)))
  ) {
    return NextResponse.json({ error: "Replacement periods must contain a valid year and monthIndex." }, { status: 400 });
  }

  try {
    const monthlyScopes = uniqueReplacementPeriods((monthlyReplacePeriods ?? []) as ReplacementPeriod[]);
    const dailyScopes = uniqueReplacementPeriods((dailyReplacePeriods ?? []) as ReplacementPeriod[]);

    await prisma.$transaction(async (tx) => {
      // Delete the authoritative scope first, then insert the full replacement
      // inside one transaction. If any chunk fails, Postgres rolls the delete
      // back too, so the dashboard never serves a half-refreshed month.
      if (monthlyScopes.length > 0) {
        await tx.brandCustomerActual.deleteMany({
          where: { OR: monthlyScopes.map((period) => ({ year: period.year, monthIndex: period.monthIndex })) },
        });
      }
      if (dailyScopes.length > 0) {
        await tx.dailyBrandCustomerActual.deleteMany({
          where: {
            OR: dailyScopes.map((period) => {
              const { start, end } = periodDateRange(period);
              return { date: { gte: start, lt: end } };
            }),
          },
        });
      }

      for (let index = 0; index < monthlyRows.length; index += CHUNK_SIZE) await upsertMonthlyChunk(tx, monthlyRows.slice(index, index + CHUNK_SIZE));
      for (let index = 0; index < dailyRows.length; index += CHUNK_SIZE) await upsertDailyChunk(tx, dailyRows.slice(index, index + CHUNK_SIZE));
    }, { timeout: 120_000 });
    invalidateDatasetCache();
    return NextResponse.json({ monthlyRows: monthlyRows.length, dailyRows: dailyRows.length }, { status: 200 });
  } catch (err) {
    console.error("Failed to upsert Brand&Customer SAP sales rows", err);
    return NextResponse.json({ error: "Failed to save Brand&Customer SAP sales data." }, { status: 500 });
  }
}
