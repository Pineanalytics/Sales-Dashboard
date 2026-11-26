import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// RepCall replaces rather than upserts, so a call that no longer exists
// upstream (e.g. corrected/deleted) doesn't linger — but the delete is now
// scoped to windowStart..now instead of always wiping the whole table (see
// scripts/db-bridge/active-outlets/run.ts's incremental mode, which only
// rebuilds the last 2 days; a day that's fully in the past doesn't need
// re-sequencing every hourly run). retainFrom separately caps how far back
// RepCall keeps rows at all — the live sync passes
// lib/timeManagement.ts's TIMESTAMPS_RETENTION_MONTHS trailing months, not
// just the current month, so the Timestamps page can browse recent history
// rather than only ever the current month. Same CHUNK_SIZE rationale as
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
  cases: number | null;
  /** Product lines on the call. Absent from a sender that predates it: stored as null (not recorded). */
  lines?: number | null;
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
    (r.cases === null || typeof r.cases === "number") &&
    (r.lines === undefined || r.lines === null || typeof r.lines === "number") &&
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
      Prisma.sql`(${randomUUID()}, ${new Date(r.date)}, ${r.employeeCode}, ${r.salesRep}, ${r.employeeGroup}, ${r.salesRole}, ${r.region}, ${r.callSequence}, ${new Date(r.callTime)}, ${r.callOutcome}, ${r.noSaleReason}, ${r.outletId}, ${r.outletName}, ${r.channel}, ${r.subChannel}, ${r.territory}, ${r.costCentresBought}, ${r.intervalMins}, ${r.documents}, ${r.sales}, ${r.qty}, ${r.cases}, ${r.lines ?? null}, ${new Date(r.firstCallOfDay)}, ${new Date(r.lastCallOfDay)}, ${r.hoursInDay}, ${r.callsInDay}, ${r.productiveInDay}, now())`
  );

  await tx.$executeRaw`
    INSERT INTO "RepCall" (id, date, "employeeCode", "salesRep", "employeeGroup", "salesRole", region, "callSequence", "callTime", "callOutcome", "noSaleReason", "outletId", "outletName", channel, "subChannel", territory, "costCentresBought", "intervalMins", documents, sales, qty, cases, lines, "firstCallOfDay", "lastCallOfDay", "hoursInDay", "callsInDay", "productiveInDay", "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (date, "employeeCode", "outletId") DO NOTHING
  `;
}

interface LineCountRow {
  date: string;
  employeeCode: string;
  outletId: string;
  lines: number;
}

function isLineCountRow(row: unknown): row is LineCountRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    typeof r.employeeCode === "string" &&
    typeof r.outletId === "string" &&
    typeof r.lines === "number" && Number.isInteger(r.lines) && r.lines >= 0
  );
}

/** Fills RepCall.lines on calls already saved, and nothing else: no row is added or removed and no call, outcome or value changes,
 *  so replaying old days can't restate them. */
async function saveLineCounts(rows: LineCountRow[]): Promise<number> {
  let updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const values = rows
      .slice(i, i + CHUNK_SIZE)
      .map((r) => Prisma.sql`(${r.date}::date, ${r.employeeCode}::text, ${r.outletId}::text, ${r.lines}::int)`);
    updated += await prisma.$executeRaw`
      UPDATE "RepCall" AS saved SET lines = counted.lines
      FROM (VALUES ${Prisma.join(values)}) AS counted(date, employee_code, outlet_id, lines)
      WHERE saved.date = counted.date AND saved."employeeCode" = counted.employee_code AND saved."outletId" = counted.outlet_id
        AND saved."callOutcome" = 'Sale'
    `;
  }
  return updated;
}

interface DayVisitRow {
  date: string;
  employeeCode: string;
  firstVisit: string;
  lastVisit: string;
}

function isDayVisitRow(row: unknown): row is DayVisitRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || typeof r.employeeCode !== "string") return false;
  const onTheDay = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) && value.startsWith(`${r.date}T`);
  return onTheDay(r.firstVisit) && onTheDay(r.lastVisit) && (r.firstVisit as string) <= (r.lastVisit as string);
}

/** Widens saved rep-days to the rep's visits: an earlier first visit moves the start back, a later last visit moves the close on,
 *  and the hours in the day follow. It never narrows a day, so repeating it changes nothing, and no row is added or removed. */
async function saveDayVisits(rows: DayVisitRow[]): Promise<number> {
  let updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const values = rows
      .slice(i, i + CHUNK_SIZE)
      // The wall-clock text, without the "Z": call times are stored as written, so no time-zone conversion may touch it.
      .map((r) => Prisma.sql`(${r.date}::date, ${r.employeeCode}::text, ${r.firstVisit.slice(0, 19)}::timestamp, ${r.lastVisit.slice(0, 19)}::timestamp)`);
    updated += await prisma.$executeRaw`
      UPDATE "RepCall" AS saved
      SET "firstCallOfDay" = LEAST(saved."firstCallOfDay", counted.first_visit),
          "lastCallOfDay" = GREATEST(saved."lastCallOfDay", counted.last_visit),
          "hoursInDay" = ROUND((EXTRACT(EPOCH FROM (GREATEST(saved."lastCallOfDay", counted.last_visit) - LEAST(saved."firstCallOfDay", counted.first_visit))) / 3600)::numeric, 2)
      FROM (VALUES ${Prisma.join(values)}) AS counted(date, employee_code, first_visit, last_visit)
      WHERE saved.date = counted.date AND saved."employeeCode" = counted.employee_code
        AND (saved."firstCallOfDay" > counted.first_visit OR saved."lastCallOfDay" < counted.last_visit)
    `;
  }
  return updated;
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

  const dayVisits = (body as { dayVisits?: unknown })?.dayVisits;
  if (dayVisits !== undefined) {
    if (!Array.isArray(dayVisits) || !dayVisits.every(isDayVisitRow)) {
      return NextResponse.json({ error: '"dayVisits" must be an array of { date, employeeCode, firstVisit, lastVisit } with both visits on that date.' }, { status: 400 });
    }
    try {
      return NextResponse.json({ count: dayVisits.length, updated: await saveDayVisits(dayVisits) }, { status: 200 });
    } catch (err) {
      console.error("Failed to save RepCall day visits", err);
      return NextResponse.json({ error: "Failed to save Timestamps day visits." }, { status: 500 });
    }
  }

  const lineCounts = (body as { lineCounts?: unknown })?.lineCounts;
  if (lineCounts !== undefined) {
    if (!Array.isArray(lineCounts) || !lineCounts.every(isLineCountRow)) {
      return NextResponse.json({ error: '"lineCounts" must be an array of { date, employeeCode, outletId, lines }.' }, { status: 400 });
    }
    try {
      const updated = await saveLineCounts(lineCounts);
      // A no-sale call has no product lines by definition: close those off for the same days, so only calls that sold stay unrecorded.
      const days = [...new Set(lineCounts.map((r) => r.date))].map((date) => new Date(`${date}T00:00:00.000Z`));
      if (days.length > 0) await prisma.repCall.updateMany({ where: { date: { in: days }, callOutcome: "No Sale", lines: null }, data: { lines: 0 } });
      return NextResponse.json({ count: lineCounts.length, updated }, { status: 200 });
    } catch (err) {
      console.error("Failed to save RepCall line counts", err);
      return NextResponse.json({ error: "Failed to save Timestamps line counts." }, { status: 500 });
    }
  }

  const calls = (body as { calls?: unknown })?.calls;
  if (!Array.isArray(calls)) {
    return NextResponse.json({ error: '"calls" must be an array.' }, { status: 400 });
  }
  if (!calls.every(isValidRow)) {
    return NextResponse.json({ error: "One or more call rows are missing required fields or have an invalid callOutcome." }, { status: 400 });
  }

  // The full row set is too large for one HTTP request, so the client sends
  // it as several smaller batches. windowStart (only sent on the first
  // batch) scopes a one-time delete before that batch's insert; later
  // batches in the same sync omit it, so they don't re-delete rows the
  // earlier batches in this same run just wrote.
  const windowStartRaw = (body as { windowStart?: unknown })?.windowStart;
  if (windowStartRaw !== undefined && typeof windowStartRaw !== "string") {
    return NextResponse.json({ error: '"windowStart" must be an ISO date string when present.' }, { status: 400 });
  }
  const windowStart = typeof windowStartRaw === "string" ? new Date(windowStartRaw) : null;
  if (windowStart && Number.isNaN(windowStart.getTime())) {
    return NextResponse.json({ error: '"windowStart" must be a valid ISO date string when present.' }, { status: 400 });
  }
  const retainFromRaw = (body as { retainFrom?: unknown })?.retainFrom;
  if (retainFromRaw !== undefined && typeof retainFromRaw !== "string") {
    return NextResponse.json({ error: '"retainFrom" must be an ISO date string when present.' }, { status: 400 });
  }
  const retainFrom = typeof retainFromRaw === "string" ? new Date(retainFromRaw) : null;
  if (retainFrom && Number.isNaN(retainFrom.getTime())) {
    return NextResponse.json({ error: '"retainFrom" must be a valid ISO date string when present.' }, { status: 400 });
  }

  try {
    const validRows = calls as RepCallUploadRow[];
    await prisma.$transaction(
      async (tx) => {
        if (retainFrom) {
          await tx.$executeRaw`DELETE FROM "RepCall" WHERE date < ${retainFrom}`;
        }
        if (windowStart) {
          await tx.$executeRaw`DELETE FROM "RepCall" WHERE date >= ${windowStart}`;
        }
        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
          await insertChunk(tx, validRows.slice(i, i + CHUNK_SIZE));
        }
      },
      { timeout: 30000 }
    );
    return NextResponse.json(
      { count: validRows.length, windowStart: windowStart?.toISOString() ?? null, retainFrom: retainFrom?.toISOString() ?? null },
      { status: 200 }
    );
  } catch (err) {
    console.error("Failed to replace RepCall rows", err);
    return NextResponse.json({ error: "Failed to save Timestamps data." }, { status: 500 });
  }
}
