import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// Same batching rationale as /api/pl/upload: one round-trip per row would blow
// Netlify Functions' execution-time limit on a multi-thousand-row sync.
const CHUNK_SIZE = 500;

interface ActiveOutletUploadRow {
  year: string;
  principal: string;
  customerId: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  salesRole: string;
  timesBought: number;
  purchaseDays: number;
  activeMonths: number;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  frequencyBand: string;
  sales: number;
  qty: number;
  mostRecentRep: string | null;
  mostRecentRepGroup: string | null;
}

interface ActiveOutletMonthlyUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  salesRole: string;
  distinctOutlets: number;
  transactions: number;
  sales: number;
}

async function upsertOutletChunk(rows: ActiveOutletUploadRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${r.year}, ${r.principal}, ${r.customerId}, ${r.outletName}, ${r.channel}, ${r.subChannel}, ${r.territory}, ${r.salesRole}, ${r.timesBought}, ${r.purchaseDays}, ${r.activeMonths}, ${new Date(r.firstPurchaseDate)}, ${new Date(r.lastPurchaseDate)}, ${r.frequencyBand}, ${r.sales}, ${r.qty}, ${r.mostRecentRep}, ${r.mostRecentRepGroup}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "ActiveOutlet" (id, year, principal, "customerId", "outletName", channel, "subChannel", territory, "salesRole", "timesBought", "purchaseDays", "activeMonths", "firstPurchaseDate", "lastPurchaseDate", "frequencyBand", sales, qty, "mostRecentRep", "mostRecentRepGroup", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, principal, "customerId")
    DO UPDATE SET
      "outletName" = EXCLUDED."outletName",
      channel = EXCLUDED.channel,
      "subChannel" = EXCLUDED."subChannel",
      territory = EXCLUDED.territory,
      "salesRole" = EXCLUDED."salesRole",
      "timesBought" = EXCLUDED."timesBought",
      "purchaseDays" = EXCLUDED."purchaseDays",
      "activeMonths" = EXCLUDED."activeMonths",
      "firstPurchaseDate" = EXCLUDED."firstPurchaseDate",
      "lastPurchaseDate" = EXCLUDED."lastPurchaseDate",
      "frequencyBand" = EXCLUDED."frequencyBand",
      sales = EXCLUDED.sales,
      qty = EXCLUDED.qty,
      "mostRecentRep" = EXCLUDED."mostRecentRep",
      "mostRecentRepGroup" = EXCLUDED."mostRecentRepGroup",
      "updatedAt" = now()
  `;
}

async function upsertMonthlyChunk(rows: ActiveOutletMonthlyUploadRow[]) {
  const values = rows.map(
    (r) => Prisma.sql`(${randomUUID()}, ${r.year}, ${r.month}, ${r.monthIndex}, ${r.principal}, ${r.salesRole}, ${r.distinctOutlets}, ${r.transactions}, ${r.sales}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "ActiveOutletMonthly" (id, year, month, "monthIndex", principal, "salesRole", "distinctOutlets", transactions, sales, "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, month, principal, "salesRole")
    DO UPDATE SET
      "monthIndex" = EXCLUDED."monthIndex",
      "distinctOutlets" = EXCLUDED."distinctOutlets",
      transactions = EXCLUDED.transactions,
      sales = EXCLUDED.sales,
      "updatedAt" = now()
  `;
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

function isValidOutletRow(row: unknown): row is ActiveOutletUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.year === "string" &&
    typeof r.principal === "string" &&
    typeof r.customerId === "string" &&
    typeof r.outletName === "string" &&
    typeof r.channel === "string" &&
    typeof r.subChannel === "string" &&
    typeof r.territory === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.timesBought === "number" &&
    typeof r.purchaseDays === "number" &&
    typeof r.activeMonths === "number" &&
    typeof r.firstPurchaseDate === "string" &&
    typeof r.lastPurchaseDate === "string" &&
    typeof r.frequencyBand === "string" &&
    typeof r.sales === "number" &&
    typeof r.qty === "number" &&
    (r.mostRecentRep === null || typeof r.mostRecentRep === "string") &&
    (r.mostRecentRepGroup === null || typeof r.mostRecentRepGroup === "string")
  );
}

function isValidMonthlyRow(row: unknown): row is ActiveOutletMonthlyUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.year === "string" &&
    typeof r.month === "string" &&
    typeof r.monthIndex === "number" &&
    typeof r.principal === "string" &&
    typeof r.salesRole === "string" &&
    typeof r.distinctOutlets === "number" &&
    typeof r.transactions === "number" &&
    typeof r.sales === "number"
  );
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in to upload Active Outlets data." }, { status: 401 });
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only administrators can upload Active Outlets data." }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with "outlets" and "monthly" arrays.' }, { status: 400 });
  }

  const outlets = (body as { outlets?: unknown })?.outlets;
  const monthly = (body as { monthly?: unknown })?.monthly;
  if (!Array.isArray(outlets) || !Array.isArray(monthly)) {
    return NextResponse.json({ error: '"outlets" and "monthly" must both be arrays.' }, { status: 400 });
  }
  if (!outlets.every(isValidOutletRow)) {
    return NextResponse.json({ error: "One or more outlet rows are missing required fields." }, { status: 400 });
  }
  if (!monthly.every(isValidMonthlyRow)) {
    return NextResponse.json({ error: "One or more monthly rows are missing required fields." }, { status: 400 });
  }

  try {
    for (let i = 0; i < outlets.length; i += CHUNK_SIZE) {
      await upsertOutletChunk(outlets.slice(i, i + CHUNK_SIZE));
    }
    for (let i = 0; i < monthly.length; i += CHUNK_SIZE) {
      await upsertMonthlyChunk(monthly.slice(i, i + CHUNK_SIZE));
    }
    return NextResponse.json({ outletCount: outlets.length, monthlyCount: monthly.length }, { status: 200 });
  } catch (err) {
    console.error("Failed to upsert Active Outlets rows", err);
    return NextResponse.json({ error: "Failed to save Active Outlets data." }, { status: 500 });
  }
}
