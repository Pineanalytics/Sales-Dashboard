// The active universe for the Coaching application's bridge feed (app/api/integrations/coaching/reference, resources "universe" and
// "universe-history"). One row per outlet x principal, from all four systems (Pine, Leverage, EABL DMS, Upfield DataEdge), with the same columns as the Active
// Outlets extract plus the shop id (the same shop under several ids, within or across systems, shares one: the universe cleanup, lib/outletUniverse/cleanup.ts,
// run when the universe is compiled), and a monthly history per outlet x principal for buying trends and rep association. By the business's decision (20 Oct 2026) this feed carries sales values and tiers as well as counts.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { boughtWithin, buyingTenure, dormancyFlag, longPurchaseConsistency, OUTLET_SOURCE_LABELS, principalMix, purchaseConsistency, type OutletSource } from "@/lib/outletUniverse/normalize";
import { exportOutlets, parseOutletFilters } from "@/lib/outletUniverse/query";
import { buildNameProfiles, classification2, cleanPlaces, tierRow } from "@/lib/outletUniverse/tiering";
import { loadMonthlyStrike, type MonthlyStrike } from "@/lib/universeAnalysis/monthlyStrike";
import { cleanLocation, getUnifiedLocations } from "@/lib/locationUnify/source";
import { recordKey } from "@/lib/universeAnalysis/pipeline";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

const TTL_MS = 10 * 60_000;
export const FEED_MAX_PAGE_SIZE = 2_000;

export interface UniverseFeedRow {
  source: string;
  sourceCode: string;
  outletId: string;
  /** The shop this outlet belongs to: the master outlet's record key ("PINE-12345"). The same shop registered twice, within or across systems, shares one shopId
   *  on every outlet and principal row of it. Count shops on shopId, never on outletId. Covers every outlet, active or dormant. */
  shopId: string;
  /** How many outlets the shop was merged from (1 = unique), and how sure the merge is ("High" or "Medium"; null for a unique outlet). */
  shopSize: number;
  shopConfidence: string | null;
  /** The same value as shopId and shopSize, under the names the feed first used. */
  masterOutletId: string;
  duplicateGroupSize: number;
  outlet: string;
  principal: string;
  /** "Primary Sales" (direct, sold by Pinefrost reps) or "Secondary Sales" (distributor reps). */
  salesRole: string;
  channel: string;
  segment: string;
  sourceChannel: string;
  sourceSegment: string;
  location: string;
  region: string;
  /** The territory as the source system spells it, and the unified name several spellings share ("THIKA", "Thika - MBSR", "Nairobi-Thika" -> "Thika"). */
  territory: string;
  territoryClean: string;
  /** Stable id of the unified place, and how the name was unified ("same name", "name + coordinates", "spelling + coordinates", "address -> nearest area"; null when it stands alone). */
  territoryGroupId: string | null;
  territoryMatch: string | null;
  route: string | null;
  /** The rep who sells THIS principal at the outlet, their SFA code, and their Team Leader. */
  rep: string | null;
  repSfaId: string | null;
  teamLeader: string | null;
  repStatus: string | null;
  repRegion: string | null;
  repSubRegion: string | null;
  /** Pine's journey-plan owner of the outlet. */
  plannedRep: string | null;
  repsServing: number;
  repsByPrincipal: string | null;
  teamLeadersByPrincipal: string | null;
  latitude: number | null;
  longitude: number | null;
  lastPurchase: string | null;
  status: "Active" | "Dormant";
  daysSincePurchase: number | null;
  dormancyFlag: string | null;
  salesYtd: number;
  averageSale: number | null;
  transactionsYtd: number;
  combinedAverageSale: number | null;
  tier: string;
  buyingSince: string | null;
  monthsBuying: number | null;
  buyingTenure: string;
  periodsBoughtLast3: number;
  consistency: string;
  periodsBoughtLast6: number;
  consistency6Months: string;
  boughtLast30Days: boolean;
  boughtLast3Months: boolean;
  boughtLast6Months: boolean;
  dominantPrincipal: string | null;
  dominantSharePct: number | null;
  principalMix: string;
  principalsBought: number;
  sharedPrincipals: string | null;
  matchId: string | null;
  matchConfidence: string | null;
  matchedSystems: string | null;
}

export interface MonthPoint {
  sales: number;
  transactions: number;
  /** Customer-months called and productive (the Coverage page's rules); productive is null for Leverage, which records no call without a sale. */
  calls: number;
  productive: number | null;
}

export interface UniverseHistoryRow {
  source: string;
  sourceCode: string;
  outletId: string;
  principal: string;
  /** Month ("2026-09") -> that month's buying and calls; only months with activity. */
  months: Record<string, MonthPoint>;
}

export interface FeedSnapshot<T> {
  /** When the underlying outlet universe was last compiled: lets the reader detect a refresh between pages. */
  builtAt: string | null;
  builtFor: number;
  rows: T[];
}

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

async function universeBuiltAt(): Promise<string | null> {
  const [row] = await prisma.$queryRaw<{ builtAt: Date | null }[]>(Prisma.sql`SELECT MAX("builtAt") AS "builtAt" FROM "OutletUniverse"`);
  return row?.builtAt ? row.builtAt.toISOString() : null;
}

/** Every outlet x principal row of the universe (active and dormant), all sources, with the master outlet id. */
export async function buildUniverseFeed(): Promise<UniverseFeedRow[]> {
  const base = parseOutletFilters(new URLSearchParams({ view: "principal" }));
  const [rows, universe] = await Promise.all([exportOutlets({ ...base, status: "all" }, null), exportOutlets({ ...base, status: "all" }, null, { withMix: false })]);
  const profiles = buildNameProfiles(universe);
  const unified = await getUnifiedLocations();
  const now = new Date();
  return rows.map((row) => {
    const tenure = buyingTenure(row.firstPurchaseDate, now);
    const tiered = tierRow(row, profiles);
    const places = cleanPlaces(row);
    const source = row.source as OutletSource;
    const label = OUTLET_SOURCE_LABELS[source] ?? row.source;
    const daysSince = row.lastPurchaseDate ? Math.max(0, Math.floor((now.getTime() - new Date(row.lastPurchaseDate).getTime()) / 86_400_000)) : null;
    // The shop comes from the universe cleanup stored on the outlet (every outlet, active or not); an outlet compiled before it existed is its own shop.
    const shopId = row.shopId ?? recordKey(label, String(row.outletKey));
    const shopSize = row.shopSize ?? 1;
    const territory = cleanLocation(unified, places.territory);
    return {
      source: label,
      sourceCode: row.source,
      outletId: String(row.outletKey),
      shopId,
      shopSize,
      shopConfidence: shopSize > 1 ? row.shopConfidence : null,
      masterOutletId: shopId,
      duplicateGroupSize: shopSize,
      outlet: row.outletName,
      principal: row.principals,
      salesRole: classification2(row.salesRole),
      channel: tiered.channel,
      segment: tiered.segment,
      sourceChannel: row.channel,
      sourceSegment: row.segment,
      location: places.location,
      region: places.region,
      territory: places.territory,
      territoryClean: row.territoryClean ?? territory.canonical,
      territoryGroupId: territory.groupId,
      territoryMatch: territory.match,
      route: row.route,
      rep: row.repName,
      repSfaId: row.repCode,
      teamLeader: row.teamLeader,
      repStatus: row.repStatus,
      repRegion: row.repRegion,
      repSubRegion: row.repSubRegion,
      plannedRep: row.plannedRep,
      repsServing: row.repCount,
      repsByPrincipal: row.repsByPrincipal,
      teamLeadersByPrincipal: row.teamLeadersByPrincipal,
      latitude: row.latitude,
      longitude: row.longitude,
      lastPurchase: row.lastPurchaseDate ? String(row.lastPurchaseDate).slice(0, 10) : null,
      status: row.active ? "Active" : "Dormant",
      daysSincePurchase: daysSince,
      dormancyFlag: row.active ? null : (dormancyFlag(row.lastPurchaseDate)?.flag ?? null),
      salesYtd: round(row.sales, 2),
      averageSale: tiered.averageSales === null ? null : round(tiered.averageSales, 2),
      transactionsYtd: row.transactions,
      combinedAverageSale: tiered.combinedAverage === null ? null : round(tiered.combinedAverage, 2),
      tier: tiered.tier,
      buyingSince: row.firstPurchaseDate ? String(row.firstPurchaseDate).slice(0, 10) : null,
      monthsBuying: tenure.months,
      buyingTenure: tenure.band,
      periodsBoughtLast3: row.periodsBought90,
      consistency: purchaseConsistency(row.periodsBought90),
      periodsBoughtLast6: row.periodsBought180,
      consistency6Months: longPurchaseConsistency(row.periodsBought180),
      boughtLast30Days: boughtWithin(row.lastPurchaseDate, 30, now),
      boughtLast3Months: boughtWithin(row.lastPurchaseDate, 91, now),
      boughtLast6Months: boughtWithin(row.lastPurchaseDate, 183, now),
      dominantPrincipal: row.dominantPrincipal ?? row.principals,
      dominantSharePct: row.dominantShare === null ? null : round(row.dominantShare * 100, 1),
      principalMix: principalMix(row.principalCount, row.dominantShare),
      principalsBought: row.principalCount,
      sharedPrincipals: row.sharedPrincipals,
      matchId: row.matchId,
      matchConfidence: row.matchConfidence,
      matchedSystems: row.matchedSystems,
    };
  });
}

interface BuyingRow {
  source: string;
  principal: string;
  customerId: string;
  monthIndex: number;
  sales: number;
  transactions: number;
}

/** Monthly sales and transactions per outlet x principal, by source (the buying trend). */
async function loadMonthlyBuying(year: number): Promise<BuyingRow[]> {
  const [pine, eabl, upfield, leverage] = await Promise.all([
    prisma.$queryRaw<{ principal: string; customerId: string; monthIndex: number; sales: number; transactions: number }[]>(Prisma.sql`
      SELECT principal, "customerId", (EXTRACT(MONTH FROM date)::int - 1) AS "monthIndex", SUM(sales)::double precision AS sales, COUNT(DISTINCT "docId")::int AS transactions
      FROM "ActiveOutletEvent" WHERE year = ${String(year)} GROUP BY principal, "customerId", "monthIndex"
    `),
    prisma.$queryRaw<{ principal: string; customerId: string; monthIndex: number; sales: number; transactions: number }[]>(Prisma.sql`
      SELECT ecm.principal, ec."customerCode" AS "customerId", (EXTRACT(MONTH FROM ec."callDate")::int - 1) AS "monthIndex", COALESCE(SUM(ec."netSales"), 0)::double precision AS sales, (COUNT(*) FILTER (WHERE ec."isProductive"))::int AS transactions
      FROM "EablCall" ec INNER JOIN "EablCustomerMaster" ecm ON ecm."customerId" = ec."customerCode"
      WHERE ec."customerCode" IS NOT NULL AND EXTRACT(YEAR FROM ec."callDate") = ${year} GROUP BY ecm.principal, ec."customerCode", "monthIndex"
    `),
    prisma.$queryRaw<{ customerId: string; monthIndex: number; sales: number; transactions: number }[]>(Prisma.sql`
      SELECT "custCode" AS "customerId", (EXTRACT(MONTH FROM "txnDate")::int - 1) AS "monthIndex", COALESCE(SUM("saleIncl") FILTER (WHERE type = 'sale'), 0)::double precision AS sales, (COUNT(*) FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0))::int AS transactions
      FROM "UpfieldTransaction"
      WHERE NULLIF(BTRIM("custCode"), '') IS NOT NULL AND UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST' AND EXTRACT(YEAR FROM "txnDate") = ${year} GROUP BY "custCode", "monthIndex"
    `),
    prisma.$queryRaw<{ storageLocation: string; customerId: string; monthIndex: number; sales: number; transactions: number }[]>(Prisma.sql`
      SELECT "storageLocation", "customerCode" AS "customerId", (EXTRACT(MONTH FROM "deliveryDate")::int - 1) AS "monthIndex", COALESCE(SUM("netSale"), 0)::double precision AS sales, (COUNT(DISTINCT "invoiceNo") FILTER (WHERE "documentType" IN ('01', '06')))::int AS transactions
      FROM "SalesReturnLine" WHERE EXTRACT(YEAR FROM "deliveryDate") = ${year} GROUP BY "storageLocation", "customerCode", "monthIndex"
    `),
  ]);
  return [
    ...pine.map((r) => ({ source: "PINE", ...r })),
    ...eabl.map((r) => ({ source: "EABL", ...r })),
    ...upfield.map((r) => ({ source: "UPFIELD", principal: "Upfield-Nairobi", ...r })),
    ...leverage.map((r) => ({ source: "LEVERAGE", principal: `Unilever-${SALES_RETURNS_BRANCH_LABELS[r.storageLocation] ?? r.storageLocation}`, customerId: r.customerId, monthIndex: r.monthIndex, sales: r.sales, transactions: r.transactions })),
  ];
}

const monthKey = (year: number, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

/** Joins the monthly buying and the monthly calls into one history row per source x principal x outlet. Pure, so it is tested without a database. */
export function mergeHistory(year: number, buying: BuyingRow[], strike: MonthlyStrike): UniverseHistoryRow[] {
  const rows = new Map<string, UniverseHistoryRow>();
  const get = (source: string, principal: string, outletId: string) => {
    const key = `${source}\u0000${principal}\u0000${outletId}`;
    let row = rows.get(key);
    if (!row) {
      row = { source: OUTLET_SOURCE_LABELS[source as OutletSource] ?? source, sourceCode: source, outletId, principal, months: {} };
      rows.set(key, row);
    }
    return row;
  };
  const point = (row: UniverseHistoryRow, monthIndex: number): MonthPoint => (row.months[monthKey(year, monthIndex)] ??= { sales: 0, transactions: 0, calls: 0, productive: source0(row) });
  const source0 = (row: UniverseHistoryRow) => (row.sourceCode === "LEVERAGE" ? null : 0);
  for (const b of buying) {
    const p = point(get(b.source, b.principal, String(b.customerId)), b.monthIndex);
    p.sales = round(p.sales + b.sales, 2);
    p.transactions += b.transactions;
  }
  for (const [key, counts] of strike.byCustomer) {
    const [source, principal, customerId] = key.split("\u0000");
    for (let m = 0; m < 12; m++) {
      if (counts.calls[m] === 0 && (counts.productive[m] ?? 0) === 0) continue;
      const p = point(get(source, principal, customerId), m);
      p.calls = counts.calls[m];
      p.productive = counts.productive[m];
    }
  }
  return [...rows.values()].sort((a, b) => (a.sourceCode + a.principal + a.outletId < b.sourceCode + b.principal + b.outletId ? -1 : 1));
}

export async function buildUniverseHistory(): Promise<UniverseHistoryRow[]> {
  const year = new Date().getFullYear();
  const [buying, strike] = await Promise.all([loadMonthlyBuying(year), loadMonthlyStrike()]);
  return mergeHistory(year, buying, strike);
}

// ---------------------------------------------------------------- cached snapshots and paging
const cache = new Map<string, { at: number; value: Promise<FeedSnapshot<unknown>> }>();

async function snapshot<T>(name: string, build: () => Promise<T[]>): Promise<FeedSnapshot<T>> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.value as Promise<FeedSnapshot<T>>;
  const value = (async (): Promise<FeedSnapshot<T>> => ({ builtAt: await universeBuiltAt(), builtFor: Date.now(), rows: await build() }))();
  value.catch(() => cache.delete(name));
  cache.set(name, { at: Date.now(), value });
  return value;
}

export const universeSnapshot = () => snapshot("universe", buildUniverseFeed);
export const historySnapshot = () => snapshot("history", buildUniverseHistory);

export interface Page<T> {
  rows: T[];
  total: number;
  nextCursor: string | null;
}

/** An opaque cursor is the offset into the stable (sorted) snapshot. */
export function paginate<T>(rows: T[], cursor: string | null, pageSize: number): Page<T> {
  const start = cursor && /^\d+$/.test(cursor) ? Math.min(Number(cursor), rows.length) : 0;
  const size = Math.min(Math.max(1, Math.floor(pageSize) || 500), FEED_MAX_PAGE_SIZE);
  const end = Math.min(start + size, rows.length);
  return { rows: rows.slice(start, end), total: rows.length, nextCursor: end < rows.length ? String(end) : null };
}
