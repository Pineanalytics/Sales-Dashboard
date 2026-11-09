import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RECEIPT_DOC_TYPES, type PurchaseReceiptRow } from "@/lib/purchaseReceipts/types";

export const runtime = "nodejs";

// Receives the stock-receipt lines from scripts/db-bridge/purchases-sync.ts. A month arrives as small "chunk" requests (idempotent upserts stamped with the run's syncToken)
// followed by one "finalize" request that deletes what the month still holds from an older run, so a failure mid-month leaves old + new rows side by side (a rerun fixes it)
// instead of a half-deleted month.
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

function isReceiptRow(value: unknown): value is PurchaseReceiptRow {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    (RECEIPT_DOC_TYPES as readonly string[]).includes(r.docType as string) &&
    Number.isInteger(r.docEntry) && isText(r.docNum) && typeof r.docDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.docDate) &&
    isText(r.supplierCode) && isString(r.supplierName) && isText(r.itemCode) && isString(r.itemName) && isText(r.warehouseCode) && isString(r.location) &&
    isText(r.principal) && (r.principalSource === "PRODUCT" || r.principalSource === "PREFIX" || r.principalSource === "UNALLOCATED") &&
    (r.stockClass === "GOODS" || r.stockClass === "EMPTIES") && isNum(r.qty) && isNum(r.cases) && isNum(r.value)
  );
}

function isPeriod(value: unknown): value is { year: number; monthIndex: number } {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return Number.isInteger(p.year) && Number.isInteger(p.monthIndex) && (p.monthIndex as number) >= 0 && (p.monthIndex as number) <= 11 && (p.year as number) >= 2000 && (p.year as number) <= 2100;
}

async function upsertRows(db: Prisma.TransactionClient, rows: PurchaseReceiptRow[], token: string) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const values = rows.slice(i, i + INSERT_BATCH).map((r) => {
      const year = Number(r.docDate.slice(0, 4));
      const monthIndex = Number(r.docDate.slice(5, 7)) - 1;
      return Prisma.sql`(${randomUUID()}, ${year}, ${monthIndex}, ${r.docDate}::date, ${r.docType}, ${r.docEntry}, ${r.docNum}, ${r.supplierCode}, ${r.supplierName}, ${r.itemCode}, ${r.itemName}, ${r.warehouseCode}, ${r.location}, ${r.principal}, ${r.principalSource}, ${r.stockClass}, ${r.qty}, ${r.cases}, ${r.value}, ${token}, now(), now())`;
    });
    await db.$executeRaw`
      INSERT INTO "PurchaseReceiptLine" (id, year, "monthIndex", "docDate", "docType", "docEntry", "docNum", "supplierCode", "supplierName", "itemCode", "itemName", "warehouseCode", location, principal, "principalSource", "stockClass", qty, cases, value, "syncToken", "updatedAt", "createdAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("docType", "docEntry", "docDate", "itemCode", "warehouseCode") DO UPDATE SET
        year = EXCLUDED.year, "monthIndex" = EXCLUDED."monthIndex", "docNum" = EXCLUDED."docNum", "supplierCode" = EXCLUDED."supplierCode", "supplierName" = EXCLUDED."supplierName",
        "itemName" = EXCLUDED."itemName", location = EXCLUDED.location, principal = EXCLUDED.principal, "principalSource" = EXCLUDED."principalSource",
        "stockClass" = EXCLUDED."stockClass", qty = EXCLUDED.qty, cases = EXCLUDED.cases, value = EXCLUDED.value, "syncToken" = EXCLUDED."syncToken", "updatedAt" = now()
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
  if (!isText(syncToken) || syncToken.length > 64) return NextResponse.json({ error: '"syncToken" is required (max 64 characters).' }, { status: 400 });

  if (body.mode === "finalize") {
    const periods = body.periods;
    if (!Array.isArray(periods) || periods.length === 0 || !periods.every(isPeriod)) {
      return NextResponse.json({ error: '"periods" must be a non-empty list of { year, monthIndex }.' }, { status: 400 });
    }
    try {
      let pruned = 0;
      for (const period of periods) {
        const start = new Date(Date.UTC(period.year, period.monthIndex, 1));
        const end = new Date(Date.UTC(period.year, period.monthIndex + 1, 1));
        const removed = await prisma.purchaseReceiptLine.deleteMany({ where: { docDate: { gte: start, lt: end }, syncToken: { not: syncToken } } });
        pruned += removed.count;
      }
      return NextResponse.json({ pruned });
    } catch (err) {
      console.error("Failed to finalize purchase receipt periods", err);
      return NextResponse.json({ error: "Failed to finalize purchase receipt periods." }, { status: 500 });
    }
  }

  if (body.mode !== "chunk") return NextResponse.json({ error: '"mode" must be "chunk" or "finalize".' }, { status: 400 });
  const rows = body.rows ?? [];
  if (!Array.isArray(rows) || !rows.every(isReceiptRow)) return NextResponse.json({ error: "One or more receipt rows are invalid." }, { status: 400 });
  if (rows.length > MAX_ROWS_PER_CHUNK) return NextResponse.json({ error: `A chunk may carry at most ${MAX_ROWS_PER_CHUNK} rows.` }, { status: 400 });

  try {
    await prisma.$transaction((tx) => upsertRows(tx, rows, syncToken), { timeout: 60_000 });
    return NextResponse.json({ rows: rows.length });
  } catch (err) {
    console.error("Failed to upsert purchase receipt rows", err);
    return NextResponse.json({ error: "Failed to save purchase receipt rows." }, { status: 500 });
  }
}
