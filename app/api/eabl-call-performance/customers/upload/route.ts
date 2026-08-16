import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface EablCustomerUploadRow {
  customerId: string;
  principal: string;
  outletName: string;
  channel: string | null;
  subChannel: string | null;
  territory: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is EablCustomerUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  const nullableNumber = (v: unknown) => v === null || typeof v === "number";
  return typeof row.customerId === "string" && typeof row.principal === "string" && typeof row.outletName === "string" &&
    typeof row.status === "string" && nullableString(row.channel) && nullableString(row.subChannel) && nullableString(row.territory) &&
    nullableNumber(row.latitude) && nullableNumber(row.longitude);
}

/** Full reconcile every sync: this is a small (~800-1000 row) reference
 *  table, not a live call feed, so a straight delete-what's-missing +
 *  upsert-the-rest in one transaction is simpler and safer than the call
 *  bridge's windowed replace — a customer that drops out of the source
 *  query (no longer has real DSR_Calls activity) is correctly removed
 *  rather than left behind as a stale row. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  let body: { customers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "customers" array.' }, { status: 400 });
  }
  if (!Array.isArray(body.customers) || !body.customers.every(isValidRow)) {
    return NextResponse.json({ error: "One or more EABL customer rows are invalid." }, { status: 400 });
  }
  const customers = body.customers as EablCustomerUploadRow[];
  // An empty payload never touches the table — a full reconcile driven by a
  // zero-row batch (e.g. a transient source-query hiccup) must never be
  // allowed to read as "the customer master is now empty" and wipe every
  // row via an unconditional deleteMany({}).
  if (customers.length === 0) return NextResponse.json({ count: 0 });

  try {
    await prisma.$transaction(async (tx) => {
      const customerIds = customers.map((row) => row.customerId);
      await tx.eablCustomerMaster.deleteMany({ where: { customerId: { notIn: customerIds } } });
      for (let index = 0; index < customers.length; index += CHUNK_SIZE) {
        const batch = customers.slice(index, index + CHUNK_SIZE);
        const values = batch.map(
          (row) =>
            Prisma.sql`(${randomUUID()}, ${row.customerId}, ${row.principal}, ${row.outletName}, ${row.channel}, ${row.subChannel}, ${row.territory}, ${row.latitude}, ${row.longitude}, ${row.status}, now(), now())`
        );
        await tx.$executeRaw`
          INSERT INTO "EablCustomerMaster" (id, "customerId", principal, "outletName", channel, "subChannel", territory, latitude, longitude, status, "createdAt", "updatedAt")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("customerId")
          DO UPDATE SET
            principal = EXCLUDED.principal,
            "outletName" = EXCLUDED."outletName",
            channel = EXCLUDED.channel,
            "subChannel" = EXCLUDED."subChannel",
            territory = EXCLUDED.territory,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            status = EXCLUDED.status,
            "updatedAt" = now()
        `;
      }
    }, { timeout: 60_000 });
    return NextResponse.json({ count: customers.length });
  } catch (error) {
    console.error("Failed to replace EABL customer master", error);
    return NextResponse.json({ error: "Failed to save EABL customer master data." }, { status: 500 });
  }
}
