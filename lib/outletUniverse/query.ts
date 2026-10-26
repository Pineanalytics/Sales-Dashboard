import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import {
  DOMINANT_SHARE,
  DORMANT_LOST_AFTER_DAYS,
  FREQUENT_MIN_PURCHASE_DAYS,
  FREQUENT_WINDOW_DAYS,
  OUTLET_ACTIVE_WINDOW_DAYS,
  OUTLET_SALES_ROLES,
  OUTLET_SOURCES,
  type OutletSalesRole,
  type OutletSource,
} from "./normalize";

export type OutletView = "principal" | "general";
export type OutletStatus = "active" | "inactive" | "all";

export interface OutletFilters {
  /** "principal": one outlet per principal it buys (an outlet buying 3 principals is 3 rows).
   *  "general": every outlet counted once, however many principals it buys. */
  view: OutletView;
  status: OutletStatus;
  /** Narrows to Primary or Secondary Sales; null shows both, split side by side. */
  role: OutletSalesRole | null;
  source: OutletSource | null;
  principal: string | null;
  /** A principal brand across every location ("Mars" = Mars-Nairobi and any other Mars row); how the dashboard's principal selector names it. */
  principalKey: string | null;
  channel: string | null;
  segment: string | null;
  region: string | null;
  territory: string | null;
  route: string | null;
  rep: string | null;
  q: string;
}

export const OUTLET_PAGE_SIZE = 50;
const TOP_TERRITORIES = 25;
const TOP_REPS = 25;

function text(value: string | null, max = 120): string | null {
  const trimmed = (value ?? "").trim().slice(0, max);
  return trimmed ? trimmed : null;
}

/** Reads and validates the filters from a request; an unknown value is ignored, never trusted. */
export function parseOutletFilters(params: URLSearchParams): OutletFilters {
  const source = params.get("source");
  const status = params.get("status");
  const role = params.get("role");
  return {
    view: params.get("view") === "general" ? "general" : "principal",
    status: status === "inactive" || status === "all" ? status : "active",
    role: (OUTLET_SALES_ROLES as string[]).includes(role ?? "") ? (role as OutletSalesRole) : null,
    source: (OUTLET_SOURCES as string[]).includes(source ?? "") ? (source as OutletSource) : null,
    principal: text(params.get("principal")),
    principalKey: text(params.get("principalKey")),
    channel: text(params.get("channel")),
    segment: text(params.get("segment")),
    region: text(params.get("region")),
    territory: text(params.get("territory")),
    route: text(params.get("route")),
    rep: text(params.get("rep")),
    q: text(params.get("q"), 80) ?? "",
  };
}

/** Rows a restricted session may see: a principal-restricted viewer or team
 *  leader sees only their own principals. `null` means unrestricted. Compared
 *  case-insensitively because the DMS feeds spell principals ("EABL-Nyeri" /
 *  "Eabl-Nyeri") differently from the Principal table. */
export type OutletScope = { principals: string[] } | null;

/** Rows of one principal brand: "Mars-Nairobi" and "Ukl-Intl-Nairobi" reduce to "mars" and "ukl", the same key the dashboard's principal selector uses. */
function principalKeyClause(key: string): Prisma.Sql {
  return Prisma.sql`regexp_replace(lower(split_part(principal, '-', 1)), '[^a-z0-9]', '', 'g') = ${normalizePrincipalKey(key)}`;
}

export function baseWhere(filters: OutletFilters, scope: OutletScope): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope) {
    parts.push(scope.principals.length > 0 ? Prisma.sql`lower(principal) IN (${Prisma.join(scope.principals.map((name) => name.toLowerCase()))})` : Prisma.sql`FALSE`);
  }
  if (filters.source) parts.push(Prisma.sql`source = ${filters.source}`);
  if (filters.role) parts.push(Prisma.sql`"salesRole" = ${filters.role}`);
  if (filters.principal) parts.push(Prisma.sql`lower(principal) = ${filters.principal.toLowerCase()}`);
  if (filters.principalKey) parts.push(principalKeyClause(filters.principalKey));
  if (filters.channel) parts.push(Prisma.sql`channel = ${filters.channel}`);
  if (filters.segment) parts.push(Prisma.sql`segment = ${filters.segment}`);
  if (filters.region) parts.push(Prisma.sql`region = ${filters.region}`);
  if (filters.territory) parts.push(Prisma.sql`territory = ${filters.territory}`);
  if (filters.route) parts.push(Prisma.sql`route = ${filters.route}`);
  if (filters.rep) parts.push(Prisma.sql`"repName" = ${filters.rep}`);
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    parts.push(Prisma.sql`("outletName" ILIKE ${like} OR "outletKey" ILIKE ${like})`);
  }
  return Prisma.join(parts, " AND ");
}

function activeCutoff(): Date {
  return new Date(Date.now() - OUTLET_ACTIVE_WINDOW_DAYS * 86_400_000);
}

/** The common table expressions every query builds on:
 *  - `base`: the filtered OutletUniverse rows (principal grain);
 *  - `unit`: what is being counted — the same rows in the principal view, or one
 *    row per source+outlet in the general view (so a shop buying several
 *    principals counts once), carrying `active` = bought within the window. */
function scopeWhere(scope: OutletScope): Prisma.Sql {
  if (!scope) return Prisma.sql`TRUE`;
  return scope.principals.length > 0 ? Prisma.sql`lower(principal) IN (${Prisma.join(scope.principals.map((name) => name.toLowerCase()))})` : Prisma.sql`FALSE`;
}

/** Per outlet (source + outletKey): the principals it buys and which one dominates, and the reps selling it (each principal row's rep,
 *  so more than one distinct rep means different reps sell different principals there), over the viewer's whole scope and not
 *  only the rows the dashboard's filters keep, so "dominant" does not change with the principal filter. */
function mixCte(scope: OutletScope): Prisma.Sql {
  return Prisma.sql`mix AS (
      SELECT source, "outletKey",
             COUNT(*)::int AS "principalCount",
             MAX(principal) FILTER (WHERE rn = 1) AS "dominantPrincipal",
             CASE WHEN MAX(total) > 0 THEN (MAX(sales) FILTER (WHERE rn = 1) / MAX(total))::double precision END AS "dominantShare",
             STRING_AGG(principal || CASE WHEN total > 0 THEN ' (' || ROUND(sales / total * 100)::int || '%)' ELSE '' END, '; ' ORDER BY rn) FILTER (WHERE rn > 1) AS "sharedPrincipals",
             COUNT(DISTINCT lower(rep)) FILTER (WHERE rep IS NOT NULL)::int AS "repCount",
             STRING_AGG(principal || ': ' || rep, '; ' ORDER BY rn) FILTER (WHERE rep IS NOT NULL) AS "repsByPrincipal",
             STRING_AGG(principal || ': ' || "teamLeader", '; ' ORDER BY rn) FILTER (WHERE "teamLeader" IS NOT NULL AND btrim("teamLeader") <> '') AS "teamLeadersByPrincipal"
      FROM (
        SELECT source, "outletKey", principal, NULLIF(btrim("repName"), '') AS rep, "teamLeader", sales, SUM(sales) OVER (PARTITION BY source, "outletKey") AS total,
               ROW_NUMBER() OVER (PARTITION BY source, "outletKey" ORDER BY sales DESC, transactions DESC, principal ASC) AS rn
        FROM "OutletUniverse" WHERE ${scopeWhere(scope)}
      ) p
      GROUP BY source, "outletKey"
    )`;
}

/** `withMix` adds the per-outlet principal mix (used by the extract); the dashboard queries leave it empty so they stay cheap. */
function cte(filters: OutletFilters, scope: OutletScope, withMix = false): Prisma.Sql {
  const cutoff = activeCutoff();
  const mix = withMix
    ? mixCte(scope)
    : Prisma.sql`mix AS (SELECT NULL::text AS source, NULL::text AS "outletKey", NULL::int AS "principalCount", NULL::text AS "dominantPrincipal", NULL::double precision AS "dominantShare", NULL::text AS "sharedPrincipals", NULL::int AS "repCount", NULL::text AS "repsByPrincipal", NULL::text AS "teamLeadersByPrincipal" WHERE FALSE)`;
  const base = Prisma.sql`base AS (SELECT * FROM "OutletUniverse" WHERE ${baseWhere(filters, scope)})`;
  if (filters.view === "principal") {
    return Prisma.sql`WITH ${base}, ${mix},
      unit AS (
        SELECT b.source, b."outletKey", b.principal, b.principal AS principals, b."salesRole", b."outletName", b.channel, b.segment, b.location, b.region, b.territory, b.route,
               b."repName", b."repCode", b."teamLeader", b."repStatus", b."repRegion", b."repSubRegion", b."plannedRep", b."matchId", b."matchConfidence", b."matchedSystems", b.latitude, b.longitude, b."lastPurchaseDate", b.sales, b.transactions,
               b."firstPurchaseDate", b."periodsBought90", b."periodsBought180", b."territoryClean", b."shopId", b."shopSize", b."shopConfidence", m."principalCount", m."dominantPrincipal", m."dominantShare", m."sharedPrincipals", m."repCount", m."repsByPrincipal", m."teamLeadersByPrincipal",
               COALESCE(b."lastPurchaseDate" >= ${cutoff}, FALSE) AS active,
               (b."salesRole" = 'Primary Sales') AS "hasPrimary",
               (b."salesRole" = 'Secondary Sales') AS "hasSecondary",
               COALESCE(b."lastPurchaseDate" >= ${cutoff} AND b."salesRole" = 'Primary Sales', FALSE) AS "activePrimary",
               COALESCE(b."lastPurchaseDate" >= ${cutoff} AND b."salesRole" = 'Secondary Sales', FALSE) AS "activeSecondary"
        FROM base b LEFT JOIN mix m ON m.source = b.source AND m."outletKey" = b."outletKey"
      )`;
  }
  return Prisma.sql`WITH ${base}, ${mix},
    head AS (
      SELECT DISTINCT ON (source, "outletKey") source, "outletKey", "outletName", channel, segment, location, region, territory, route,
             "repName", "repCode", "teamLeader", "repStatus", "repRegion", "repSubRegion", "plannedRep", "matchId", "matchConfidence", "matchedSystems", latitude, longitude, "firstPurchaseDate", "periodsBought90", "periodsBought180", "territoryClean", "shopId", "shopSize", "shopConfidence"
      FROM base
      ORDER BY source, "outletKey", "lastPurchaseDate" DESC NULLS LAST, principal
    ),
    agg AS (
      SELECT source, "outletKey", MAX("lastPurchaseDate") AS "lastPurchaseDate", SUM(sales) AS sales, SUM(transactions) AS transactions,
             STRING_AGG(principal, ', ' ORDER BY principal) AS principals,
             BOOL_OR("salesRole" = 'Primary Sales') AS "hasPrimary",
             BOOL_OR("salesRole" = 'Secondary Sales') AS "hasSecondary",
             COALESCE(BOOL_OR("salesRole" = 'Primary Sales' AND "lastPurchaseDate" >= ${cutoff}), FALSE) AS "activePrimary",
             COALESCE(BOOL_OR("salesRole" = 'Secondary Sales' AND "lastPurchaseDate" >= ${cutoff}), FALSE) AS "activeSecondary"
      FROM base GROUP BY source, "outletKey"
    ),
    unit AS (
      SELECT h.source, h."outletKey", a.principals AS principal, a.principals,
             CASE WHEN a."hasPrimary" AND a."hasSecondary" THEN 'Primary + Secondary'
                  WHEN a."hasSecondary" THEN 'Secondary Sales' ELSE 'Primary Sales' END AS "salesRole",
             h."outletName", h.channel, h.segment, h.location, h.region, h.territory, h.route,
             h."repName", h."repCode", h."teamLeader", h."repStatus", h."repRegion", h."repSubRegion", h."plannedRep", h."matchId", h."matchConfidence", h."matchedSystems", h.latitude, h.longitude, a."lastPurchaseDate", a.sales, a.transactions,
             h."firstPurchaseDate", h."periodsBought90", h."periodsBought180", h."territoryClean", h."shopId", h."shopSize", h."shopConfidence", m."principalCount", m."dominantPrincipal", m."dominantShare", m."sharedPrincipals", m."repCount", m."repsByPrincipal", m."teamLeadersByPrincipal",
             COALESCE(a."lastPurchaseDate" >= ${cutoff}, FALSE) AS active,
             a."hasPrimary", a."hasSecondary", a."activePrimary", a."activeSecondary"
      FROM head h JOIN agg a USING (source, "outletKey") LEFT JOIN mix m ON m.source = h.source AND m."outletKey" = h."outletKey"
    )`;
}

function statusClause(status: OutletStatus): Prisma.Sql {
  if (status === "active") return Prisma.sql`active`;
  if (status === "inactive") return Prisma.sql`NOT active`;
  return Prisma.sql`TRUE`;
}

/** Every breakdown carries both counts so the dashboard can show active against
 *  the full known universe; the status filter only narrows the headline totals
 *  and the outlet list. */
export interface RoleCounts {
  /** Active outlets that bought through Primary / Secondary Sales. In the general
   *  view an outlet reached by both roles is in both, so the two can sum to more
   *  than `active`. */
  activePrimary: number;
  activeSecondary: number;
  totalPrimary: number;
  totalSecondary: number;
}

export interface BreakdownRow extends RoleCounts {
  name: string;
  active: number;
  total: number;
}

export interface PrincipalBreakdownRow extends BreakdownRow {
  source: string;
  sales: number;
}

/** How long the shown outlets have been buying, how recently, and how steadily (see lib/outletUniverse/normalize.ts). */
export interface BuyingHistory {
  total: number;
  /** By first purchase on record. */
  tenure: { band: string; count: number }[];
  /** Outlets whose last purchase was within the window. */
  boughtWithin: { last30: number; last90: number; last180: number };
  /** Bought in every one of the last three / six 30-day periods. */
  consistency: { consistent3: number; consistent6: number };
  /** Single principal, one dominant principal (largest holds DOMINANT_SHARE or more), or shared. */
  mix: { single: number; dominant: number; shared: number };
}

export interface OutletUniverseSummary {
  builtAt: string | null;
  buying: BuyingHistory;
  activeWindowDays: number;
  totals: { total: number; active: number; inactive: number; withCoordinates: number; sales: number; transactions: number };
  /** Distinct outlets under the same filters, whichever view is selected (an
   *  outlet buying several principals counts once). In the principal view
   *  `totals` counts outlet-principal pairs instead. */
  distinct: { total: number; active: number } & RoleCounts;
  bySource: BreakdownRow[];
  byPrincipal: PrincipalBreakdownRow[];
  byRegion: BreakdownRow[];
  byTerritory: BreakdownRow[];
  byChannel: BreakdownRow[];
  bySegment: BreakdownRow[];
  byRep: BreakdownRow[];
}

const num = (value: unknown) => Number(value ?? 0);

const ROLE_AGGREGATES = Prisma.sql`
  COUNT(*) FILTER (WHERE "activePrimary")::int AS "activePrimary",
  COUNT(*) FILTER (WHERE "activeSecondary")::int AS "activeSecondary",
  COUNT(*) FILTER (WHERE "hasPrimary")::int AS "totalPrimary",
  COUNT(*) FILTER (WHERE "hasSecondary")::int AS "totalSecondary"`;

function roleCounts(row: Partial<Record<keyof RoleCounts, unknown>>): RoleCounts {
  return { activePrimary: num(row.activePrimary), activeSecondary: num(row.activeSecondary), totalPrimary: num(row.totalPrimary), totalSecondary: num(row.totalSecondary) };
}

async function breakdown(filters: OutletFilters, scope: OutletScope, column: Prisma.Sql, limit?: number): Promise<BreakdownRow[]> {
  const rows = await prisma.$queryRaw<(RoleCounts & { name: string; active: number; total: number })[]>(Prisma.sql`
    ${cte(filters, scope)}
    SELECT COALESCE(NULLIF(BTRIM(${column}), ''), 'Unspecified') AS name,
           COUNT(*) FILTER (WHERE active)::int AS active,
           COUNT(*)::int AS total,
           ${ROLE_AGGREGATES}
    FROM unit
    GROUP BY 1 ORDER BY active DESC, total DESC, name ASC
    ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
  `);
  return rows.map((row) => ({ name: row.name, active: num(row.active), total: num(row.total), ...roleCounts(row) }));
}

export async function getOutletUniverseSummary(filters: OutletFilters, scope: OutletScope): Promise<OutletUniverseSummary> {
  // The principal panel always counts principal-grain rows, even in the general
  // view: it answers "how many active outlets does each principal have".
  const principalFilters: OutletFilters = { ...filters, view: "principal" };
  const [buyingRows, totals, distinct, builtAt, bySource, byPrincipal, byRegion, byTerritory, byChannel, bySegment, byRep] = await Promise.all([
    prisma.$queryRaw<Record<string, number>[]>(Prisma.sql`
      ${cte(filters, scope, true)}
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "firstPurchaseDate" IS NULL)::int AS unknown,
             COUNT(*) FILTER (WHERE now()::date - "firstPurchaseDate"::date >= 183)::int AS over6,
             COUNT(*) FILTER (WHERE now()::date - "firstPurchaseDate"::date BETWEEN 91 AND 182)::int AS m3to6,
             COUNT(*) FILTER (WHERE now()::date - "firstPurchaseDate"::date BETWEEN 30 AND 90)::int AS m1to3,
             COUNT(*) FILTER (WHERE now()::date - "firstPurchaseDate"::date < 30)::int AS under1,
             COUNT(*) FILTER (WHERE "lastPurchaseDate" >= now() - interval '30 days')::int AS last30,
             COUNT(*) FILTER (WHERE "lastPurchaseDate" >= now() - interval '91 days')::int AS last90,
             COUNT(*) FILTER (WHERE "lastPurchaseDate" >= now() - interval '183 days')::int AS last180,
             COUNT(*) FILTER (WHERE COALESCE("periodsBought90", 0) >= 3)::int AS consistent3,
             COUNT(*) FILTER (WHERE COALESCE("periodsBought180", 0) >= 6)::int AS consistent6,
             COUNT(*) FILTER (WHERE COALESCE("principalCount", 1) <= 1)::int AS single,
             COUNT(*) FILTER (WHERE COALESCE("principalCount", 1) > 1 AND COALESCE("dominantShare", 0) >= ${DOMINANT_SHARE})::int AS dominant
      FROM unit WHERE ${statusClause(filters.status)}
    `),
    prisma.$queryRaw<{ total: number; active: number; withCoordinates: number; sales: number; transactions: number }[]>(Prisma.sql`
      ${cte(filters, scope)}
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active,
             COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS "withCoordinates",
             COALESCE(SUM(sales), 0)::double precision AS sales, COALESCE(SUM(transactions), 0)::double precision AS transactions
      FROM unit WHERE ${statusClause(filters.status)}
    `),
    prisma.$queryRaw<(RoleCounts & { total: number; active: number })[]>(Prisma.sql`
      ${cte({ ...filters, view: "general" }, scope)}
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active, ${ROLE_AGGREGATES} FROM unit
    `),
    prisma.$queryRaw<{ builtAt: Date | null }[]>(Prisma.sql`SELECT MAX("builtAt") AS "builtAt" FROM "OutletUniverse"`),
    breakdown(filters, scope, Prisma.sql`source`),
    prisma.$queryRaw<(RoleCounts & { name: string; source: string; active: number; total: number; sales: number })[]>(Prisma.sql`
      ${cte(principalFilters, scope)}
      SELECT principal AS name, source, COUNT(*) FILTER (WHERE active)::int AS active, COUNT(*)::int AS total,
             ${ROLE_AGGREGATES},
             COALESCE(SUM(sales), 0)::double precision AS sales
      FROM unit
      GROUP BY principal, source ORDER BY active DESC, total DESC, name ASC
    `),
    breakdown(filters, scope, Prisma.sql`region`),
    breakdown(filters, scope, Prisma.sql`territory`, TOP_TERRITORIES),
    breakdown(filters, scope, Prisma.sql`channel`),
    breakdown(filters, scope, Prisma.sql`segment`),
    breakdown(filters, scope, Prisma.sql`"repName"`, TOP_REPS),
  ]);

  const b = buyingRows[0] ?? {};
  const buyingTotal = num(b.total);
  const buying: BuyingHistory = {
    total: buyingTotal,
    tenure: [
      { band: "More than 6 months", count: num(b.over6) },
      { band: "3 to 6 months", count: num(b.m3to6) },
      { band: "1 to 3 months", count: num(b.m1to3) },
      { band: "Less than 1 month", count: num(b.under1) },
      { band: "Unknown", count: num(b.unknown) },
    ],
    boughtWithin: { last30: num(b.last30), last90: num(b.last90), last180: num(b.last180) },
    consistency: { consistent3: num(b.consistent3), consistent6: num(b.consistent6) },
    mix: { single: num(b.single), dominant: num(b.dominant), shared: buyingTotal - num(b.single) - num(b.dominant) },
  };

  const t = totals[0];
  const total = num(t?.total);
  const active = num(t?.active);
  return {
    builtAt: builtAt[0]?.builtAt ? builtAt[0].builtAt.toISOString() : null,
    buying,
    activeWindowDays: OUTLET_ACTIVE_WINDOW_DAYS,
    totals: { total, active, inactive: total - active, withCoordinates: num(t?.withCoordinates), sales: num(t?.sales), transactions: num(t?.transactions) },
    distinct: { total: num(distinct[0]?.total), active: num(distinct[0]?.active), ...roleCounts(distinct[0] ?? {}) },
    bySource,
    byPrincipal: byPrincipal.map((row) => ({ name: row.name, source: row.source, active: num(row.active), total: num(row.total), sales: num(row.sales), ...roleCounts(row) })),
    byRegion,
    byTerritory,
    byChannel,
    bySegment,
    byRep,
  };
}

export interface OutletListRow {
  source: string;
  outletKey: string;
  outletName: string;
  principals: string;
  /** "Primary Sales", "Secondary Sales", or "Primary + Secondary" for a general-view outlet reached by both. */
  salesRole: string;
  channel: string;
  segment: string;
  location: string;
  region: string;
  territory: string;
  route: string | null;
  /** The rep who sells the row's principal at the outlet, their SFA user code or ID as their system supplies it, and their Team Leader from the roster. */
  repName: string | null;
  repCode: string | null;
  teamLeader: string | null;
  /** Active or Inactive worker on the roster, and the region and sub-region the rep is placed in. */
  repStatus: string | null;
  repRegion: string | null;
  repSubRegion: string | null;
  /** Each principal's Team Leader at the outlet ("Principal: Team Leader; ..."), in sales order. */
  teamLeadersByPrincipal: string | null;
  /** Pine's journey-plan owner of the outlet (the same on every principal); null for the other sources. */
  plannedRep: string | null;
  /** The same shop in another system, by name, place and GPS: shared match id, confidence (High or Medium) and the systems it appears in. Null when it matched nothing. */
  matchId: string | null;
  matchConfidence: string | null;
  matchedSystems: string | null;
  latitude: number | null;
  longitude: number | null;
  lastPurchaseDate: string | null;
  sales: number;
  transactions: number;
  active: boolean;
  /** Earliest purchase on record (any principal) and how many of the last three 30-day periods saw a purchase. */
  firstPurchaseDate: string | null;
  periodsBought90: number;
  periodsBought180: number;
  /** The outlet's principal portfolio over the viewer's scope: how many principals, which one dominates (and its share of the outlet's sales, 0 to 1), and the rest with their shares. */
  principalCount: number;
  dominantPrincipal: string | null;
  dominantShare: number | null;
  sharedPrincipals: string | null;
  /** Distinct reps serving the outlet across its principals (0 when no rep is named), and who sells which principal ("Principal: Rep; ..."). */
  repCount: number;
  repsByPrincipal: string | null;
  /** The universe cleanup (cleanup.ts): the unified territory, and the shop this outlet belongs to (the master outlet's record key; outlets in one shop share it),
   *  how many outlets are in the shop (1 = unique) and how sure the merge is. Null until the universe has been compiled with the cleanup. */
  territoryClean: string | null;
  shopId: string | null;
  shopSize: number | null;
  shopConfidence: string | null;
}

const LIST_COLUMNS = Prisma.sql`source, "outletKey", "outletName", principals, "salesRole", channel, segment, location, region, territory, route, "repName", "repCode", "teamLeader", "repStatus", "repRegion", "repSubRegion", "plannedRep", "matchId", "matchConfidence", "matchedSystems",
  latitude, longitude, "lastPurchaseDate", sales::double precision AS sales, transactions::int AS transactions, active,
  "firstPurchaseDate", COALESCE("periodsBought90", 0)::int AS "periodsBought90", COALESCE("periodsBought180", 0)::int AS "periodsBought180", COALESCE("principalCount", 1)::int AS "principalCount",
  "dominantPrincipal", "dominantShare", "sharedPrincipals", COALESCE("repCount", 0)::int AS "repCount", "repsByPrincipal", "teamLeadersByPrincipal",
  "territoryClean", "shopId", "shopSize", "shopConfidence"`;

type RawListRow = Omit<OutletListRow, "lastPurchaseDate" | "firstPurchaseDate"> & { lastPurchaseDate: Date | null; firstPurchaseDate: Date | null };

function toListRow(row: RawListRow): OutletListRow {
  return {
    ...row,
    sales: num(row.sales),
    transactions: num(row.transactions),
    lastPurchaseDate: row.lastPurchaseDate ? row.lastPurchaseDate.toISOString().slice(0, 10) : null,
    firstPurchaseDate: row.firstPurchaseDate ? row.firstPurchaseDate.toISOString().slice(0, 10) : null,
    periodsBought90: num(row.periodsBought90),
    periodsBought180: num(row.periodsBought180),
    principalCount: num(row.principalCount),
    repCount: num(row.repCount),
    shopSize: row.shopSize === null || row.shopSize === undefined ? null : num(row.shopSize),
    dominantShare: row.dominantShare === null || row.dominantShare === undefined ? null : Number(row.dominantShare),
  };
}

export async function listOutlets(filters: OutletFilters, scope: OutletScope, page: number): Promise<{ rows: OutletListRow[]; total: number; page: number; pageCount: number }> {
  const [count] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    ${cte(filters, scope)} SELECT COUNT(*)::int AS total FROM unit WHERE ${statusClause(filters.status)}
  `);
  const total = num(count?.total);
  const pageCount = Math.max(1, Math.ceil(total / OUTLET_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.$queryRaw<RawListRow[]>(Prisma.sql`
    ${cte(filters, scope)}
    SELECT ${LIST_COLUMNS} FROM unit WHERE ${statusClause(filters.status)}
    ORDER BY sales DESC, "outletName" ASC, "outletKey" ASC
    LIMIT ${OUTLET_PAGE_SIZE} OFFSET ${(current - 1) * OUTLET_PAGE_SIZE}
  `);
  return { rows: rows.map(toListRow), total, page: current, pageCount };
}

/** Every matching outlet, for the CSV export. */
export async function exportOutlets(filters: OutletFilters, scope: OutletScope, options: { withMix?: boolean } = {}): Promise<OutletListRow[]> {
  const rows = await prisma.$queryRaw<RawListRow[]>(Prisma.sql`
    ${cte(filters, scope, options.withMix ?? true)}
    SELECT ${LIST_COLUMNS} FROM unit WHERE ${statusClause(filters.status)}
    ORDER BY source ASC, principals ASC, "outletName" ASC, "outletKey" ASC
  `);
  return rows.map(toListRow);
}

export interface OutletFilterOptions {
  principals: string[];
  channels: string[];
  segments: string[];
  regions: string[];
  territories: string[];
  routes: string[];
  reps: string[];
}

/** The values each filter can take, within the session's own scope. */
export async function getOutletFilterOptions(scope: OutletScope): Promise<OutletFilterOptions> {
  const where = scope
    ? scope.principals.length > 0
      ? Prisma.sql`WHERE lower(principal) IN (${Prisma.join(scope.principals.map((name) => name.toLowerCase()))})`
      : Prisma.sql`WHERE FALSE`
    : Prisma.empty;
  const distinct = async (column: Prisma.Sql): Promise<string[]> => {
    const rows = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`
      SELECT DISTINCT ${column} AS value FROM "OutletUniverse" ${where} ORDER BY 1
    `);
    return rows.map((row) => row.value).filter((value): value is string => Boolean(value));
  };
  const [principals, channels, segments, regions, territories, routes, reps] = await Promise.all([
    distinct(Prisma.sql`principal`),
    distinct(Prisma.sql`channel`),
    distinct(Prisma.sql`segment`),
    distinct(Prisma.sql`region`),
    distinct(Prisma.sql`territory`),
    distinct(Prisma.sql`route`),
    distinct(Prisma.sql`"repName"`),
  ]);
  return { principals, channels, segments, regions, territories, routes, reps };
}

export interface UniverseTier {
  /** Outlets known to the universe (for the role, when split). */
  known: number;
  /** Bought within the activity window. */
  active: number;
  /** Active and bought on at least FREQUENT_MIN_PURCHASE_DAYS separate days in the last FREQUENT_WINDOW_DAYS. */
  frequent: number;
  /** Known but not active. */
  dormant: number;
}

export interface ActiveUniverseStatus {
  builtAt: string | null;
  activeWindowDays: number;
  frequentWindowDays: number;
  frequentMinDays: number;
  lostAfterDays: number;
  /** Distinct outlets, each counted once however many principals or roles it buys through. */
  all: UniverseTier & { lapsed: number; lost: number; noPurchase: number };
  /** An outlet reached through both roles counts in both, so these can sum to more than `all`. */
  primary: UniverseTier;
  secondary: UniverseTier;
}

/** The current active universe for the Executive Summary: distinct outlets across every
 *  principal (or one principal brand), split Primary / Secondary, into those actively
 *  buying, those buying at least twice in a month, and the dormant rest. */
export async function getActiveUniverseStatus(scope: OutletScope, principalKey: string | null): Promise<ActiveUniverseStatus> {
  const now = Date.now();
  const active = new Date(now - OUTLET_ACTIVE_WINDOW_DAYS * 86_400_000);
  const lost = new Date(now - DORMANT_LOST_AFTER_DAYS * 86_400_000);
  const filters: OutletFilters = {
    view: "general", status: "all", role: null, source: null, principal: null, principalKey, channel: null,
    segment: null, region: null, territory: null, route: null, rep: null, q: "",
  };
  // With one principal chosen, frequency is that principal's own purchase days; across all
  // principals it is the outlet's days in total (a day buying two principals is one day).
  const days = principalKey ? Prisma.sql`"purchaseDays30"` : Prisma.sql`"outletPurchaseDays30"`;
  const min = FREQUENT_MIN_PURCHASE_DAYS;

  const [rows, built] = await Promise.all([
    prisma.$queryRaw<Record<string, number>[]>(Prisma.sql`
      WITH base AS (SELECT * FROM "OutletUniverse" WHERE ${baseWhere(filters, scope)}),
      o AS (
        SELECT source, "outletKey", MAX("lastPurchaseDate") AS lpd, MAX(${days}) AS fdays,
          BOOL_OR("salesRole" = 'Primary Sales') AS hp,
          BOOL_OR("salesRole" = 'Secondary Sales') AS hs,
          COALESCE(BOOL_OR("lastPurchaseDate" >= ${active}), FALSE) AS act,
          COALESCE(BOOL_OR("salesRole" = 'Primary Sales' AND "lastPurchaseDate" >= ${active}), FALSE) AS ap,
          COALESCE(BOOL_OR("salesRole" = 'Secondary Sales' AND "lastPurchaseDate" >= ${active}), FALSE) AS asec,
          COALESCE(BOOL_OR("salesRole" = 'Primary Sales' AND "lastPurchaseDate" >= ${active} AND "purchaseDays30" >= ${min}), FALSE) AS fp,
          COALESCE(BOOL_OR("salesRole" = 'Secondary Sales' AND "lastPurchaseDate" >= ${active} AND "purchaseDays30" >= ${min}), FALSE) AS fs
        FROM base GROUP BY source, "outletKey"
      )
      SELECT COUNT(*)::int AS known,
        COUNT(*) FILTER (WHERE act)::int AS active,
        COUNT(*) FILTER (WHERE act AND fdays >= ${min})::int AS frequent,
        COUNT(*) FILTER (WHERE NOT act AND lpd IS NOT NULL AND lpd >= ${lost})::int AS lapsed,
        COUNT(*) FILTER (WHERE NOT act AND lpd IS NOT NULL AND lpd < ${lost})::int AS lost,
        COUNT(*) FILTER (WHERE lpd IS NULL)::int AS "noPurchase",
        COUNT(*) FILTER (WHERE hp)::int AS "knownP", COUNT(*) FILTER (WHERE ap)::int AS "activeP", COUNT(*) FILTER (WHERE fp)::int AS "frequentP",
        COUNT(*) FILTER (WHERE hs)::int AS "knownS", COUNT(*) FILTER (WHERE asec)::int AS "activeS", COUNT(*) FILTER (WHERE fs)::int AS "frequentS"
      FROM o
    `),
    prisma.$queryRaw<{ builtAt: Date | null }[]>(Prisma.sql`SELECT MAX("builtAt") AS "builtAt" FROM "OutletUniverse"`),
  ]);

  const r = rows[0] ?? {};
  const tier = (known: unknown, activeCount: unknown, frequent: unknown): UniverseTier => ({
    known: num(known),
    active: num(activeCount),
    frequent: num(frequent),
    dormant: Math.max(0, num(known) - num(activeCount)),
  });
  return {
    builtAt: built[0]?.builtAt ? built[0].builtAt.toISOString() : null,
    activeWindowDays: OUTLET_ACTIVE_WINDOW_DAYS,
    frequentWindowDays: FREQUENT_WINDOW_DAYS,
    frequentMinDays: FREQUENT_MIN_PURCHASE_DAYS,
    lostAfterDays: DORMANT_LOST_AFTER_DAYS,
    all: { ...tier(r.known, r.active, r.frequent), lapsed: num(r.lapsed), lost: num(r.lost), noPurchase: num(r.noPurchase) },
    primary: tier(r.knownP, r.activeP, r.frequentP),
    secondary: tier(r.knownS, r.activeS, r.frequentS),
  };
}
