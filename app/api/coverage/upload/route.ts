import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateDatasetCache } from "@/lib/datasetStore";

export const runtime = "nodejs";

interface CoverageUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  salesRole: string;
  employeeName: string;
  principal: string;
  coverage: number;
  productiveCalls: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function wholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validRow(value: unknown): value is CoverageUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return text(row.year) && text(row.month) && Number.isInteger(row.monthIndex) && Number(row.monthIndex) >= 0 && Number(row.monthIndex) <= 11
    && text(row.salesRole) && text(row.employeeName) && text(row.principal)
    && wholeNumber(row.coverage) && wholeNumber(row.productiveCalls);
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a direct coverage JSON payload." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const year = payload.year;
  const monthIndex = payload.monthIndex;
  const rows = payload.rows;
  if (!text(year) || !Number.isInteger(monthIndex) || Number(monthIndex) < 0 || Number(monthIndex) > 11 || !Array.isArray(rows) || !rows.every(validRow)) {
    return NextResponse.json({ error: "Coverage payload is incomplete or invalid." }, { status: 400 });
  }
  // Keep narrowed primitives outside the transaction callback; TypeScript does
  // not retain narrowing for values captured from an untyped request body.
  const partitionYear = year as string;
  const partitionMonthIndex = monthIndex as number;

  const coverageRows = rows as CoverageUploadRow[];
  if (coverageRows.some((row) => row.year !== partitionYear || row.monthIndex !== partitionMonthIndex)) {
    return NextResponse.json({ error: "Coverage rows must all belong to the declared year and month." }, { status: 400 });
  }
  const uniqueRows = new Set(coverageRows.map((row) => `${row.salesRole}\u0000${row.employeeName}\u0000${row.principal}`));
  if (uniqueRows.size !== coverageRows.length) {
    return NextResponse.json({ error: "Coverage payload contains duplicate role, employee, and principal rows." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.coverageActual.deleteMany({ where: { year: partitionYear, monthIndex: partitionMonthIndex } });
      if (coverageRows.length > 0) {
        await tx.coverageActual.createMany({ data: coverageRows });
      }
    });
    invalidateDatasetCache();
    return NextResponse.json({ count: coverageRows.length, year: partitionYear, monthIndex: partitionMonthIndex }, { status: 200 });
  } catch (error) {
    console.error("Failed to replace direct coverage month", error);
    return NextResponse.json({ error: "Failed to save direct coverage data." }, { status: 500 });
  }
}
