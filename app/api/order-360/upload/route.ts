import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// OrderRecord replaces rather than upserts within the uploaded window, same
// "windowed delete-then-insert" pattern as /api/timestamps/upload: the initial
// backfill sends windowStart = the start of the 3-month range (one wide delete,
// then every batch's insert); each daily incremental sync sends windowStart =
// today's midnight, so it only ever deletes+reinserts today's rows - everything
// older stays exactly as already loaded, per the "top up, don't touch history"
// requirement this bridge was built for (scripts/db-bridge/order-360/run.ts).
const CHUNK_SIZE = 500;

interface OrderUploadRow {
  orderDate: string;
  erpNumber: string;
  invoiceNumber: string | null;
  picklistId: string | null;
  customer: string;
  fsr: string;
  amount: number;
  clearedBy: string | null;
  cleared: boolean;
  clearedDate: string | null;
  picker: string | null;
  picked: boolean;
  pickDate: string | null;
  dispatcher: string | null;
  dispatched: boolean;
  dispatchDate: string | null;
  auditedBy: string | null;
  audited: boolean;
  van: string | null;
  driver: string | null;
  deliveredBy: string | null;
  delivered: boolean;
  deliveryDate: string | null;
  isReturn: boolean;
  returnDocType: string | null;
  returnedBy: string | null;
  podStatus: string | null;
  paymentModes: string | null;
  stk: boolean;
  stkPushStatus: string | null;
  stkPaymentRef: string | null;
  stkAmountPaid: number | null;
  paymentRef: string | null;
  amountPaid: number | null;
}

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

function isOptionalString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isValidRow(row: unknown): row is OrderUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.orderDate === "string" &&
    typeof r.erpNumber === "string" &&
    isOptionalString(r.invoiceNumber) &&
    isOptionalString(r.picklistId) &&
    typeof r.customer === "string" &&
    typeof r.fsr === "string" &&
    typeof r.amount === "number" &&
    isOptionalString(r.clearedBy) &&
    typeof r.cleared === "boolean" &&
    isOptionalString(r.clearedDate) &&
    isOptionalString(r.picker) &&
    typeof r.picked === "boolean" &&
    isOptionalString(r.pickDate) &&
    isOptionalString(r.dispatcher) &&
    typeof r.dispatched === "boolean" &&
    isOptionalString(r.dispatchDate) &&
    isOptionalString(r.auditedBy) &&
    typeof r.audited === "boolean" &&
    isOptionalString(r.van) &&
    isOptionalString(r.driver) &&
    isOptionalString(r.deliveredBy) &&
    typeof r.delivered === "boolean" &&
    isOptionalString(r.deliveryDate) &&
    typeof r.isReturn === "boolean" &&
    isOptionalString(r.returnDocType) &&
    isOptionalString(r.returnedBy) &&
    isOptionalString(r.podStatus) &&
    isOptionalString(r.paymentModes) &&
    typeof r.stk === "boolean" &&
    isOptionalString(r.stkPushStatus) &&
    isOptionalString(r.stkPaymentRef) &&
    (r.stkAmountPaid === null || typeof r.stkAmountPaid === "number") &&
    isOptionalString(r.paymentRef) &&
    (r.amountPaid === null || typeof r.amountPaid === "number")
  );
}

function toDate(v: string | null): Date | null {
  return v === null ? null : new Date(v);
}

async function insertChunk(tx: Prisma.TransactionClient, rows: OrderUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${new Date(r.orderDate)}, ${r.erpNumber}, ${r.invoiceNumber}, ${r.picklistId}, ${r.customer}, ${r.fsr}, ${r.amount}, ${r.clearedBy}, ${r.cleared}, ${toDate(r.clearedDate)}, ${r.picker}, ${r.picked}, ${toDate(r.pickDate)}, ${r.dispatcher}, ${r.dispatched}, ${toDate(r.dispatchDate)}, ${r.auditedBy}, ${r.audited}, ${r.van}, ${r.driver}, ${r.deliveredBy}, ${r.delivered}, ${toDate(r.deliveryDate)}, ${r.isReturn}, ${r.returnDocType}, ${r.returnedBy}, ${r.podStatus}, ${r.paymentModes}, ${r.stk}, ${r.stkPushStatus}, ${r.stkPaymentRef}, ${r.stkAmountPaid}, ${r.paymentRef}, ${r.amountPaid}, now())`
  );

  await tx.$executeRaw`
    INSERT INTO "OrderRecord" (id, "orderDate", "erpNumber", "invoiceNumber", "picklistId", customer, fsr, amount, "clearedBy", cleared, "clearedDate", picker, picked, "pickDate", dispatcher, dispatched, "dispatchDate", "auditedBy", audited, van, driver, "deliveredBy", delivered, "deliveryDate", "isReturn", "returnDocType", "returnedBy", "podStatus", "paymentModes", stk, "stkPushStatus", "stkPaymentRef", "stkAmountPaid", "paymentRef", "amountPaid", "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("erpNumber") DO UPDATE SET
      "invoiceNumber" = EXCLUDED."invoiceNumber",
      "picklistId" = EXCLUDED."picklistId",
      customer = EXCLUDED.customer,
      fsr = EXCLUDED.fsr,
      amount = EXCLUDED.amount,
      "clearedBy" = EXCLUDED."clearedBy",
      cleared = EXCLUDED.cleared,
      "clearedDate" = EXCLUDED."clearedDate",
      picker = EXCLUDED.picker,
      picked = EXCLUDED.picked,
      "pickDate" = EXCLUDED."pickDate",
      dispatcher = EXCLUDED.dispatcher,
      dispatched = EXCLUDED.dispatched,
      "dispatchDate" = EXCLUDED."dispatchDate",
      "auditedBy" = EXCLUDED."auditedBy",
      audited = EXCLUDED.audited,
      van = EXCLUDED.van,
      driver = EXCLUDED.driver,
      "deliveredBy" = EXCLUDED."deliveredBy",
      delivered = EXCLUDED.delivered,
      "deliveryDate" = EXCLUDED."deliveryDate",
      "isReturn" = EXCLUDED."isReturn",
      "returnDocType" = EXCLUDED."returnDocType",
      "returnedBy" = EXCLUDED."returnedBy",
      "podStatus" = EXCLUDED."podStatus",
      "paymentModes" = EXCLUDED."paymentModes",
      stk = EXCLUDED.stk,
      "stkPushStatus" = EXCLUDED."stkPushStatus",
      "stkPaymentRef" = EXCLUDED."stkPaymentRef",
      "stkAmountPaid" = EXCLUDED."stkAmountPaid",
      "paymentRef" = EXCLUDED."paymentRef",
      "amountPaid" = EXCLUDED."amountPaid"
  `;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload Order 360 data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload Order 360 data." }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with an "orders" array.' }, { status: 400 });
  }

  const orders = (body as { orders?: unknown })?.orders;
  if (!Array.isArray(orders)) {
    return NextResponse.json({ error: '"orders" must be an array.' }, { status: 400 });
  }
  if (!orders.every(isValidRow)) {
    return NextResponse.json({ error: "One or more order rows are missing required fields or have the wrong type." }, { status: 400 });
  }

  // windowStart (sent only on the first batch of a run) scopes a one-time delete
  // before that batch's insert - a full backfill passes the start of the 3-month
  // range, a daily incremental pass passes today's midnight, so history outside
  // the window is never touched. ON CONFLICT above additionally upserts rather
  // than no-ops, so a duplicate erpNumber (e.g. re-synced within the same window)
  // always reflects Pine's latest status rather than the first-seen one.
  const windowStartRaw = (body as { windowStart?: unknown })?.windowStart;
  if (windowStartRaw !== undefined && typeof windowStartRaw !== "string") {
    return NextResponse.json({ error: '"windowStart" must be an ISO date string when present.' }, { status: 400 });
  }
  const windowStart = typeof windowStartRaw === "string" ? new Date(windowStartRaw) : null;
  if (windowStart && Number.isNaN(windowStart.getTime())) {
    return NextResponse.json({ error: '"windowStart" must be a valid ISO date string when present.' }, { status: 400 });
  }

  try {
    const validRows = orders as OrderUploadRow[];
    await prisma.$transaction(
      async (tx) => {
        if (windowStart) {
          await tx.$executeRaw`DELETE FROM "OrderRecord" WHERE "orderDate" >= ${windowStart}`;
        }
        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
          await insertChunk(tx, validRows.slice(i, i + CHUNK_SIZE));
        }
      },
      { timeout: 60000 }
    );
    return NextResponse.json({ count: validRows.length, windowStart: windowStart?.toISOString() ?? null }, { status: 200 });
  } catch (err) {
    console.error("Failed to save OrderRecord rows", err);
    return NextResponse.json({ error: "Failed to save Order 360 data." }, { status: 500 });
  }
}
