import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";
import { matchOutlets, type MatchInput } from "./matching";
import { buildRepDirectory } from "./repIdentity";
import { withCleanup } from "./cleanup";
import {
  cleanTerritory,
  exclusionReason,
  kenyaCoordinate,
  locationFromPrincipal,
  OUTLET_SOURCE_LABELS,
  normalizeChannel,
  normalizeSalesRole,
  normalizeSegment,
  orUnspecified,
  type OutletSalesRole,
  type OutletSource,
} from "./normalize";

export interface OutletUniverseRow {
  source: OutletSource;
  outletKey: string;
  principal: string;
  outletName: string;
  salesRole: OutletSalesRole;
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
  /** Pine's journey-plan owner of the outlet (the same on every principal row); null for the other sources. repName is the rep who sells this principal. */
  plannedRep: string | null;
  /** Set for an outlet matched with the same shop in another system: shared match id, confidence and the systems it appears in. */
  /** The rep's Team Leader from the roster, where the rep is on it. */
  teamLeader?: string | null;
  repStatus?: string | null;
  repRegion?: string | null;
  repSubRegion?: string | null;
  matchId?: string | null;
  matchConfidence?: string | null;
  matchedSystems?: string | null;
  /** The universe cleanup (cleanup.ts): the unified territory and the shop this outlet belongs to. Set when the universe is compiled. */
  territoryClean?: string | null;
  shopId?: string | null;
  shopSize?: number | null;
  shopConfidence?: string | null;
  latitude: number | null;
  longitude: number | null;
  lastPurchaseDate: Date | null;
  sales: number;
  transactions: number;
  /** Distinct days with a purchase in the last 30 days: this principal, then all of the outlet's principals in the source. */
  purchaseDays30: number;
  outletPurchaseDays30: number;
  /** Earliest purchase on record for the outlet (any principal), and how many of its last three 30-day periods saw a purchase. */
  firstPurchaseDate: Date | null;
  periodsBought90: number;
  periodsBought180: number;
}

export interface OutletUniverseRebuildResult {
  pine: number;
  leverage: number;
  eabl: number;
  upfield: number;
  total: number;
  /** Rows kept out by OUTLET_EXCLUSIONS, by reason. Not included in the counts above. */
  excluded: Record<string, number>;
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
  salesRole: string;
  mostRecentRep: string | null;
  lastPurchaseDate: Date;
  sales: number;
  timesBought: number;
  purchaseDays30?: number;
  outletPurchaseDays30?: number;
  firstPurchaseDate?: Date | null;
  periodsBought90?: number;
  periodsBought180?: number;
}

/** Who has sold a principal at an outlet this year, by the role of each sale: whether any Primary sale exists, and the rep of the latest
 *  Primary and of the latest Secondary sale. Each sale's role comes from its rep's user group (DSR, KAMS, TDR and ADMIN Primary; MBSR
 *  Secondary; a TDR selling Mars and the two exception DSR codes Secondary). */
export interface SaleRoles {
  hasPrimary: boolean;
  primaryRep: string | null;
  secondaryRep: string | null;
}

const MARS_PRINCIPAL = /^mars/i;

/** Mars: an outlet any Primary rep (DSR, KAMS, ADMIN) sold to is a Primary outlet, even when MBSR or TDR reps also sold to it, with the
 *  Primary rep as its rep; only an outlet with no Primary sale is Secondary. Pine stores the role with more sale events, so a wholesaler
 *  a van DSR serves and an MBSR or TDR rep visits more often came out Secondary. Other principals keep the stored role. */
export function withMarsPrimaryRule(row: PineSourceRow, sales: SaleRoles | undefined): PineSourceRow {
  if (!sales || !MARS_PRINCIPAL.test(row.principal)) return row;
  if (sales.hasPrimary) return { ...row, salesRole: "Primary Sales", mostRecentRep: sales.primaryRep ?? row.mostRecentRep };
  return { ...row, salesRole: "Secondary Sales", mostRecentRep: sales.secondaryRep ?? row.mostRecentRep };
}

/** The rep of the principal's latest sale at the outlet, falling back to the journey-plan owner when no sale carries a rep. */
function sellingRep(row: PineSourceRow): string | null {
  return nonEmpty(row.mostRecentRep) ?? nonEmpty(row.pjpRepName);
}

export function pineRow(row: PineSourceRow): OutletUniverseRow {
  return {
    source: "PINE",
    outletKey: row.customerId,
    principal: row.principal,
    outletName: row.outletName,
    salesRole: normalizeSalesRole(row.salesRole),
    channel: normalizeChannel(row.channel),
    segment: normalizeSegment(row.subChannel),
    rawChannel: nonEmpty(row.channel),
    rawSegment: nonEmpty(row.subChannel),
    location: locationFromPrincipal(row.principal),
    region: orUnspecified(row.pjpRegion),
    territory: orUnspecified(row.territory),
    // The Pine outlet sync does not carry a route; territory is its finest grain.
    route: null,
    // The rep is whoever sells this principal at the outlet (the rep of its latest sale), not the outlet's journey-plan owner, who is the
    // same on every principal row and was showing a Mars rep against Suntory, Weetabix and the rest. The owner's code only goes with the owner.
    repCode: sellingRep(row) === nonEmpty(row.pjpRepName) ? nonEmpty(row.pjpEmployeeCode) : null,
    repName: sellingRep(row),
    plannedRep: nonEmpty(row.pjpRepName),
    latitude: validCoordinate(row.latitude, 90),
    longitude: validCoordinate(row.longitude, 180),
    lastPurchaseDate: row.lastPurchaseDate,
    sales: row.sales,
    transactions: row.timesBought,
    purchaseDays30: row.purchaseDays30 ?? 0,
    outletPurchaseDays30: row.outletPurchaseDays30 ?? 0,
    firstPurchaseDate: row.firstPurchaseDate ?? null,
    periodsBought90: row.periodsBought90 ?? 0,
    periodsBought180: row.periodsBought180 ?? 0,
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
  /** From the journey-plan roster (Centegy GeoCodeY / GeoCodeX), when the branch carries them. */
  latitude: number | null;
  longitude: number | null;
  /** Distinct invoice days in the last 30 days. */
  days30?: number | null;
  firstBuy?: Date | null;
  periods90?: number | null;
  periods180?: number | null;
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
  const gps = kenyaCoordinate(row.latitude, row.longitude);
  return {
    source: "LEVERAGE",
    outletKey: row.customerCode,
    principal: `Unilever-${branch}`,
    outletName: nonEmpty(row.outletName) ?? row.customerCode,
    salesRole: "Primary Sales",
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
    plannedRep: null,
    latitude: gps?.latitude ?? null,
    longitude: gps?.longitude ?? null,
    lastPurchaseDate: row.lastBuy,
    sales: row.sales,
    transactions: row.transactions,
    purchaseDays30: row.days30 ?? 0,
    outletPurchaseDays30: row.days30 ?? 0,
    firstPurchaseDate: row.firstBuy ?? null,
    periodsBought90: row.periods90 ?? 0,
    periodsBought180: row.periods180 ?? 0,
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
  /** Distinct days with a productive call in the last 30 days. */
  days30?: number | null;
  firstBuy?: Date | null;
  periods90?: number | null;
  periods180?: number | null;
}

export function eablRow(row: EablSourceRow): OutletUniverseRow {
  const territory = cleanTerritory(row.territory);
  return {
    source: "EABL",
    outletKey: row.customerId,
    principal: row.principal,
    outletName: row.outletName,
    salesRole: "Primary Sales",
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
    plannedRep: null,
    latitude: validCoordinate(row.latitude, 90),
    longitude: validCoordinate(row.longitude, 180),
    lastPurchaseDate: row.lastBuy,
    sales: row.sales ?? 0,
    transactions: row.transactions ?? 0,
    purchaseDays30: row.days30 ?? 0,
    outletPurchaseDays30: row.days30 ?? 0,
    firstPurchaseDate: row.firstBuy ?? null,
    periodsBought90: row.periods90 ?? 0,
    periodsBought180: row.periods180 ?? 0,
  };
}

interface UpfieldSourceRow {
  customerCode: string;
  customerName: string | null;
  fsr: string | null;
  /** From Upfield's outlet list (the customer master), when the outlet is on it. */
  outletType?: string | null;
  channel?: string | null;
  location?: string | null;
  routeDay?: string | null;
  routeWeek?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lastBuy?: Date | null;
  sales?: number | null;
  transactions?: number | null;
  /** Distinct sale days in the last 30 days. */
  days30?: number | null;
  firstBuy?: Date | null;
  periods90?: number | null;
  periods180?: number | null;
}

/** An Upfield outlet: one per customer code, bought directly by Upfield's own field sales reps, so it is tagged Primary like Leverage
 *  and EABL DMS. The sales feed (UpfieldTransaction) has no channel, area or route; Upfield's outlet list (the customer master) supplies the
 *  channel, outlet type, route (the FSR, day and week), area and GPS point, and every outlet on it is known, whether or not it has bought. */
/** "Brian Mwaura" + "monday" -> "Brian Mwaura - Monday"; a route run on several days is "Brian Mwaura - Several days". */
function upfieldRoute(fsr: string | null | undefined, routeDay: string | null | undefined): string | null {
  const rep = nonEmpty(fsr);
  const day = nonEmpty(routeDay);
  if (!rep) return null;
  if (!day) return rep;
  return `${rep} - ${day.includes(";") ? "Several days" : day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()}`;
}

export function upfieldRow(row: UpfieldSourceRow): OutletUniverseRow {
  return {
    source: "UPFIELD",
    outletKey: row.customerCode,
    principal: "Upfield-Nairobi",
    outletName: nonEmpty(row.customerName) ?? row.customerCode,
    salesRole: "Primary Sales",
    channel: normalizeChannel(row.channel),
    segment: normalizeSegment(row.outletType),
    rawChannel: nonEmpty(row.channel),
    rawSegment: nonEmpty(row.outletType),
    location: "Nairobi",
    region: "Nairobi",
    // The list's Location is the outlet's area (Kayole, Dandora, Tala...), the closest thing to a territory.
    territory: orUnspecified(row.location ? row.location.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null),
    route: upfieldRoute(row.fsr, row.routeDay),
    repCode: null,
    repName: nonEmpty(row.fsr),
    plannedRep: null,
    latitude: kenyaCoordinate(row.latitude ?? null, row.longitude ?? null)?.latitude ?? null,
    longitude: kenyaCoordinate(row.latitude ?? null, row.longitude ?? null)?.longitude ?? null,
    lastPurchaseDate: row.lastBuy ?? null,
    sales: row.sales ?? 0,
    transactions: row.transactions ?? 0,
    purchaseDays30: row.days30 ?? 0,
    outletPurchaseDays30: row.days30 ?? 0,
    firstPurchaseDate: row.firstBuy ?? null,
    periodsBought90: row.periods90 ?? 0,
    periodsBought180: row.periods180 ?? 0,
  };
}

async function loadUpfield(): Promise<OutletUniverseRow[]> {
  // The outlet list (customer master) is the universe: every outlet on it is known. Customers that bought but are not on it are kept too
  // (without channel or type). The DataEdge connectivity-test customer is not an outlet. With no list uploaded this is the sales feed alone.
  const rows = await prisma.$queryRaw<UpfieldSourceRow[]>(Prisma.sql`
    WITH agg AS (
      SELECT "custCode" AS "customerCode",
             MAX("txnDate") FILTER (WHERE type = 'sale') AS "lastBuy",
             MIN("txnDate") FILTER (WHERE type = 'sale') AS "firstBuy",
             SUM("saleExcl") FILTER (WHERE EXTRACT(YEAR FROM "txnDate") = EXTRACT(YEAR FROM now()))::double precision AS sales,
             COUNT(DISTINCT "invoiceNo") FILTER (WHERE type = 'sale' AND EXTRACT(YEAR FROM "txnDate") = EXTRACT(YEAR FROM now()))::int AS transactions,
             COUNT(DISTINCT "txnDate"::date) FILTER (WHERE type = 'sale' AND "txnDate" >= now() - interval '30 days')::int AS days30,
             COUNT(DISTINCT ((now()::date - "txnDate"::date) / 30)) FILTER (WHERE type = 'sale' AND now()::date - "txnDate"::date < 90)::int AS periods90,
             COUNT(DISTINCT ((now()::date - "txnDate"::date) / 30)) FILTER (WHERE type = 'sale' AND now()::date - "txnDate"::date < 180)::int AS periods180
      FROM "UpfieldTransaction"
      WHERE "custCode" IS NOT NULL AND btrim("custCode") <> '' AND "custCode" <> '000' AND UPPER(COALESCE("custName", '')) NOT LIKE '%CONNECTIVITY TEST%'
      GROUP BY "custCode"
    ),
    latest AS (
      SELECT DISTINCT ON ("custCode") "custCode" AS "customerCode", "custName" AS "customerName", REGEXP_REPLACE(BTRIM(fsr), '\\s+', ' ', 'g') AS fsr
      FROM "UpfieldTransaction"
      WHERE "custCode" IS NOT NULL AND btrim("custCode") <> '' AND "custCode" <> '000'
      ORDER BY "custCode", "txnDate" DESC, "sourceRecordId" DESC
    )
    SELECT COALESCE(m."outletCode", a."customerCode") AS "customerCode",
           COALESCE(m."outletName", l."customerName") AS "customerName",
           COALESCE(m."fsrName", l.fsr) AS fsr,
           m."outletType", m.channel, m.location, m."routeDay", m."routeWeek", m.latitude, m.longitude,
           a."lastBuy", a."firstBuy", a.sales, a.transactions, a.days30, a.periods90, a.periods180
    FROM "UpfieldOutletMaster" m
    FULL OUTER JOIN agg a ON a."customerCode" = m."outletCode"
    LEFT JOIN latest l ON l."customerCode" = COALESCE(m."outletCode", a."customerCode")
    WHERE COALESCE(m."outletCode", a."customerCode") <> '000'
  `);
  return rows.map(upfieldRow);
}

async function loadPine(): Promise<OutletUniverseRow[]> {
  const rows = await prisma.$queryRaw<PineSourceRow[]>(Prisma.sql`
    SELECT principal, "customerId", "outletName", channel, "subChannel", territory, latitude, longitude,
           "pjpEmployeeCode", "pjpRepName", "pjpRegion", "salesRole", "mostRecentRep", "lastPurchaseDate",
           sales::double precision AS sales, "timesBought"
    FROM "ActiveOutlet"
    WHERE year = (SELECT MAX(year) FROM "ActiveOutlet")
  `);
  // Purchase days over the last 30 days from the append-only event ledger: one
  // count per principal, one per outlet across all of its principals.
  const [perPrincipal, perOutlet, history, marsSales] = await Promise.all([
    prisma.$queryRaw<{ principal: string; customerId: string; days: number }[]>(Prisma.sql`
      SELECT principal, "customerId", COUNT(DISTINCT date::date)::int AS days
      FROM "ActiveOutletEvent" WHERE date >= now() - interval '30 days'
      GROUP BY principal, "customerId"
    `),
    prisma.$queryRaw<{ customerId: string; days: number }[]>(Prisma.sql`
      SELECT "customerId", COUNT(DISTINCT date::date)::int AS days
      FROM "ActiveOutletEvent" WHERE date >= now() - interval '30 days'
      GROUP BY "customerId"
    `),
    // First purchase on record and how many of the last three 30-day periods saw a purchase, across all principals.
    prisma.$queryRaw<{ customerId: string; firstBuy: Date | null; periods90: number; periods180: number }[]>(Prisma.sql`
      SELECT "customerId", MIN(date)::date AS "firstBuy",
             COUNT(DISTINCT ((now()::date - date::date) / 30)) FILTER (WHERE now()::date - date::date < 90)::int AS periods90,
             COUNT(DISTINCT ((now()::date - date::date) / 30)) FILTER (WHERE now()::date - date::date < 180)::int AS periods180
      FROM "ActiveOutletEvent" GROUP BY "customerId"
    `),
    // Mars sales this year by role, per outlet: any Primary sale, and the rep of the latest Primary and Secondary sale.
    prisma.$queryRaw<{ principal: string; customerId: string; hasPrimary: boolean; primaryRep: string | null; secondaryRep: string | null }[]>(Prisma.sql`
      SELECT principal, "customerId",
             BOOL_OR("salesRole" = 'Primary Sales') AS "hasPrimary",
             (ARRAY_AGG("repName" ORDER BY date DESC, "createdAt" DESC) FILTER (WHERE "salesRole" = 'Primary Sales' AND "repName" IS NOT NULL))[1] AS "primaryRep",
             (ARRAY_AGG("repName" ORDER BY date DESC, "createdAt" DESC) FILTER (WHERE "salesRole" = 'Secondary Sales' AND "repName" IS NOT NULL))[1] AS "secondaryRep"
      FROM "ActiveOutletEvent"
      WHERE year = (SELECT MAX(year) FROM "ActiveOutlet") AND principal ~* '^mars'
      GROUP BY principal, "customerId"
    `),
  ]);
  const saleRoles = new Map(
    marsSales.map((r) => [`${r.principal}|${r.customerId}`, { hasPrimary: r.hasPrimary, primaryRep: r.primaryRep?.trim() || null, secondaryRep: r.secondaryRep?.trim() || null }])
  );
  const outletHistory = new Map(history.map((r) => [r.customerId, r]));
  const principalDays = new Map(perPrincipal.map((r) => [`${r.principal}|${r.customerId}`, Number(r.days)]));
  const outletDays = new Map(perOutlet.map((r) => [r.customerId, Number(r.days)]));
  return rows.map((row) =>
    pineRow({
      ...withMarsPrimaryRule(row, saleRoles.get(`${row.principal}|${row.customerId}`)),
      purchaseDays30: principalDays.get(`${row.principal}|${row.customerId}`) ?? 0,
      outletPurchaseDays30: outletDays.get(row.customerId) ?? 0,
      firstPurchaseDate: outletHistory.get(row.customerId)?.firstBuy ?? null,
      periodsBought90: Number(outletHistory.get(row.customerId)?.periods90 ?? 0),
      periodsBought180: Number(outletHistory.get(row.customerId)?.periods180 ?? 0),
    })
  );
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
             COUNT(DISTINCT "invoiceNo") FILTER (WHERE "documentType" IN (${Prisma.join(LEVERAGE_INVOICE_TYPES)}))::int AS transactions,
             COUNT(DISTINCT "deliveryDate"::date) FILTER (WHERE "documentType" IN (${Prisma.join(LEVERAGE_INVOICE_TYPES)}) AND "deliveryDate" >= now() - interval '30 days')::int AS days30
      FROM docs GROUP BY "customerCode", "storageLocation"
    ),
    hist AS (
      -- First purchase on record and the last three 30-day periods with a purchase, from every invoice (not just this year's).
      SELECT "customerCode", "storageLocation", MIN("deliveryDate") AS "firstBuy",
             COUNT(DISTINCT ((now()::date - "deliveryDate"::date) / 30)) FILTER (WHERE now()::date - "deliveryDate"::date < 90)::int AS periods90,
             COUNT(DISTINCT ((now()::date - "deliveryDate"::date) / 30)) FILTER (WHERE now()::date - "deliveryDate"::date < 180)::int AS periods180
      FROM "SalesReturnLine"
      WHERE "documentType" IN (${Prisma.join(LEVERAGE_INVOICE_TYPES)})
      GROUP BY "customerCode", "storageLocation"
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
    ),
    gps AS (
      -- An outlet can sit on several PJPs; take any roster row that carries a position.
      SELECT DISTINCT ON (distributor, "customerCode") distributor, "customerCode", latitude, longitude
      FROM "JourneyPlanAssignment"
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY distributor, "customerCode", pjp
    )
    SELECT a."customerCode", a."storageLocation", a."lastBuy", a.sales, a.transactions, a.days30,
           l."salesRepCode", l."salesRepName", l.route, p."routeDesc",
           n."outletName", n.channel, g.latitude, g.longitude, h."firstBuy", h.periods90, h.periods180
    FROM agg a
    LEFT JOIN hist h USING ("customerCode", "storageLocation")
    LEFT JOIN latest l USING ("customerCode", "storageLocation")
    LEFT JOIN plan p ON p.distributor = a."storageLocation" AND p.pjp = l.route
    LEFT JOIN gps g ON g.distributor = a."storageLocation" AND g."customerCode" = a."customerCode"
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
             COUNT(*) FILTER (WHERE "isProductive")::int AS transactions,
             COUNT(DISTINCT "callDate"::date) FILTER (WHERE "isProductive" AND "callDate" >= now() - interval '30 days')::int AS days30
      FROM "EablCall"
      WHERE "customerCode" IS NOT NULL AND EXTRACT(YEAR FROM "callDate") = EXTRACT(YEAR FROM now())
      GROUP BY "customerCode"
    ),
    hist AS (
      SELECT "customerCode", MIN("callDate") AS "firstBuy",
             COUNT(DISTINCT ((now()::date - "callDate"::date) / 30)) FILTER (WHERE now()::date - "callDate"::date < 90)::int AS periods90,
             COUNT(DISTINCT ((now()::date - "callDate"::date) / 30)) FILTER (WHERE now()::date - "callDate"::date < 180)::int AS periods180
      FROM "EablCall"
      WHERE "customerCode" IS NOT NULL AND "isProductive"
      GROUP BY "customerCode"
    ),
    latest AS (
      SELECT DISTINCT ON ("customerCode") "customerCode", salesman, segment
      FROM "EablCall"
      WHERE "customerCode" IS NOT NULL
      ORDER BY "customerCode", "callDate" DESC, "timeIn" DESC NULLS LAST
    )
    SELECT m."customerId", m.principal, m."outletName", m.channel, m."subChannel", m.territory, m.route,
           m.latitude, m.longitude, c."lastBuy", c.sales, c.transactions, c.days30, l.salesman, l.segment, h."firstBuy", h.periods90, h.periods180
    FROM "EablCustomerMaster" m
    LEFT JOIN calls c ON c."customerCode" = m."customerId"
    LEFT JOIN hist h ON h."customerCode" = m."customerId"
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

/** The roster the reps are looked up in: assignments to principals and Team Leaders, the employee master, and Upfield FSR logins. */
async function loadRepDirectory() {
  const [assignments, employees, leaders, upfield, marsRoster] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { employeeCode: true, employeeName: true, sapName: true, principal: true, contributionPct: true, teamLeaderId: true, region: true, subRegion: true } }),
    prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, sapName: true, absolutePrincipal: true, teamLeader: true, teamLeaderId: true, active: true, region: true, subRegion: true } }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.upfieldOutletMaster.findMany({ where: { fsrName: { not: null }, fsrLogin: { not: null } }, select: { fsrName: true, fsrLogin: true }, distinct: ["fsrName"] }),
    prisma.principalKpiRoster.findMany({ where: { principal: { startsWith: "Mars" } }, select: { employeeCode: true, employeeName: true, teamLeader: true, location: true, active: true } }),
  ]);
  const leaderName = new Map(leaders.map((leader) => [leader.id, leader.name]));
  return buildRepDirectory({
    assignments: assignments.map((a) => ({ employeeCode: a.employeeCode, employeeName: a.employeeName, sapName: a.sapName, principal: a.principal, contributionPct: a.contributionPct, region: a.region, subRegion: a.subRegion, teamLeader: leaderName.get(a.teamLeaderId) ?? "" })).filter((a) => a.teamLeader !== ""),
    employees: employees.map((e) => ({ employeeCode: e.employeeCode, pineName: e.pineName, sapName: e.sapName, absolutePrincipal: e.absolutePrincipal, teamLeader: (e.teamLeaderId ? leaderName.get(e.teamLeaderId) : null) ?? e.teamLeader, active: e.active, region: e.region, subRegion: e.subRegion })),
    marsRoster: marsRoster.map((r) => ({ employeeCode: r.employeeCode, name: r.employeeName, teamLeader: r.teamLeader, location: r.location, active: r.active })),
    upfieldLogins: upfield.map((u) => ({ fsrName: u.fsrName ?? "", fsrLogin: u.fsrLogin ?? "" })),
  });
}

/** Puts each row's rep SFA ID and Team Leader on it. */
export function withRepIdentity(rows: OutletUniverseRow[], resolve: ReturnType<typeof buildRepDirectory>): OutletUniverseRow[] {
  return rows.map((row) => {
    const identity = resolve(row.source, row.principal, row.repName, row.repCode);
    return { ...row, repCode: identity.repCode, teamLeader: identity.teamLeader, repStatus: identity.repStatus, repRegion: identity.repRegion, repSubRegion: identity.repSubRegion };
  });
}

/** Flags the outlets that are the same shop in more than one system: one match id, confidence and systems list per group, on every row of
 *  every outlet in it (an outlet has one row per principal). Nothing is merged or removed. */
export function flagCrossSystemMatches(rows: OutletUniverseRow[]): OutletUniverseRow[] {
  const outlets = new Map<string, MatchInput>();
  for (const row of rows) {
    const id = `${row.source}|${row.outletKey}`;
    const known = outlets.get(id);
    if (known) {
      if (known.latitude === null && row.latitude !== null) {
        known.latitude = row.latitude;
        known.longitude = row.longitude;
      }
      continue;
    }
    outlets.set(id, { id, source: row.source, name: row.outletName, location: row.location, region: row.region, territory: row.territory, route: row.route, latitude: row.latitude, longitude: row.longitude });
  }
  const groups = matchOutlets([...outlets.values()]);
  if (groups.size === 0) return rows;
  return rows.map((row) => {
    const group = groups.get(`${row.source}|${row.outletKey}`);
    if (!group) return row;
    return {
      ...row,
      matchId: group.matchId,
      matchConfidence: group.confidence,
      matchedSystems: group.sources.map((source) => OUTLET_SOURCE_LABELS[source as OutletSource] ?? source).join("; "),
    };
  });
}

/** Replaces the whole OutletUniverse table from the three source tables inside
 *  one transaction, so readers see either the old or the new universe, never a
 *  half-built one. Safe to run repeatedly; the table is a derived copy. */
async function runRebuild(): Promise<OutletUniverseRebuildResult> {
  const startedAt = Date.now();
  const [loadedPine, loadedLeverage, loadedEabl, loadedUpfield] = await Promise.all([loadPine(), loadLeverage(), loadEabl(), loadUpfield()]);
  const excluded: Record<string, number> = {};
  const keep = (rows: OutletUniverseRow[]) =>
    rows.filter((row) => {
      const reason = exclusionReason({ territory: row.territory, repName: row.plannedRep ?? row.repName });
      if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
      return reason === null;
    });
  const pine = keep(loadedPine);
  const leverage = keep(loadedLeverage);
  const eabl = keep(loadedEabl);
  const upfield = keep(loadedUpfield);
  const builtAt = new Date();
  const directory = await loadRepDirectory();
  const all = withCleanup(flagCrossSystemMatches(withRepIdentity([...pine, ...leverage, ...eabl, ...upfield], directory)));

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

  return { pine: pine.length, leverage: leverage.length, eabl: eabl.length, upfield: upfield.length, total: all.length, excluded, durationMs: Date.now() - startedAt };
}
