import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { OUTLET_ACTIVE_WINDOW_DAYS, OUTLET_SOURCES, type OutletSource } from "./normalize";

export type OutletView = "principal" | "general";
export type OutletStatus = "active" | "inactive" | "all";

export interface OutletFilters {
  /** "principal": one outlet per principal it buys (an outlet buying 3 principals is 3 rows).
   *  "general": every outlet counted once, however many principals it buys. */
  view: OutletView;
  status: OutletStatus;
  source: OutletSource | null;
  principal: string | null;
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
  return {
    view: params.get("view") === "general" ? "general" : "principal",
    status: status === "inactive" || status === "all" ? status : "active",
    source: (OUTLET_SOURCES as string[]).includes(source ?? "") ? (source as OutletSource) : null,
    principal: text(params.get("principal")),
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

function baseWhere(filters: OutletFilters, scope: OutletScope): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope) {
    parts.push(scope.principals.length > 0 ? Prisma.sql`lower(principal) IN (${Prisma.join(scope.principals.map((name) => name.toLowerCase()))})` : Prisma.sql`FALSE`);
  }
  if (filters.source) parts.push(Prisma.sql`source = ${filters.source}`);
  if (filters.principal) parts.push(Prisma.sql`lower(principal) = ${filters.principal.toLowerCase()}`);
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
function cte(filters: OutletFilters, scope: OutletScope): Prisma.Sql {
  const cutoff = activeCutoff();
  const base = Prisma.sql`base AS (SELECT * FROM "OutletUniverse" WHERE ${baseWhere(filters, scope)})`;
  if (filters.view === "principal") {
    return Prisma.sql`WITH ${base},
      unit AS (
        SELECT source, "outletKey", principal, principal AS principals, "outletName", channel, segment, location, region, territory, route,
               "repName", latitude, longitude, "lastPurchaseDate", sales, transactions,
               COALESCE("lastPurchaseDate" >= ${cutoff}, FALSE) AS active
        FROM base
      )`;
  }
  return Prisma.sql`WITH ${base},
    head AS (
      SELECT DISTINCT ON (source, "outletKey") source, "outletKey", "outletName", channel, segment, location, region, territory, route,
             "repName", latitude, longitude
      FROM base
      ORDER BY source, "outletKey", "lastPurchaseDate" DESC NULLS LAST, principal
    ),
    agg AS (
      SELECT source, "outletKey", MAX("lastPurchaseDate") AS "lastPurchaseDate", SUM(sales) AS sales, SUM(transactions) AS transactions,
             STRING_AGG(principal, ', ' ORDER BY principal) AS principals
      FROM base GROUP BY source, "outletKey"
    ),
    unit AS (
      SELECT h.source, h."outletKey", a.principals AS principal, a.principals, h."outletName", h.channel, h.segment, h.location, h.region, h.territory, h.route,
             h."repName", h.latitude, h.longitude, a."lastPurchaseDate", a.sales, a.transactions,
             COALESCE(a."lastPurchaseDate" >= ${cutoff}, FALSE) AS active
      FROM head h JOIN agg a USING (source, "outletKey")
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
export interface BreakdownRow {
  name: string;
  active: number;
  total: number;
}

export interface PrincipalBreakdownRow extends BreakdownRow {
  source: string;
  sales: number;
}

export interface OutletUniverseSummary {
  builtAt: string | null;
  activeWindowDays: number;
  totals: { total: number; active: number; inactive: number; withCoordinates: number; sales: number; transactions: number };
  /** Distinct outlets under the same filters, whichever view is selected (an
   *  outlet buying several principals counts once). In the principal view
   *  `totals` counts outlet-principal pairs instead. */
  distinct: { total: number; active: number };
  bySource: BreakdownRow[];
  byPrincipal: PrincipalBreakdownRow[];
  byRegion: BreakdownRow[];
  byTerritory: BreakdownRow[];
  byChannel: BreakdownRow[];
  bySegment: BreakdownRow[];
  byRep: BreakdownRow[];
}

const num = (value: unknown) => Number(value ?? 0);

async function breakdown(filters: OutletFilters, scope: OutletScope, column: Prisma.Sql, limit?: number): Promise<BreakdownRow[]> {
  const rows = await prisma.$queryRaw<{ name: string; active: number; total: number }[]>(Prisma.sql`
    ${cte(filters, scope)}
    SELECT COALESCE(NULLIF(BTRIM(${column}), ''), 'Unspecified') AS name,
           COUNT(*) FILTER (WHERE active)::int AS active,
           COUNT(*)::int AS total
    FROM unit
    GROUP BY 1 ORDER BY active DESC, total DESC, name ASC
    ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
  `);
  return rows.map((row) => ({ name: row.name, active: num(row.active), total: num(row.total) }));
}

export async function getOutletUniverseSummary(filters: OutletFilters, scope: OutletScope): Promise<OutletUniverseSummary> {
  // The principal panel always counts principal-grain rows, even in the general
  // view: it answers "how many active outlets does each principal have".
  const principalFilters: OutletFilters = { ...filters, view: "principal" };
  const [totals, distinct, builtAt, bySource, byPrincipal, byRegion, byTerritory, byChannel, bySegment, byRep] = await Promise.all([
    prisma.$queryRaw<{ total: number; active: number; withCoordinates: number; sales: number; transactions: number }[]>(Prisma.sql`
      ${cte(filters, scope)}
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active,
             COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int AS "withCoordinates",
             COALESCE(SUM(sales), 0)::double precision AS sales, COALESCE(SUM(transactions), 0)::double precision AS transactions
      FROM unit WHERE ${statusClause(filters.status)}
    `),
    prisma.$queryRaw<{ total: number; active: number }[]>(Prisma.sql`
      ${cte({ ...filters, view: "general" }, scope)}
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active FROM unit
    `),
    prisma.$queryRaw<{ builtAt: Date | null }[]>(Prisma.sql`SELECT MAX("builtAt") AS "builtAt" FROM "OutletUniverse"`),
    breakdown(filters, scope, Prisma.sql`source`),
    prisma.$queryRaw<{ name: string; source: string; active: number; total: number; sales: number }[]>(Prisma.sql`
      ${cte(principalFilters, scope)}
      SELECT principal AS name, source, COUNT(*) FILTER (WHERE active)::int AS active, COUNT(*)::int AS total,
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

  const t = totals[0];
  const total = num(t?.total);
  const active = num(t?.active);
  return {
    builtAt: builtAt[0]?.builtAt ? builtAt[0].builtAt.toISOString() : null,
    activeWindowDays: OUTLET_ACTIVE_WINDOW_DAYS,
    totals: { total, active, inactive: total - active, withCoordinates: num(t?.withCoordinates), sales: num(t?.sales), transactions: num(t?.transactions) },
    distinct: { total: num(distinct[0]?.total), active: num(distinct[0]?.active) },
    bySource,
    byPrincipal: byPrincipal.map((row) => ({ name: row.name, source: row.source, active: num(row.active), total: num(row.total), sales: num(row.sales) })),
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
  channel: string;
  segment: string;
  location: string;
  region: string;
  territory: string;
  route: string | null;
  repName: string | null;
  latitude: number | null;
  longitude: number | null;
  lastPurchaseDate: string | null;
  sales: number;
  transactions: number;
  active: boolean;
}

const LIST_COLUMNS = Prisma.sql`source, "outletKey", "outletName", principals, channel, segment, location, region, territory, route, "repName",
  latitude, longitude, "lastPurchaseDate", sales::double precision AS sales, transactions::int AS transactions, active`;

function toListRow(row: Omit<OutletListRow, "lastPurchaseDate"> & { lastPurchaseDate: Date | null }): OutletListRow {
  return { ...row, sales: num(row.sales), transactions: num(row.transactions), lastPurchaseDate: row.lastPurchaseDate ? row.lastPurchaseDate.toISOString().slice(0, 10) : null };
}

export async function listOutlets(filters: OutletFilters, scope: OutletScope, page: number): Promise<{ rows: OutletListRow[]; total: number; page: number; pageCount: number }> {
  const [count] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    ${cte(filters, scope)} SELECT COUNT(*)::int AS total FROM unit WHERE ${statusClause(filters.status)}
  `);
  const total = num(count?.total);
  const pageCount = Math.max(1, Math.ceil(total / OUTLET_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.$queryRaw<(Omit<OutletListRow, "lastPurchaseDate"> & { lastPurchaseDate: Date | null })[]>(Prisma.sql`
    ${cte(filters, scope)}
    SELECT ${LIST_COLUMNS} FROM unit WHERE ${statusClause(filters.status)}
    ORDER BY sales DESC, "outletName" ASC, "outletKey" ASC
    LIMIT ${OUTLET_PAGE_SIZE} OFFSET ${(current - 1) * OUTLET_PAGE_SIZE}
  `);
  return { rows: rows.map(toListRow), total, page: current, pageCount };
}

/** Every matching outlet, for the CSV export. */
export async function exportOutlets(filters: OutletFilters, scope: OutletScope): Promise<OutletListRow[]> {
  const rows = await prisma.$queryRaw<(Omit<OutletListRow, "lastPurchaseDate"> & { lastPurchaseDate: Date | null })[]>(Prisma.sql`
    ${cte(filters, scope)}
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
