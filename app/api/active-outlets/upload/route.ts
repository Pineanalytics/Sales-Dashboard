import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";

// Same batching rationale as /api/pl/upload: one round-trip per row would blow
// the server's execution-time limit on a multi-thousand-row sync.
const CHUNK_SIZE = 500;
// An outlet with no purchase in this many days is swept to "Inactive" during
// the full-resync finalize pass — two purchase cycles' grace against the
// "Regular - About Monthly" frequencyBand tier already in use.
const STALE_AFTER_DAYS = 60;

interface ActiveOutletEventUploadRow {
  year: string;
  principal: string;
  customerId: string;
  docId: string;
  isOrder: boolean;
  date: string;
  sales: number;
  qty: number;
  salesRole: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  pjpEmployeeCode: string | null;
  pjpRepName: string | null;
  pjpRepGroup: string | null;
  pjpRegion: string | null;
  repName: string | null;
  repGroup: string | null;
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

interface DerivedOutletRow {
  year: string;
  principal: string;
  customerId: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  pjpEmployeeCode: string | null;
  pjpRepName: string | null;
  pjpRepGroup: string | null;
  pjpRegion: string | null;
  salesRole: string;
  timesBought: number;
  purchaseDays: number;
  activeMonths: number;
  firstPurchaseDate: Date;
  lastPurchaseDate: Date;
  frequencyBand: string;
  sales: number;
  qty: number;
  mostRecentRep: string | null;
  mostRecentRepGroup: string | null;
}

function frequencyBand(purchaseCount: number, frequencyPerMonth: number): string {
  if (purchaseCount === 1) return "One-time Buyer";
  if (frequencyPerMonth < 1) return "Occasional - Less Than Monthly";
  if (frequencyPerMonth <= 1.5) return "Regular - About Monthly";
  if (frequencyPerMonth <= 3) return "Frequent - 2 to 3 Times Monthly";
  return "High Frequency - More Than 3 Times Monthly";
}

async function insertEventChunk(rows: ActiveOutletEventUploadRow[], refreshMetadata: boolean) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${r.year}, ${r.principal}, ${r.customerId}, ${r.docId}, ${r.isOrder}, ${new Date(r.date)}, ${r.sales}, ${r.qty}, ${r.salesRole}, ${r.outletName}, ${r.channel}, ${r.subChannel}, ${r.territory}, ${r.latitude}, ${r.longitude}, ${r.pjpEmployeeCode}, ${r.pjpRepName}, ${r.pjpRepGroup}, ${r.pjpRegion}, ${r.repName}, ${r.repGroup}, now())`
  );
  const conflictAction = refreshMetadata
    ? Prisma.sql`DO UPDATE SET date = EXCLUDED.date, sales = EXCLUDED.sales, qty = EXCLUDED.qty, "salesRole" = EXCLUDED."salesRole", "outletName" = EXCLUDED."outletName", channel = EXCLUDED.channel, "subChannel" = EXCLUDED."subChannel", territory = EXCLUDED.territory, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, "pjpEmployeeCode" = EXCLUDED."pjpEmployeeCode", "pjpRepName" = EXCLUDED."pjpRepName", "pjpRepGroup" = EXCLUDED."pjpRepGroup", "pjpRegion" = EXCLUDED."pjpRegion", "repName" = EXCLUDED."repName", "repGroup" = EXCLUDED."repGroup"`
    : Prisma.sql`DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO "ActiveOutletEvent" (id, year, principal, "customerId", "docId", "isOrder", date, sales, qty, "salesRole", "outletName", channel, "subChannel", territory, latitude, longitude, "pjpEmployeeCode", "pjpRepName", "pjpRepGroup", "pjpRegion", "repName", "repGroup", "createdAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, principal, "customerId", "docId", "isOrder") ${conflictAction}
  `;
}

async function upsertOutletChunk(rows: DerivedOutletRow[]) {
  const values = rows.map(
    (r) =>
      Prisma.sql`(${randomUUID()}, ${r.year}, ${r.principal}, ${r.customerId}, ${r.outletName}, ${r.channel}, ${r.subChannel}, ${r.territory}, ${r.latitude}, ${r.longitude}, ${r.pjpEmployeeCode}, ${r.pjpRepName}, ${r.pjpRepGroup}, ${r.pjpRegion}, ${r.salesRole}, ${r.timesBought}, ${r.purchaseDays}, ${r.activeMonths}, ${r.firstPurchaseDate}, ${r.lastPurchaseDate}, ${r.frequencyBand}, ${r.sales}, ${r.qty}, ${r.mostRecentRep}, ${r.mostRecentRepGroup}, now(), now())`
  );
  await prisma.$executeRaw`
    INSERT INTO "ActiveOutlet" (id, year, principal, "customerId", "outletName", channel, "subChannel", territory, latitude, longitude, "pjpEmployeeCode", "pjpRepName", "pjpRepGroup", "pjpRegion", "salesRole", "timesBought", "purchaseDays", "activeMonths", "firstPurchaseDate", "lastPurchaseDate", "frequencyBand", sales, qty, "mostRecentRep", "mostRecentRepGroup", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, principal, "customerId")
    DO UPDATE SET
      "outletName" = EXCLUDED."outletName",
      channel = EXCLUDED.channel,
      "subChannel" = EXCLUDED."subChannel",
      territory = EXCLUDED.territory,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      "pjpEmployeeCode" = EXCLUDED."pjpEmployeeCode",
      "pjpRepName" = EXCLUDED."pjpRepName",
      "pjpRepGroup" = EXCLUDED."pjpRepGroup",
      "pjpRegion" = EXCLUDED."pjpRegion",
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

interface AggRow {
  year: string;
  principal: string;
  customerId: string;
  timesBought: bigint;
  purchaseDays: bigint;
  activeMonths: bigint;
  firstPurchaseDate: Date;
  lastPurchaseDate: Date;
  sales: number;
  qty: number;
  primaryEvents: bigint;
  secondaryEvents: bigint;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  pjpEmployeeCode: string | null;
  pjpRepName: string | null;
  pjpRepGroup: string | null;
  pjpRegion: string | null;
  repName: string | null;
  repGroup: string | null;
}

/** timesBought/purchaseDays/activeMonths/sales/qty/first+lastPurchaseDate/
 *  mostRecentRep are all derived here as a SQL aggregate over
 *  ActiveOutletEvent — the ledger IS the source of truth for these fields
 *  now, not an in-memory replay of a full re-fetch (see run.ts's header
 *  comment). "recent" resolves ties on the same day by createdAt, matching
 *  the old code's own (already-arbitrary) same-day tie-breaking closely
 *  enough — not worth exact fidelity. */
async function mapAndUpsert(aggRows: AggRow[], calendarMonthsElapsed: number) {
  if (aggRows.length === 0) return;
  const months = Math.max(calendarMonthsElapsed, 1);
  const rows: DerivedOutletRow[] = aggRows.map((r) => {
    const timesBought = Number(r.timesBought);
    const frequencyPerMonth = timesBought / months;
    return {
      year: r.year,
      principal: r.principal,
      customerId: r.customerId,
      outletName: r.outletName,
      channel: r.channel,
      subChannel: r.subChannel,
      territory: r.territory,
      latitude: r.latitude,
      longitude: r.longitude,
      pjpEmployeeCode: r.pjpEmployeeCode,
      pjpRepName: r.pjpRepName,
      pjpRepGroup: r.pjpRepGroup,
      pjpRegion: r.pjpRegion,
      salesRole: Number(r.primaryEvents) >= Number(r.secondaryEvents) ? "Primary Sales" : "Secondary Sales",
      timesBought,
      purchaseDays: Number(r.purchaseDays),
      activeMonths: Number(r.activeMonths),
      firstPurchaseDate: r.firstPurchaseDate,
      lastPurchaseDate: r.lastPurchaseDate,
      frequencyBand: frequencyBand(timesBought, frequencyPerMonth),
      sales: Math.round(r.sales * 100) / 100,
      qty: r.qty,
      mostRecentRep: r.repName,
      mostRecentRepGroup: r.repGroup,
    };
  });
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await upsertOutletChunk(rows.slice(i, i + CHUNK_SIZE));
  }
}

/** Incremental path: only the (year, principal, customerId) keys this
 *  upload batch actually touched — cheap, since it's a small IN-list. */
async function deriveForTouchedKeys(keys: { year: string; principal: string; customerId: string }[], calendarMonthsElapsed: number) {
  if (keys.length === 0) return;
  const keyTuples = keys.map((k) => Prisma.sql`(${k.year}, ${k.principal}, ${k.customerId})`);
  const aggRows = await prisma.$queryRaw<AggRow[]>`
    WITH agg AS (
      SELECT year, principal, "customerId",
        COUNT(*) AS "timesBought",
        COUNT(DISTINCT date) AS "purchaseDays",
        COUNT(DISTINCT to_char(date, 'YYYY-MM')) AS "activeMonths",
        MIN(date) AS "firstPurchaseDate",
        MAX(date) AS "lastPurchaseDate",
        SUM(sales) AS sales,
        SUM(qty) AS qty,
        COUNT(*) FILTER (WHERE "salesRole" = 'Primary Sales') AS "primaryEvents",
        COUNT(*) FILTER (WHERE "salesRole" = 'Secondary Sales') AS "secondaryEvents"
      FROM "ActiveOutletEvent"
      WHERE (year, principal, "customerId") IN (${Prisma.join(keyTuples)})
      GROUP BY year, principal, "customerId"
    ),
    recent AS (
      SELECT DISTINCT ON (year, principal, "customerId")
        year, principal, "customerId", "outletName", channel, "subChannel", territory, latitude, longitude, "pjpEmployeeCode", "pjpRepName", "pjpRepGroup", "pjpRegion", "repName", "repGroup"
      FROM "ActiveOutletEvent"
      WHERE (year, principal, "customerId") IN (${Prisma.join(keyTuples)})
      ORDER BY year, principal, "customerId", date DESC, "createdAt" DESC
    )
    SELECT agg.*, recent."outletName", recent.channel, recent."subChannel", recent.territory, recent.latitude, recent.longitude, recent."pjpEmployeeCode", recent."pjpRepName", recent."pjpRepGroup", recent."pjpRegion", recent."repName", recent."repGroup"
    FROM agg JOIN recent USING (year, principal, "customerId")
  `;
  await mapAndUpsert(aggRows, calendarMonthsElapsed);
}

/** Full-resync path: every key that's ever appeared in the ledger for this
 *  year, not just ones touched this run — self-healing (catches corrections,
 *  and outlets with zero new events this cycle still get re-verified). A
 *  plain WHERE year = $1 scan is far cheaper than building a 70K+-tuple
 *  IN-list, which is why this is a separate query from the incremental path
 *  rather than just calling deriveForTouchedKeys with every key. */
async function deriveForFullYear(year: string, calendarMonthsElapsed: number) {
  const aggRows = await prisma.$queryRaw<AggRow[]>`
    WITH agg AS (
      SELECT year, principal, "customerId",
        COUNT(*) AS "timesBought",
        COUNT(DISTINCT date) AS "purchaseDays",
        COUNT(DISTINCT to_char(date, 'YYYY-MM')) AS "activeMonths",
        MIN(date) AS "firstPurchaseDate",
        MAX(date) AS "lastPurchaseDate",
        SUM(sales) AS sales,
        SUM(qty) AS qty,
        COUNT(*) FILTER (WHERE "salesRole" = 'Primary Sales') AS "primaryEvents",
        COUNT(*) FILTER (WHERE "salesRole" = 'Secondary Sales') AS "secondaryEvents"
      FROM "ActiveOutletEvent"
      WHERE year = ${year}
      GROUP BY year, principal, "customerId"
    ),
    recent AS (
      SELECT DISTINCT ON (year, principal, "customerId")
        year, principal, "customerId", "outletName", channel, "subChannel", territory, latitude, longitude, "pjpEmployeeCode", "pjpRepName", "pjpRepGroup", "pjpRegion", "repName", "repGroup"
      FROM "ActiveOutletEvent"
      WHERE year = ${year}
      ORDER BY year, principal, "customerId", date DESC, "createdAt" DESC
    )
    SELECT agg.*, recent."outletName", recent.channel, recent."subChannel", recent.territory, recent.latitude, recent.longitude, recent."pjpEmployeeCode", recent."pjpRepName", recent."pjpRepGroup", recent."pjpRegion", recent."repName", recent."repGroup"
    FROM agg JOIN recent USING (year, principal, "customerId")
  `;
  await mapAndUpsert(aggRows, calendarMonthsElapsed);

  await prisma.$executeRaw`DELETE FROM "ActiveOutletMonthly" WHERE year = ${year}`;
  const monthlyRows = await prisma.$queryRaw<{
    year: string;
    month: string;
    monthIndex: number;
    principal: string;
    salesRole: string;
    distinctOutlets: bigint;
    transactions: bigint;
    sales: number;
  }[]>`
    SELECT
      year,
      to_char(date, 'FMMonth') AS month,
      EXTRACT(MONTH FROM date)::int - 1 AS "monthIndex",
      principal,
      "salesRole",
      COUNT(DISTINCT "customerId") AS "distinctOutlets",
      COUNT(*) AS transactions,
      SUM(sales) AS sales
    FROM "ActiveOutletEvent"
    WHERE year = ${year}
    GROUP BY year, EXTRACT(MONTH FROM date), principal, "salesRole"
  `;
  for (let i = 0; i < monthlyRows.length; i += CHUNK_SIZE) {
    await upsertMonthlyChunk(
      monthlyRows.slice(i, i + CHUNK_SIZE).map((row) => ({
        ...row,
        distinctOutlets: Number(row.distinctOutlets),
        transactions: Number(row.transactions),
        sales: Number(row.sales),
      }))
    );
  }

  await prisma.$executeRaw`
    UPDATE "ActiveOutlet"
    SET status = CASE WHEN "lastPurchaseDate" < now() - (${STALE_AFTER_DAYS}::text || ' days')::interval THEN 'Inactive' ELSE 'Active' END
    WHERE year = ${year}
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

function isValidEventRow(row: unknown): row is ActiveOutletEventUploadRow {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.year === "string" &&
    typeof r.principal === "string" &&
    typeof r.customerId === "string" &&
    typeof r.docId === "string" &&
    typeof r.isOrder === "boolean" &&
    typeof r.date === "string" &&
    typeof r.sales === "number" &&
    typeof r.qty === "number" &&
    typeof r.salesRole === "string" &&
    typeof r.outletName === "string" &&
    typeof r.channel === "string" &&
    typeof r.subChannel === "string" &&
    typeof r.territory === "string" &&
    (r.latitude === null || typeof r.latitude === "number") &&
    (r.longitude === null || typeof r.longitude === "number") &&
    (r.pjpEmployeeCode === null || typeof r.pjpEmployeeCode === "string") &&
    (r.pjpRepName === null || typeof r.pjpRepName === "string") &&
    (r.pjpRepGroup === null || typeof r.pjpRepGroup === "string") &&
    (r.pjpRegion === null || typeof r.pjpRegion === "string") &&
    (r.repName === null || typeof r.repName === "string") &&
    (r.repGroup === null || typeof r.repGroup === "string")
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
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (b.finalizeFullResync === true) {
    if (typeof b.year !== "string" || typeof b.calendarMonthsElapsed !== "number") {
      return NextResponse.json({ error: '"year" and "calendarMonthsElapsed" are required for finalizeFullResync.' }, { status: 400 });
    }
    try {
      await deriveForFullYear(b.year, b.calendarMonthsElapsed);
      return NextResponse.json({ finalized: true }, { status: 200 });
    } catch (err) {
      console.error("Failed to finalize Active Outlets full resync", err);
      return NextResponse.json({ error: "Failed to finalize full resync." }, { status: 500 });
    }
  }

  const events = b.events;
  const monthly = b.monthly ?? [];
  if (!Array.isArray(events) || !Array.isArray(monthly)) {
    return NextResponse.json({ error: '"events" and "monthly" must both be arrays.' }, { status: 400 });
  }
  if (!events.every(isValidEventRow)) {
    return NextResponse.json({ error: "One or more event rows are missing required fields." }, { status: 400 });
  }
  if (!monthly.every(isValidMonthlyRow)) {
    return NextResponse.json({ error: "One or more monthly rows are missing required fields." }, { status: 400 });
  }
  if (typeof b.year !== "string" || typeof b.calendarMonthsElapsed !== "number") {
    return NextResponse.json({ error: '"year" and "calendarMonthsElapsed" are required.' }, { status: 400 });
  }
  const year = b.year;
  const calendarMonthsElapsed = b.calendarMonthsElapsed;
  // A full resync can contain hundreds of transport batches. Its endpoint has
  // a dedicated finalize pass that derives every outlet exactly once after all
  // idempotent ledger inserts land; deriving the touched set after every
  // upload batch repeats the same expensive aggregation hundreds of times.
  const deferDerivation = b.deferDerivation === true;
  const refreshMetadata = b.refreshMetadata === true;

  try {
    const touchedKeys = new Map<string, { year: string; principal: string; customerId: string }>();
    for (let i = 0; i < events.length; i += CHUNK_SIZE) {
      const chunk = events.slice(i, i + CHUNK_SIZE);
      await insertEventChunk(chunk, refreshMetadata);
      for (const r of chunk) {
        touchedKeys.set(`${r.year}|${r.principal}|${r.customerId}`, { year: r.year, principal: r.principal, customerId: r.customerId });
      }
    }
    if (!deferDerivation) {
      await deriveForTouchedKeys(Array.from(touchedKeys.values()), calendarMonthsElapsed);
    }

    for (let i = 0; i < monthly.length; i += CHUNK_SIZE) {
      await upsertMonthlyChunk(monthly.slice(i, i + CHUNK_SIZE));
    }
    return NextResponse.json({ eventCount: events.length, outletsTouched: touchedKeys.size, monthlyCount: monthly.length, deferredDerivation: deferDerivation }, { status: 200 });
  } catch (err) {
    console.error("Failed to upsert Active Outlets rows", err);
    return NextResponse.json({ error: "Failed to save Active Outlets data." }, { status: 500 });
  }
}
