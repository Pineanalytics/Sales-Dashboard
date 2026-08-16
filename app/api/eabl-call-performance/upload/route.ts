import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface EablCallUploadRow {
  sourceCallKey: string;
  callDate: string;
  salesman: string;
  agent: string | null;
  customerCode: string | null;
  customerName: string;
  customerType: string | null;
  segment: string | null;
  timeIn: string | null;
  timeOut: string | null;
  durationMinutes: number | null;
  firstCallOfDay: string | null;
  lastCallOfDay: string | null;
  callsInDay: number;
  productiveCallsInDay: number;
  dayStrikeRatePct: number | null;
  cashSales: number;
  creditSales: number;
  discounts: number;
  netSales: number;
  isProductive: boolean;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is EablCallUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  const nullableNumber = (v: unknown) => v === null || typeof v === "number";
  return typeof row.sourceCallKey === "string" && typeof row.callDate === "string" &&
    typeof row.salesman === "string" && typeof row.customerName === "string" &&
    nullableString(row.agent) && nullableString(row.customerCode) && nullableString(row.customerType) && nullableString(row.segment) &&
    nullableString(row.timeIn) && nullableString(row.timeOut) && nullableString(row.firstCallOfDay) && nullableString(row.lastCallOfDay) &&
    nullableNumber(row.durationMinutes) && nullableNumber(row.dayStrikeRatePct) &&
    typeof row.callsInDay === "number" && typeof row.productiveCallsInDay === "number" &&
    typeof row.cashSales === "number" && typeof row.creditSales === "number" && typeof row.discounts === "number" &&
    typeof row.netSales === "number" && typeof row.isProductive === "boolean";
}

/** Replaces a bounded source window. The EABL bridge is API-key-only so a
 * browser session can never overwrite a production data feed. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  let body: { calls?: unknown; windowStart?: unknown; retainFrom?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON with a "calls" array.' }, { status: 400 }); }
  if (!Array.isArray(body.calls) || !body.calls.every(isValidRow)) {
    return NextResponse.json({ error: "One or more EABL call rows are invalid." }, { status: 400 });
  }
  const parseDate = (value: unknown) => typeof value === "string" ? new Date(value) : null;
  const windowStart = parseDate(body.windowStart);
  const retainFrom = parseDate(body.retainFrom);
  if ((windowStart && Number.isNaN(windowStart.getTime())) || (retainFrom && Number.isNaN(retainFrom.getTime()))) {
    return NextResponse.json({ error: "Window dates must be valid ISO timestamps." }, { status: 400 });
  }

  const calls = body.calls as EablCallUploadRow[];
  try {
    await prisma.$transaction(async (tx) => {
      if (retainFrom) await tx.eablCall.deleteMany({ where: { callDate: { lt: retainFrom } } });
      if (windowStart) await tx.eablCall.deleteMany({ where: { callDate: { gte: windowStart } } });
      for (let index = 0; index < calls.length; index += CHUNK_SIZE) {
        await tx.eablCall.createMany({ data: calls.slice(index, index + CHUNK_SIZE).map((row) => ({
          ...row,
          callDate: new Date(row.callDate), timeIn: row.timeIn ? new Date(row.timeIn) : null,
          timeOut: row.timeOut ? new Date(row.timeOut) : null,
          firstCallOfDay: row.firstCallOfDay ? new Date(row.firstCallOfDay) : null,
          lastCallOfDay: row.lastCallOfDay ? new Date(row.lastCallOfDay) : null,
        })) });
      }
    }, { timeout: 60_000 });
    return NextResponse.json({ count: calls.length });
  } catch (error) {
    console.error("Failed to replace EABL calls", error);
    return NextResponse.json({ error: "Failed to save EABL Call Performance data." }, { status: 500 });
  }
}
