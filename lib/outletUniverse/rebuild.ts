import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";
import { cleanTerritory, locationFromPrincipal, normalizeChannel, normalizeSegment, orUnspecified, type OutletSource } from "./normalize";

export interface OutletUniverseRow {
  source: OutletSource;
  outletKey: string;
  principal: string;
  outletName: string;
  channel: string;
  segment: string;
  rawChannel: string | null;
  rawSegment: string | null;
  location: string;
  region: string;
  territory: string;
  route: string | null;
  repCode: string | null;
  repName: string | null;
  latitude: number | null;
  longitude: number | null;
  lastPurchaseDate: Date | null;
  sales: number;
  transactions: number;
}

export interface OutletUniverseRebuildResult {
  pine: number;
  leverage: number;
  eabl: number;
  total: number;
  durationMs: number;
}

const INSERT_CHUNK = 2000;
// Credit-note and invoice document types in the Centegy DMS feed (01 = invoice,
// 18/19 = credit notes). Only invoices count as a purchase.
const LEVERAGE_INVOICE_TYPES = ["01", "06"];

/** A coordinate of exactly 0 or outside the valid range is a missing GPS fix, not a place. */
function validCoordinate(value: number | null, limit: number): number | null {
  return value !== null && Number.isFinite(value) && value !== 0 && Math.abs(value) <= limit ? value : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

interface PineSourceRow {
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
  pjpRegion: string | null;
  mostRecentRep: string | null;
  lastPurchaseDate: Date;
  sales: number;
  timesBought: number;
}

export function pineRow(row: PineSourceRow): OutletUniverseRow {
  return {
    source: "PINE",
    outletKey: row.customerId,
    principal: row.principal,
    outletName: row.outletName,
    channel: normalizeChannel(row.channel),
    segment: normalizeSegment(row.subChannel),
    rawChannel: nonEmpty(row.channel),
    rawSegment: nonEmpty(row.subChannel),
    location: locationFromPrincipal(row.principal),
    region: orUnspecified(row.pjpRegion),
    territory: orUnspecified(row.territory),
    // The Pine outlet sync does not carry a route; territory is its finest grain.
    route: null,
    repCode: nonEmpty(row.pjpEmployeeCode),
    repName: nonEmpty(row.pjpRepName) ?? nonEmpty(row.mostRecentRep),
    latitude: validCoordinate(row.latitude, 90),
    longitude: validCoordinate(row.longitude, 180),
    lastPurchaseDate: row.lastPurchaseDate,
    sales: row.sales,
    transactions: row.timesBought,
  };
}

interface LeverageSourceRow {
  customerCode: string;
  storageLocation: string;
  lastBuy: Date | null;
  sales: number;
  transactions: number;
  salesRepCode: string | null;
  salesRepName: string | null;
  /** PJP code from the invoice line, e.g. "NY03". (The feed's own "routeName"
   *  column holds the outlet's name, so it is never used as a route.) */
  route: string | null;
  /** The PJP's description from the journey-plan roster, e.g. "NY_VAN_A2_OB". */
  routeDesc: string | null;
  outletName: string | null;
  channel: string | null;
}

/** Centegy names a sales unit "<van or bike>_<distributor id>"; the id suffix only repeats the branch. */
export function cleanLeverageUnit(name: string | null): string | null {
  const text = nonEmpty(name);
  return text ? text.replace(/_\d{6,}$/, "") : null;
}

export function leverageRow(row: LeverageSourceRow): OutletUniverseRow {
  const branch = SALES_RETURNS_BRANCH_LABELS[row.storageLocation] ?? row.storageLocation;
  const code = nonEmpty(row.route);
  const desc = nonEmpty(row.routeDesc);
  const route = desc && code ? `${desc} (${code})` : (desc ?? code);
  return {
    source: "LEVERAGE",
    outletKey: row.customerCode,
    principal: `Unilever-${branch}`,
    outletName: nonEmpty(row.outletName) ?? row.customerCode,
    channel: normalizeChannel(row.channel),
    segment: normalizeSegment(row.channel),
    rawChannel: nonEmpty(row.channel),
    rawSegment: null,
    location: branch,
    // The Centegy feed has no area above the route: the branch is both the
    // region and the territory. The "rep" is the van / bike sales unit.
    region: branch,
    territory: branch,
    route,
    repCode: nonEmpty(row.salesRepCode),
    repName: cleanLeverageUnit(row.salesRepName),
    latitude: null,
    longitude: null,
    lastPurchaseDate: row.lastBuy,
    sales: row.sales,
    transactions: row.transactions,
  };
}

interface EablSourceRow {
  customerId: string;
  principal: string;
  outletName: string;
  channel: string | null;
  subChannel: string | null;
  territory: string | null;
  route: string | null;
  latitude: number | null;
  longitude: number | null;
  lastBuy: Date | null;
  sales: number | null;
  transactions: number | null;
  salesman: string | null;
  segment: string | null;
}

export function eablRow(row: EablSourceRow): OutletUniverseRow {
  const territory = cleanTerritory(row.territory);
  return {
    source: "EABL",
    outletKey: row.customerId,
    principal: row.principal,
    outletName: row.outletName,
    channel: normalizeChannel(row.channel),
    segment: normalizeSegment(row.subChannel, row.segment),
    rawChannel: nonEmpty(row.channel),
    rawSegment: nonEmpty(row.segment) ?? nonEmpty(row.subChannel),
    location: locationFromPrincipal(row.principal),
    region: locationFromPrincipal(row.principal),
    territory,
    route: nonEmpty(row.route),
    repCode: null,
    repName: nonEmpty(row.salesman),
    latitude: validCoordinate(row.latitude, 90),
    longitude: validCoordinate(row.longitude, 180),
    lastPurchaseDate: row.lastBuy,
    sales: row.sales ?? 0,
    transactions: row.transactions ?? 0,
  };
}

async function loadPine(): Promise<OutletUniverseRow[]> {
  const rows = await prisma.$queryRaw<PineSourceRow[]>(Prisma.sql`
    SELECT principal, "customerId", "outletName", channel, "subChannel", territory, latitude, longitude,
           "pjpEmployeeCode", "pjpRepName", "pjpRegion", "mostRecentRep", "lastPurchaseDate",
           sales::double precision AS sales, "timesBought"
    FROM "ActiveOutlet"
    WHERE year = (SELECT MAX(year) FROM "ActiveOutlet")
  `);
  return rows.map(pineRow);
}

async function loadLeverage(): Promise<OutletUniverseRow[]> {
  const rows = await prisma.$queryRaw<LeverageSourceRow[]>(Prisma.sql`
    WITH docs AS (
      SELECT "customerCode", "storageLocation", "deliveryDate", "documentType", "netSale", "invoiceNo",
             "salesRepCode", "salesRepName", route
      FROM "SalesReturnLine"
      WHERE EXTRACT(YEAR FROM "deliveryDate") = EXTRACT(YEAR FROM now())
    ),
    agg AS (
      SELECT "customerCode", "storageLocation",
             MAX("deliveryDate") FILTER (WHERE "documentType" IN (${Prisma.join(LEVERAGE_INVOICE_TYPES)})) AS "lastBuy",
             SUM("netSale")::double precision AS sales,
             COUNT(DISTINCT "invoiceNo") FILTER (WHERE "documentType" IN (${Prisma.join(LEVERAGE_INVOICE_TYPES)}))::int AS transactions
      FROM docs GROUP BY "customerCode", "storageLocation"
    ),
    latest AS (
      SELECT DISTINCT ON ("customerCode", "storageLocation")
             "customerCode", "storageLocation", "salesRepCode", "salesRepName", route
      FROM docs
      WHERE "documentType" IN (${Prisma.join(LEVERAGE_INVOICE_TYPES)})
      ORDER BY "customerCode", "storageLocation", "deliveryDate" DESC, "invoiceNo" DESC
    ),
    names AS (
      SELECT DISTINCT ON ("outletCode", distributor) "outletCode", distributor, "outletName", channel
      FROM "OutletSkuDailySales"
      ORDER BY "outletCode", distributor, date DESC
    ),
    plan AS (
      SELECT DISTINCT ON (distributor, pjp) distributor, pjp, "routeDesc"
      FROM "JourneyPlanAssignment"
      ORDER BY distributor, pjp, "routeDesc"
    )
    SELECT a."customerCode", a."storageLocation", a."lastBuy", a.sales, a.transactions,
           l."salesRepCode", l."salesRepName", l.route, p."routeDesc",
           n."outletName", n.channel
    FROM agg a
    LEFT JOIN latest l USING ("customerCode", "storageLocation")
    LEFT JOIN plan p ON p.distributor = a."storageLocation" AND p.pjp = l.route
    LEFT JOIN names n ON n."outletCode" = a."customerCode" AND n.distributor = a."storageLocation"
  `);
  return rows.map(leverageRow);
}

async function loadEabl(): Promise<OutletUniverseRow[]> {
  const rows = await prisma.$queryRaw<EablSourceRow[]>(Prisma.sql`
    WITH calls AS (
      SELECT "customerCode",
             MAX("callDate") FILTER (WHERE "isProductive") AS "lastBuy",
             SUM("netSales")::double precision AS sales,
             COUNT(*) FILTER (WHERE "isProductive")::int AS transactions
      FROM "EablCall"
      WHERE "customerCode" IS NOT NULL AND EXTRACT(YEAR FROM "callDate") = EXTRACT(YEAR FROM now())
      GROUP BY "customerCode"
    ),
    latest AS (
      SELECT DISTINCT ON ("customerCode") "customerCode", salesman, segment
      FROM "EablCall"
      WHERE "customerCode" IS NOT NULL
      ORDER BY "customerCode", "callDate" DESC, "timeIn" DESC NULLS LAST
    )
    SELECT m."customerId", m.principal, m."outletName", m.channel, m."subChannel", m.territory, m.route,
           m.latitude, m.longitude, c."lastBuy", c.sales, c.transactions, l.salesman, l.segment
    FROM "EablCustomerMaster" m
    LEFT JOIN calls c ON c."customerCode" = m."customerId"
    LEFT JOIN latest l ON l."customerCode" = m."customerId"
  `);
  return rows.map(eablRow);
}

// A rebuild is one transaction over ~85k rows. Only one runs per app instance at a
// time; a second request joins the one already in flight instead of queueing a copy.
let inFlight: Promise<OutletUniverseRebuildResult> | null = null;

export function rebuildOutletUniverse(): Promise<OutletUniverseRebuildResult> {
  if (!inFlight) inFlight = runRebuild().finally(() => (inFlight = null));
  return inFlight;
}

export function isOutletUniverseRebuilding(): boolean {
  return inFlight !== null;
}

/** Starts a background rebuild when the universe is empty or older than
 *  `maxAgeMs`, and returns immediately: the reader is served the current data
 *  while the new copy is compiled. Failures are logged, never thrown. */
export async function refreshOutletUniverseIfStale(maxAgeMs: number): Promise<void> {
  if (inFlight) return;
  const [latest] = await prisma.$queryRaw<{ builtAt: Date | null }[]>(Prisma.sql`SELECT MAX("builtAt") AS "builtAt" FROM "OutletUniverse"`);
  if (latest?.builtAt && Date.now() - latest.builtAt.getTime() < maxAgeMs) return;
  rebuildOutletUniverse().catch((error) => console.error("Background Active Outlet universe rebuild failed", error));
}

/** Replaces the whole OutletUniverse table from the three source tables inside
 *  one transaction, so readers see either the old or the new universe, never a
 *  half-built one. Safe to run repeatedly; the table is a derived copy. */
async function runRebuild(): Promise<OutletUniverseRebuildResult> {
  const startedAt = Date.now();
  const [pine, leverage, eabl] = await Promise.all([loadPine(), loadLeverage(), loadEabl()]);
  const builtAt = new Date();
  const all = [...pine, ...leverage, ...eabl];

  await prisma.$transaction(
    async (tx) => {
      await tx.outletUniverse.deleteMany({});
      for (let index = 0; index < all.length; index += INSERT_CHUNK) {
        await tx.outletUniverse.createMany({
          data: all.slice(index, index + INSERT_CHUNK).map((row) => ({ ...row, builtAt })),
          skipDuplicates: true,
        });
      }
    },
    { timeout: 180_000, maxWait: 30_000 }
  );

  return { pine: pine.length, leverage: leverage.length, eabl: eabl.length, total: all.length, durationMs: Date.now() - startedAt };
}
