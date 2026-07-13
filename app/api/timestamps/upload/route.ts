import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// RepCall always holds "this month only" (see schema comment) — every sync fully
// replaces the table rather than upserting, so a call that no longer exists
// upstream (e.g. corrected/deleted) doesn't linger. Same CHUNK_SIZE rationale as
// /api/pl/upload.
const CHUNK_SIZE = 500;

interface RepCallUploadRow {
  date: string;
  employeeCode: string;
  salesRep: string;
  employeeGroup: string;
  salesRole: string;
  region: string;
  callSequence: number;
  callTime: string;
  callOutcome: string;
  noSaleReason: string | null;
  outletId: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  costCentresBought: string;
  intervalMins: number | null;
  documents: number;
  sales: number;
  qty: number;
  firstCallOfDay: string;
  lastCallOfDay: string;
  hoursInDay: number;
  callsInDay: number;
  productiveInDay: number;
}

const VALID_OUTCOMES = new Set(["Sale", "No Sale"]);

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(row: unknown): row is RepCallUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    typeof r.employeeCode === "string" &&
    typeof r.salesRep === "string" &&
    typeof r.employeeGroup === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.region === "string" &&
    typeof r.callSequence === "number" &&
    typeof r.callTime === "string" &&
    typeof r.callOutcome === "string" &&
    VALID_OUTCOMES.has(r.callOutcome) &&
    (r.noSaleReason === null || typeof r.noSaleReason === "string") &&
    typeof r.outletId === "string" &&
    typeof r.outletName === "string" &&
    typeof r.channel === "string" &&
    typeof r.subChannel === "string" &&
    typeof r.territory === "string" &&
    typeof r.costCentresBought === "string" &&
    (r.intervalMins === null || typeof r.intervalMins === "number") &&
    typeof r.documents === "number" &&
    typeof r.sales === "number" &&
    typeof r.qty === "number" &&
    typeof r.firstCallOfDay === "string" &&
    typeof r.lastCallOfDay === "string" &&
    typeof r.hoursInDay === "number" &&
    typeof r.callsInDay === "number" &&
    typeof r.productiveInDay === "number"
  );
}

async function insertChunk(tx: Prisma.TransactionClient, rows: RepCallUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${new Date(r.date)}, ${r.employeeCode}, ${r.salesRep}, ${r.employeeGroup}, ${r.salesRole}, ${r.region}, ${r.callSequence}, ${new Date(r.callTime)}, ${r.callOutcome}, ${r.noSaleReason}, ${r.outletId}, ${r.outletName}, ${r.channel}, ${r.subChannel}, ${r.territory}, ${r.costCentresBought}, ${r.intervalMins}, ${r.documents}, ${r.sales}, ${r.qty}, ${new Date(r.firstCallOfDay)}, ${new Date(r.lastCallOfDay)}, ${r.hoursInDay}, ${r.callsInDay}, ${r.productiveInDay}, now())`
  );

  await tx.$executeRaw`
    INSERT INTO "RepCall" (id, date, "employeeCode", "salesRep", "employeeGroup", "salesRole", region, "callSequence", "callTime", "callOutcome", "noSaleReason", "outletId", "outletName", channel, "subChannel", territory, "costCentresBought", "intervalMins", documents, sales, qty, "firstCallOfDay", "lastCallOfDay", "hoursInDay", "callsInDay", "productiveInDay", "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (date, "employeeCode", "outletId") DO NOTHING
  `;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload Timestamps data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload Timestamps data." }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "calls" array.' }, { status: 400 });
  }

  const calls = (body as { calls?: unknown })?.calls;
  if (!Array.isArray(calls)) {
    return NextResponse.json({ error: '"calls" must be an array.' }, { status: 400 });
  }
  if (!calls.every(isValidRow)) {
    return NextResponse.json({ error: "One or more call rows are missing required fields or have an invalid callOutcome." }, { status: 400 });
  }

  // The full row set is too large for one HTTP request (Netlify's payload limit),
  // so the client sends it as several smaller batches. "replace: true" on the
  // first batch clears the table once; later batches in the same sync only
  // insert, so they don't wipe out rows the earlier batches just wrote.
  const replace = (body as { replace?: unknown })?.replace !== false;

  try {
    const validRows = calls as RepCallUploadRow[];
    await prisma.$transaction(
      async (tx) => {
        if (replace) {
          await tx.$executeRaw`DELETE FROM "RepCall"`;
        }
        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
          await insertChunk(tx, validRows.slice(i, i + CHUNK_SIZE));
        }
      },
      { timeout: 30000 }
    );
    return NextResponse.json({ count: validRows.length, replaced: replace }, { status: 200 });
  } catch (err) {
    console.error("Failed to replace RepCall rows", err);
    return NextResponse.json({ error: "Failed to save Timestamps data." }, { status: 500 });
  }
}
