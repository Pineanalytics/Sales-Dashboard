// Reads for the outlet cleanup: the option lists the form chooses from, the queue of a person's outlets, and one outlet with everything the form needs.
// The universe (OutletUniverse) is the source of the prefilled values; what a team leader has verified lives in OutletCleanupEntry and is laid over it.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPlaceholderPlace } from "@/lib/outletUniverse/tiering";
import type { OutletSource } from "@/lib/outletUniverse/normalize";
import { similarity } from "@/lib/universeAnalysis/similarity";
import { cleanName } from "@/lib/universeAnalysis/dedup";
import { DEFAULT_DEDUP } from "@/lib/universeAnalysis/config";
import { inActorScope } from "./access";
import { haversineM } from "./validate";
import {
  IDENTIFICATION_FIELDS,
  QUEUE_PAGE_SIZE,
  type CleanupActor,
  type CleanupOptions,
  type DuplicateCandidate,
  type IdentificationField,
  type LockableField,
  type OutletDetail,
  type OutletRepRow,
  type QueueRow,
  type RepDecision,
  type RepOption,
  type ReviewState,
} from "./types";

const OPTIONS_TTL_MS = 10 * 60_000;
let optionsCache: { at: number; value: Promise<CleanupOptions> } | null = null;

/** The values the form may choose from: the ones already in the universe, so a field is only ever amended to something that exists. */
export function loadCleanupOptions(): Promise<CleanupOptions> {
  if (!optionsCache || Date.now() - optionsCache.at > OPTIONS_TTL_MS) {
    const value = (async (): Promise<CleanupOptions> => {
      const rows = await prisma.$queryRaw<{ kind: string; value: string }[]>(Prisma.sql`
        SELECT 'region' AS kind, region AS value FROM "OutletUniverse" WHERE region IS NOT NULL AND btrim(region) <> '' GROUP BY region
        UNION ALL SELECT 'territory', COALESCE("territoryClean", territory) FROM "OutletUniverse" WHERE COALESCE("territoryClean", territory) IS NOT NULL AND btrim(COALESCE("territoryClean", territory)) <> '' GROUP BY 2
        UNION ALL SELECT 'channel', channel FROM "OutletUniverse" WHERE channel IS NOT NULL AND btrim(channel) <> '' GROUP BY channel
        UNION ALL SELECT 'type', segment FROM "OutletUniverse" WHERE segment IS NOT NULL AND btrim(segment) <> '' GROUP BY segment
      `);
      const pick = (kind: string) => [...new Set(rows.filter((r) => r.kind === kind && !isPlaceholderPlace(r.value)).map((r) => r.value.trim()))].sort((a, b) => a.localeCompare(b));
      return { regions: pick("region"), territories: pick("territory"), channels: pick("channel"), customerTypes: pick("type") };
    })();
    value.catch(() => {
      optionsCache = null;
    });
    optionsCache = { at: Date.now(), value };
  }
  return optionsCache.value;
}

/** SQL for "this outlet row belongs to a team this person works on" (always true for someone who sees all). */
function scopeSql(actor: CleanupActor, alias: string): Prisma.Sql {
  if (actor.teamLeaders === null) return Prisma.sql`TRUE`;
  if (actor.teamLeaders.length === 0) return Prisma.sql`FALSE`;
  const names = actor.teamLeaders.map((n) => n.trim().replace(/\s+/g, " ").toLowerCase());
  return Prisma.sql`lower(regexp_replace(btrim(${Prisma.raw(alias)}."teamLeader"), '\\s+', ' ', 'g')) IN (${Prisma.join(names)})`;
}

export type QueueState = "all" | "todo" | "unreviewed" | "rejected" | "reviewed" | "needs-geo" | "duplicates" | "disowned";

export interface QueueFilters {
  state: QueueState;
  q: string;
  region: string | null;
  territory: string | null;
  principal: string | null;
  teamLeader: string | null;
}

export function parseQueueFilters(params: URLSearchParams): QueueFilters {
  const states: QueueState[] = ["all", "todo", "unreviewed", "rejected", "reviewed", "needs-geo", "duplicates", "disowned"];
  const state = params.get("state") as QueueState;
  const text = (key: string, max = 100) => {
    const v = (params.get(key) ?? "").trim().slice(0, max);
    return v === "" ? null : v;
  };
  return { state: states.includes(state) ? state : "todo", q: text("q", 80) ?? "", region: text("region"), territory: text("territory"), principal: text("principal"), teamLeader: text("teamLeader") };
}

const HAS_GEO = Prisma.sql`(o.latitude IS NOT NULL AND o.latitude <> 0 AND o.latitude BETWEEN -5 AND 5 AND o.longitude BETWEEN 33 AND 43)`;

interface RawQueueRow {
  source: string;
  outletKey: string;
  outletName: string;
  principals: string;
  region: string;
  territory: string;
  channel: string;
  customerType: string;
  teamLeaders: string | null;
  hasGeo: boolean;
  shopSize: number;
  state: string;
}

/** The outlets a person works on, one row each, with what they have verified laid over the universe's values and the review state. */
export async function listQueue(actor: CleanupActor, filters: QueueFilters, page: number): Promise<{ rows: QueueRow[]; total: number; page: number; pageCount: number }> {
  const stateWhere: Record<QueueState, Prisma.Sql> = {
    all: Prisma.sql`TRUE`,
    todo: Prisma.sql`state IN ('UNREVIEWED', 'REJECTED')`,
    unreviewed: Prisma.sql`state = 'UNREVIEWED'`,
    rejected: Prisma.sql`state = 'REJECTED'`,
    reviewed: Prisma.sql`state IN ('REVIEWED', 'VALIDATED', 'APPLIED')`,
    "needs-geo": Prisma.sql`NOT "hasGeo" AND state <> 'DISOWNED'`,
    duplicates: Prisma.sql`"shopSize" > 1`,
    disowned: Prisma.sql`state = 'DISOWNED'`,
  };
  const parts: Prisma.Sql[] = [stateWhere[filters.state]];
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(Prisma.sql`("outletName" ILIKE ${like} OR "outletKey" ILIKE ${like})`);
  }
  if (filters.region) parts.push(Prisma.sql`region = ${filters.region}`);
  if (filters.territory) parts.push(Prisma.sql`territory = ${filters.territory}`);
  if (filters.principal) parts.push(Prisma.sql`principals ILIKE ${`%${filters.principal}%`}`);
  if (filters.teamLeader) parts.push(Prisma.sql`"teamLeaders" ILIKE ${`%${filters.teamLeader}%`}`);
  const where = Prisma.join(parts, " AND ");

  const base = Prisma.sql`
    WITH mine AS (
      SELECT o.source, o."outletKey" FROM "OutletUniverse" o WHERE ${scopeSql(actor, "o")} GROUP BY o.source, o."outletKey"
    ),
    agg AS (
      SELECT o.source, o."outletKey", MIN(o."outletName") AS "outletName", STRING_AGG(DISTINCT o.principal, ', ') AS principals,
             MIN(o.region) AS region, MIN(COALESCE(o."territoryClean", o.territory)) AS territory, MIN(o.channel) AS channel, MIN(o.segment) AS "customerType",
             STRING_AGG(DISTINCT NULLIF(btrim(o."teamLeader"), ''), ', ') AS "teamLeaders", BOOL_OR(${HAS_GEO}) AS "hasGeo",
             MAX(COALESCE(o."shopSize", 1))::int AS "shopSize", SUM(o.sales)::double precision AS sales
      FROM "OutletUniverse" o JOIN mine m ON m.source = o.source AND m."outletKey" = o."outletKey"
      GROUP BY o.source, o."outletKey"
    ),
    q AS (
      SELECT a.source, a."outletKey", a."outletName", a.principals,
             COALESCE(e.region, a.region) AS region, COALESCE(e.territory, a.territory) AS territory, COALESCE(e.channel, a.channel) AS channel,
             COALESCE(e."customerType", a."customerType") AS "customerType", a."teamLeaders", (a."hasGeo" OR e.latitude IS NOT NULL) AS "hasGeo", a."shopSize", a.sales,
             CASE WHEN mo.id IS NOT NULL THEN 'DISOWNED' WHEN e.id IS NULL THEN 'UNREVIEWED' ELSE e.status END AS state
      FROM agg a
      LEFT JOIN "OutletCleanupEntry" e ON e.source = a.source AND e."outletKey" = a."outletKey"
      LEFT JOIN "MarkedOpenOutlet" mo ON mo.source = a.source AND mo."outletKey" = a."outletKey" AND mo.status IN ('OPEN', 'UNCLAIMED')
    )`;

  const [count] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`${base} SELECT COUNT(*)::int AS total FROM q WHERE ${where}`);
  const total = Number(count?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.$queryRaw<RawQueueRow[]>(Prisma.sql`
    ${base}
    SELECT source, "outletKey", "outletName", principals, region, territory, channel, "customerType", "teamLeaders", "hasGeo", "shopSize", state FROM q WHERE ${where}
    ORDER BY CASE state WHEN 'UNREVIEWED' THEN 0 WHEN 'REJECTED' THEN 1 WHEN 'REVIEWED' THEN 2 ELSE 3 END, "hasGeo" ASC, sales DESC NULLS LAST, "outletName" ASC, "outletKey" ASC
    LIMIT ${QUEUE_PAGE_SIZE} OFFSET ${(current - 1) * QUEUE_PAGE_SIZE}
  `);
  return {
    rows: rows.map((r) => ({
      source: r.source as OutletSource,
      outletKey: r.outletKey,
      outletName: r.outletName,
      principals: r.principals,
      region: r.region ?? "",
      territory: r.territory ?? "",
      channel: r.channel ?? "",
      customerType: r.customerType ?? "",
      teamLeaders: r.teamLeaders ?? "",
      hasGeo: Boolean(r.hasGeo),
      shopSize: Number(r.shopSize ?? 1),
      state: r.state as ReviewState,
    })),
    total,
    page: current,
    pageCount,
  };
}

/** The reps a selling rep can be changed to for each principal: the synced roster's active reps of that principal. */
export async function loadRepOptions(principals: string[]): Promise<Record<string, RepOption[]>> {
  if (principals.length === 0) return {};
  const reps = await prisma.employeeMaster.findMany({
    where: { active: true, absolutePrincipal: { in: principals, mode: "insensitive" } },
    select: { employeeCode: true, pineName: true, absolutePrincipal: true, teamLeader: true },
    orderBy: { pineName: "asc" },
  });
  const out: Record<string, RepOption[]> = {};
  for (const principal of principals) {
    out[principal] = reps
      .filter((r) => r.absolutePrincipal.toLowerCase() === principal.toLowerCase())
      .map((r) => ({ code: r.employeeCode, name: r.pineName, teamLeader: r.teamLeader }));
  }
  return out;
}

/** The team leaders an outlet can be offered to: every real team leader on the roster (the caller removes their own). */
export async function loadTeamLeaderOptions(): Promise<string[]> {
  const leaders = await prisma.teamLeader.findMany({ where: { kind: { in: ["TEAM_LEADER", "SUPERVISOR_TEAM", "KEY_ACCOUNTS"] } }, select: { name: true }, orderBy: { name: "asc" } });
  return leaders.map((l) => l.name);
}

interface RawUniverseRow {
  principal: string;
  outletName: string;
  region: string;
  territory: string;
  territoryClean: string | null;
  channel: string;
  segment: string;
  repName: string | null;
  repCode: string | null;
  teamLeader: string | null;
  latitude: number | null;
  longitude: number | null;
  shopId: string | null;
  shopSize: number | null;
  shopConfidence: string | null;
}

const validPoint = (lat: number | null, lon: number | null): boolean => lat !== null && lon !== null && lat !== 0 && lat >= -5 && lat <= 5 && lon >= 33 && lon <= 43;

/** Everything the form needs for one outlet, or null when the outlet does not exist or is not one this person works on. */
export async function loadOutletDetail(actor: CleanupActor, source: OutletSource, outletKey: string): Promise<OutletDetail | null> {
  const universe = await prisma.$queryRaw<RawUniverseRow[]>(Prisma.sql`
    SELECT principal, "outletName", region, territory, "territoryClean", channel, segment, "repName", "repCode", "teamLeader", latitude, longitude, "shopId", "shopSize", "shopConfidence"
    FROM "OutletUniverse" WHERE source = ${source} AND "outletKey" = ${outletKey} ORDER BY principal
  `);
  if (universe.length === 0) return null;
  const lead = universe[0];
  const inScope = actor.teamLeaders === null || universe.some((r) => inActorScope(actor, r.teamLeader));
  if (!inScope) return null;

  const [entry, open, decisions, logs, options, teamLeaderOptions] = await Promise.all([
    prisma.outletCleanupEntry.findUnique({ where: { source_outletKey: { source, outletKey } } }),
    prisma.markedOpenOutlet.findFirst({ where: { source, outletKey, status: { in: ["OPEN", "UNCLAIMED"] } }, include: { candidates: true }, orderBy: { markedAt: "desc" } }),
    prisma.outletDuplicateDecision.findMany({ where: { OR: [{ aSource: source, aKey: outletKey }, { bSource: source, bKey: outletKey }] } }),
    prisma.outletCleanupLog.findMany({ where: { source, outletKey }, orderBy: { at: "desc" }, take: 8 }),
    loadCleanupOptions(),
    loadTeamLeaderOptions(),
  ]);

  const principals = universe.map((r) => r.principal);
  const [repOptions, near] = await Promise.all([loadRepOptions(principals), loadDuplicateCandidates(source, outletKey, lead, universe)]);

  const point = universe.find((r) => validPoint(r.latitude, r.longitude));
  const current: Record<IdentificationField, string> = {
    region: lead.region ?? "",
    territory: lead.territoryClean ?? lead.territory ?? "",
    channel: lead.channel ?? "",
    customerType: lead.segment ?? "",
    contactName: "",
    contactPhone: "",
  };
  const verified: Partial<Record<IdentificationField, string>> = {};
  if (entry) for (const field of IDENTIFICATION_FIELDS) if (entry[field]) verified[field] = entry[field] as string;

  const state: ReviewState = open ? "DISOWNED" : entry ? (entry.status as ReviewState) : "UNREVIEWED";
  const reps: OutletRepRow[] = universe.map((r) => ({ principal: r.principal, rep: r.repName, repCode: r.repCode, teamLeader: r.teamLeader, editable: actor.teamLeaders === null || inActorScope(actor, r.teamLeader) }));
  const hasOwnRow = reps.some((r) => r.editable);
  const taggedGeo = entry?.latitude !== null && entry?.latitude !== undefined;

  return {
    source,
    outletKey,
    outletName: lead.outletName,
    state,
    current,
    verified,
    geo: {
      latitude: taggedGeo ? (entry?.latitude ?? null) : (point?.latitude ?? null),
      longitude: taggedGeo ? (entry?.longitude ?? null) : (point?.longitude ?? null),
      taggedAt: entry?.geoTaggedAt ? entry.geoTaggedAt.toISOString() : null,
      taggedBy: entry?.geoTaggedBy ?? null,
      accuracyM: entry?.geoAccuracyM ?? null,
      missing: !taggedGeo && !point,
    },
    reps,
    repDecisions: Array.isArray(entry?.repDecisions) ? (entry?.repDecisions as unknown as RepDecision[]) : [],
    lockedFields: (entry?.lockedFields ?? []) as LockableField[],
    confirmedAsIs: entry?.confirmedAsIs ?? false,
    shop: { shopId: lead.shopId, shopSize: Number(lead.shopSize ?? 1), confidence: lead.shopConfidence },
    duplicates: near.map((c) => {
      const d = decisions.find((x) => (x.aSource === c.source && x.aKey === c.outletKey) || (x.bSource === c.source && x.bKey === c.outletKey));
      return { ...c, decision: d ? (d.decision as "MERGE" | "NOT_DUPLICATE") : null };
    }),
    openStatus: open ? { status: open.status, candidates: open.candidates.map((c) => ({ teamLeader: c.teamLeader, response: c.response })) } : null,
    canEdit: actor.canReview && hasOwnRow && state !== "DISOWNED",
    canUnlock: actor.isAdmin || actor.role === "SUPERVISOR",
    options,
    repOptions,
    teamLeaderOptions: teamLeaderOptions.filter((n) => !actor.teamLeaders?.some((mine) => mine.toLowerCase() === n.toLowerCase())),
    history: logs.map((l) => ({ at: l.at.toISOString(), actor: l.actor, action: l.action })),
  };
}

/** Other outlets that could be the same shop: those already merged into this one's shop, and nearby ones (within about 200 m) with a similar name. */
async function loadDuplicateCandidates(source: OutletSource, outletKey: string, lead: RawUniverseRow, universe: RawUniverseRow[]): Promise<Omit<DuplicateCandidate, "decision">[]> {
  const out = new Map<string, Omit<DuplicateCandidate, "decision">>();
  const key = (s: string, k: string) => `${s}|${k}`;
  if (lead.shopId) {
    const members = await prisma.$queryRaw<{ source: string; outletKey: string; outletName: string; principals: string; territory: string; latitude: number | null; longitude: number | null }[]>(Prisma.sql`
      SELECT source, "outletKey", MIN("outletName") AS "outletName", STRING_AGG(DISTINCT principal, ', ') AS principals, MIN(COALESCE("territoryClean", territory)) AS territory,
             MIN(latitude) AS latitude, MIN(longitude) AS longitude
      FROM "OutletUniverse" WHERE "shopId" = ${lead.shopId} AND NOT (source = ${source} AND "outletKey" = ${outletKey}) GROUP BY source, "outletKey"
    `);
    const here = universe.find((r) => validPoint(r.latitude, r.longitude));
    for (const m of members) {
      out.set(key(m.source, m.outletKey), {
        source: m.source as OutletSource,
        outletKey: m.outletKey,
        outletName: m.outletName,
        principals: m.principals,
        territory: m.territory ?? "",
        distanceM: here && validPoint(m.latitude, m.longitude) ? Math.round(haversineM(here.latitude as number, here.longitude as number, m.latitude as number, m.longitude as number)) : null,
        inSameShop: true,
      });
    }
  }
  const here = universe.find((r) => validPoint(r.latitude, r.longitude));
  if (here) {
    const box = 0.002;
    const nearby = await prisma.$queryRaw<{ source: string; outletKey: string; outletName: string; principals: string; territory: string; latitude: number; longitude: number }[]>(Prisma.sql`
      SELECT source, "outletKey", MIN("outletName") AS "outletName", STRING_AGG(DISTINCT principal, ', ') AS principals, MIN(COALESCE("territoryClean", territory)) AS territory,
             MIN(latitude) AS latitude, MIN(longitude) AS longitude
      FROM "OutletUniverse"
      WHERE latitude BETWEEN ${(here.latitude as number) - box} AND ${(here.latitude as number) + box} AND longitude BETWEEN ${(here.longitude as number) - box} AND ${(here.longitude as number) + box}
        AND NOT (source = ${source} AND "outletKey" = ${outletKey})
      GROUP BY source, "outletKey" LIMIT 300
    `);
    const mine = cleanName(lead.outletName, DEFAULT_DEDUP.fillerRegex);
    for (const m of nearby) {
      const k = key(m.source, m.outletKey);
      if (out.has(k)) continue;
      const theirs = cleanName(m.outletName, DEFAULT_DEDUP.fillerRegex);
      if (!mine || !theirs || similarity(mine, theirs) < 0.6) continue;
      out.set(k, {
        source: m.source as OutletSource,
        outletKey: m.outletKey,
        outletName: m.outletName,
        principals: m.principals,
        territory: m.territory ?? "",
        distanceM: Math.round(haversineM(here.latitude as number, here.longitude as number, m.latitude, m.longitude)),
        inSameShop: false,
      });
    }
  }
  return [...out.values()].sort((a, b) => Number(b.inSameShop) - Number(a.inSameShop) || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)).slice(0, 12);
}
