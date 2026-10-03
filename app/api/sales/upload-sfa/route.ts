import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Receives the SFA-outlet-grain SAP tables from scripts/db-bridge/sfa-sales-sync.ts.
// A month arrives as many small "chunk" requests (every one an idempotent upsert
// stamped with the run's syncToken) followed by one "finalize" request that
// deletes whatever that month still holds from an older run — so a failure
// mid-month leaves old + new rows side by side (a rerun fixes it) instead of a
// half-deleted month, and no single request has to carry a whole month.
const MAX_ROWS_PER_CHUNK = 2000;
const INSERT_BATCH = 500;

interface DocumentRow {
  docType: "INVOICE" | "CREDIT_NOTE";
  docNum: string;
  docDate: string;
  series: number | null;
  cardCode: string;
  accountName: string;
  sfaCustomer: string;
  sfaContact: string;
  sfaNameSource: "SFA" | "ACCOUNT";
  numAtCard: string | null;
  slpCode: number;
  repName: string;
  principal: string;
  principalSource: "PRODUCT" | "PREFIX" | "UNALLOCATED";
  lineCount: number;
  cases: number;
  netSales: number;
  grossProfit: number;
  sapGrossProfit: number;
}

interface MonthlyRow {
  year: string;
  monthIndex: number;
  principal: string;
  cardCode: string;
  accountName: string;
  sfaCustomer: string;
  sfaContact: string;
  slpCode: number;
  repName: string;
  docCount: number;
  cases: number;
  revenue: number;
  grossProfit: number;
}

interface Period {
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

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isString = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isDocumentRow(value: unknown): value is DocumentRow {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    (r.docType === "INVOICE" || r.docType === "CREDIT_NOTE") &&
    isText(r.docNum) && typeof r.docDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.docDate) &&
    (r.series === null || isNum(r.series)) &&
    isText(r.cardCode) && isString(r.accountName) && isText(r.sfaCustomer) && isString(r.sfaContact) &&
    (r.sfaNameSource === "SFA" || r.sfaNameSource === "ACCOUNT") &&
    (r.numAtCard === null || isString(r.numAtCard)) &&
    isNum(r.slpCode) && isText(r.repName) && isText(r.principal) &&
    (r.principalSource === "PRODUCT" || r.principalSource === "PREFIX" || r.principalSource === "UNALLOCATED") &&
    isNum(r.lineCount) && isNum(r.cases) && isNum(r.netSales) && isNum(r.grossProfit) && isNum(r.sapGrossProfit)
  );
}

function isMonthlyRow(value: unknown): value is MonthlyRow {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isText(r.year) && Number.isInteger(r.monthIndex) && isText(r.principal) && isText(r.cardCode) && isString(r.accountName) &&
    isText(r.sfaCustomer) && isString(r.sfaContact) && isNum(r.slpCode) && isText(r.repName) &&
    isNum(r.docCount) && isNum(r.cases) && isNum(r.revenue) && isNum(r.grossProfit)
  );
}

function isPeriod(value: unknown): value is Period {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return isText(p.year) && typeof p.monthIndex === "number" && Number.isInteger(p.monthIndex) && p.monthIndex >= 0 && p.monthIndex <= 11;
}

async function upsertDocuments(db: Prisma.TransactionClient, rows: DocumentRow[], token: string) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const values = rows.slice(i, i + INSERT_BATCH).map(
      (r) =>
        Prisma.sql`(${randomUUID()}, ${r.docType}, ${r.docNum}, ${r.docDate}::date, ${r.series}, ${r.cardCode}, ${r.accountName}, ${r.sfaCustomer}, ${r.sfaContact}, ${r.sfaNameSource}, ${r.numAtCard}, ${r.slpCode}, ${r.repName}, ${r.principal}, ${r.principalSource}, ${r.lineCount}, ${r.cases}, ${r.netSales}, ${r.grossProfit}, ${r.sapGrossProfit}, ${token}, now(), now())`
    );
    await db.$executeRaw`
      INSERT INTO "SalesDocument" (id, "docType", "docNum", "docDate", series, "cardCode", "accountName", "sfaCustomer", "sfaContact", "sfaNameSource", "numAtCard", "slpCode", "repName", principal, "principalSource", "lineCount", cases, "netSales", "grossProfit", "sapGrossProfit", "syncToken", "updatedAt", "createdAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("docType", "docNum") DO UPDATE SET
        "docDate" = EXCLUDED."docDate", series = EXCLUDED.series, "cardCode" = EXCLUDED."cardCode", "accountName" = EXCLUDED."accountName",
        "sfaCustomer" = EXCLUDED."sfaCustomer", "sfaContact" = EXCLUDED."sfaContact", "sfaNameSource" = EXCLUDED."sfaNameSource",
        "numAtCard" = EXCLUDED."numAtCard", "slpCode" = EXCLUDED."slpCode", "repName" = EXCLUDED."repName",
        principal = EXCLUDED.principal, "principalSource" = EXCLUDED."principalSource", "lineCount" = EXCLUDED."lineCount",
        cases = EXCLUDED.cases, "netSales" = EXCLUDED."netSales", "grossProfit" = EXCLUDED."grossProfit",
        "sapGrossProfit" = EXCLUDED."sapGrossProfit", "syncToken" = EXCLUDED."syncToken", "updatedAt" = now()
    `;
  }
}

async function upsertMonthly(db: Prisma.TransactionClient, rows: MonthlyRow[], token: string) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const values = rows.slice(i, i + INSERT_BATCH).map(
      (r) =>
        Prisma.sql`(${randomUUID()}, ${r.year}, ${r.monthIndex}, ${r.principal}, ${r.cardCode}, ${r.accountName}, ${r.sfaCustomer}, ${r.sfaContact}, ${r.slpCode}, ${r.repName}, ${r.docCount}, ${r.cases}, ${r.revenue}, ${r.grossProfit}, ${token}, now(), now())`
    );
    await db.$executeRaw`
      INSERT INTO "SfaCustomerActual" (id, year, "monthIndex", principal, "cardCode", "accountName", "sfaCustomer", "sfaContact", "slpCode", "repName", "docCount", cases, revenue, "grossProfit", "syncToken", "updatedAt", "createdAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT (year, "monthIndex", principal, "cardCode", "sfaCustomer", "sfaContact", "slpCode") DO UPDATE SET
        "accountName" = EXCLUDED."accountName", "repName" = EXCLUDED."repName", "docCount" = EXCLUDED."docCount",
        cases = EXCLUDED.cases, revenue = EXCLUDED.revenue, "grossProfit" = EXCLUDED."grossProfit",
        "syncToken" = EXCLUDED."syncToken", "updatedAt" = now()
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
    const periods = body.periods;
    if (!Array.isArray(periods) || periods.length === 0 || !periods.every(isPeriod)) {
      return NextResponse.json({ error: '"periods" must be a non-empty list of { year, monthIndex }.' }, { status: 400 });
    }
    try {
      let documents = 0;
      let monthlyRows = 0;
      for (const period of periods) {
        const start = new Date(Date.UTC(Number(period.year), period.monthIndex, 1));
        const end = new Date(Date.UTC(Number(period.year), period.monthIndex + 1, 1));
        const removedDocs = await prisma.salesDocument.deleteMany({ where: { docDate: { gte: start, lt: end }, syncToken: { not: syncToken } } });
        const removedRows = await prisma.sfaCustomerActual.deleteMany({ where: { year: period.year, monthIndex: period.monthIndex, syncToken: { not: syncToken } } });
        documents += removedDocs.count;
        monthlyRows += removedRows.count;
      }
      return NextResponse.json({ prunedDocuments: documents, prunedMonthlyRows: monthlyRows });
    } catch (err) {
      console.error("Failed to finalize SFA sales periods", err);
      return NextResponse.json({ error: "Failed to finalize SFA sales periods." }, { status: 500 });
    }
  }

  if (body.mode !== "chunk") return NextResponse.json({ error: '"mode" must be "chunk" or "finalize".' }, { status: 400 });

  const documents = body.documents ?? [];
  const monthlyRows = body.monthlyRows ?? [];
  if (!Array.isArray(documents) || !Array.isArray(monthlyRows) || !documents.every(isDocumentRow) || !monthlyRows.every(isMonthlyRow)) {
    return NextResponse.json({ error: "One or more SFA document or monthly rows are invalid." }, { status: 400 });
  }
  if (documents.length > MAX_ROWS_PER_CHUNK || monthlyRows.length > MAX_ROWS_PER_CHUNK) {
    return NextResponse.json({ error: `A chunk may carry at most ${MAX_ROWS_PER_CHUNK} rows per table.` }, { status: 400 });
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await upsertDocuments(tx, documents, syncToken);
        await upsertMonthly(tx, monthlyRows, syncToken);
      },
      { timeout: 60_000 }
    );
    return NextResponse.json({ documents: documents.length, monthlyRows: monthlyRows.length });
  } catch (err) {
    console.error("Failed to upsert SFA sales rows", err);
    return NextResponse.json({ error: "Failed to save SFA sales rows." }, { status: 500 });
  }
}
