import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SalesLineRecord } from "@/lib/salesLines";

export const runtime = "nodejs";

// Receives the SAP invoice lines from scripts/db-bridge/sales-lines-sync.ts. A month arrives as many small "chunk"
// requests (each an idempotent upsert stamped with the run's syncToken) followed by one "finalize" request that deletes
// the lines that month still holds from an older run and marks the month as held. The month is only marked when the
// number of lines stored under the run's token equals the number the run says it read.
const MAX_ROWS_PER_CHUNK = 2000;
const INSERT_BATCH = 500;

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isString = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const orNull = <T,>(check: (v: unknown) => v is T) => (v: unknown): v is T | null => v === null || check(v);

const FIELD_CHECKS: { [K in keyof SalesLineRecord]: (value: unknown) => boolean } = {
  docType: (v) => v === "INVOICE" || v === "CREDIT_NOTE",
  docEntry: Number.isInteger, lineNum: Number.isInteger, docNum: (v) => typeof v === "string" && /^\d+$/.test(v), docDate: isDay,
  docStatus: isString, printed: (v) => typeof v === "boolean", seriesName: orNull(isString), cardCode: isText, customerName: isString,
  sfaName: orNull(isString), phone: orNull(isString), numAtCard: orNull(isString), remarks: orNull(isString), salesEmployee: isText,
  principal: isText, itemCode: isText, itemName: isString, quantity: isNum, inventoryQty: isNum, packSize: orNull(isNum),
  whsCode: orNull(isString), whsName: orNull(isString), priceBeforeDiscount: orNull(isNum), price: orNull(isNum), discountPct: orNull(isNum),
  vatAmount: isNum, salesAmount: isNum, paidAmount: isNum, unitCost: orNull(isNum), createdBy: orNull(isString), creationDate: orNull(isDay),
  costCentre1: orNull(isString), costCentre2: orNull(isString), costCentre3: orNull(isString),
};

function isLine(value: unknown): value is SalesLineRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(FIELD_CHECKS).every(([field, check]) => check(record[field]));
}

const COLUMNS = Object.keys(FIELD_CHECKS) as (keyof SalesLineRecord)[];
const KEY_COLUMNS = new Set<string>(["docType", "docEntry", "lineNum"]);

const DATE_COLUMNS = new Set<string>(["docDate", "creationDate"]);
const INTEGER_COLUMNS = new Set<string>(["docEntry", "lineNum"]);
const FLOAT_COLUMNS = new Set<string>(["quantity", "inventoryQty", "packSize", "priceBeforeDiscount", "price", "discountPct", "vatAmount", "salesAmount", "paidAmount", "unitCost"]);
const typeOf = (column: string) => (DATE_COLUMNS.has(column) ? "date" : INTEGER_COLUMNS.has(column) ? "integer" : FLOAT_COLUMNS.has(column) ? "double precision" : column === "printed" ? "boolean" : "text");

const raw = (parts: string[]) => Prisma.raw(parts.join(", "));
const COLUMN_LIST = raw(COLUMNS.map((column) => `"${column}"`));
const SELECT_LIST = raw(COLUMNS.map((column) => `line."${column}"`));
const RECORD_SHAPE = raw(["id text", ...COLUMNS.map((column) => `"${column}" ${typeOf(column)}`)]);
const UPDATE_LIST = raw(COLUMNS.filter((column) => !KEY_COLUMNS.has(column)).map((column) => `"${column}" = EXCLUDED."${column}"`));

/** A batch goes to the database as one JSON value, so the statement is the same text with the same two values whatever the batch
 *  holds. One value per cell made a new, very large prepared statement for nearly every batch; the database kept them all and the
 *  server ran out of memory during a history load. */
async function upsertLines(db: Prisma.TransactionClient, rows: SalesLineRecord[], token: string) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = JSON.stringify(rows.slice(i, i + INSERT_BATCH).map((row) => ({ id: randomUUID(), ...row })));
    await db.$executeRaw`
      INSERT INTO "SalesLine" (id, ${COLUMN_LIST}, "syncToken", "updatedAt")
      SELECT line.id, ${SELECT_LIST}, ${token}, now()
      FROM jsonb_to_recordset(${batch}::jsonb) AS line(${RECORD_SHAPE})
      ON CONFLICT ("docType", "docEntry", "lineNum") DO UPDATE SET ${UPDATE_LIST}, "syncToken" = EXCLUDED."syncToken", "updatedAt" = now()
    `;
  }
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const syncToken = body.syncToken;
  if (!isText(syncToken) || syncToken.length > 64) {
    return NextResponse.json({ error: '"syncToken" is required (max 64 characters).' }, { status: 400 });
  }

  if (body.mode === "finalize") {
    const period = body.period as { year?: unknown; monthIndex?: unknown } | undefined;
    const monthIndex = period?.monthIndex;
    const year = period?.year;
    const lineCount = body.lineCount;
    if (typeof year !== "string" || !/^\d{4}$/.test(year) || !Number.isInteger(monthIndex) || (monthIndex as number) < 0 || (monthIndex as number) > 11 || !Number.isInteger(lineCount) || (lineCount as number) < 1) {
      return NextResponse.json({ error: '"period" ({ year, monthIndex }) and "lineCount" are required.' }, { status: 400 });
    }
    try {
      const month = monthIndex as number;
      const inMonth = { gte: new Date(Date.UTC(Number(year), month, 1)), lt: new Date(Date.UTC(Number(year), month + 1, 1)) };
      const stored = await prisma.salesLine.count({ where: { docDate: inMonth, syncToken } });
      if (stored !== lineCount) {
        return NextResponse.json({ error: `The month is incomplete: ${stored} of ${lineCount} lines are stored. Run it again.` }, { status: 409 });
      }
      const pruned = await prisma.salesLine.deleteMany({ where: { docDate: inMonth, syncToken: { not: syncToken } } });
      const held = { lineCount: stored, syncedAt: new Date() };
      await prisma.salesLineMonth.upsert({ where: { year_monthIndex: { year, monthIndex: month } }, create: { year, monthIndex: month, ...held }, update: held });
      return NextResponse.json({ pruned: pruned.count });
    } catch (err) {
      console.error("Failed to finalize a month of sales lines", err);
      return NextResponse.json({ error: "Failed to finalize the month." }, { status: 500 });
    }
  }

  const lines = body.lines;
  if (body.mode !== "chunk" || !Array.isArray(lines) || lines.length === 0 || lines.length > MAX_ROWS_PER_CHUNK || !lines.every(isLine)) {
    return NextResponse.json({ error: `Send "mode": "chunk" with 1-${MAX_ROWS_PER_CHUNK} valid "lines".` }, { status: 400 });
  }
  try {
    await prisma.$transaction((tx) => upsertLines(tx, lines, syncToken), { timeout: 60_000 });
    return NextResponse.json({ lines: lines.length });
  } catch (err) {
    console.error("Failed to save sales lines", err);
    return NextResponse.json({ error: "Failed to save the lines." }, { status: 500 });
  }
}
