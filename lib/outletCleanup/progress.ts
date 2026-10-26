// How far each team has got with the cleanup, against the target an admin sets, and how the teams rank.
// A team leader's outlets are the ones with a row under their name in the compiled universe; an outlet counts as reviewed once it has a cleanup entry
// (or has been marked open), whoever on the team saved it. Progress is cumulative: the target is the share reviewed by the end of the period.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { inActorScope } from "./access";
import { activeCutoffDate } from "./activity";
import { scopeSql } from "./data";
import { DEFAULT_TARGET_PCT, foldName, pct, rankTeams, type TeamProgress } from "./progressRank";
import type { CleanupActor } from "./types";

export { DEFAULT_TARGET_PCT, type TeamProgress };

/** A marked-open outlet nobody has settled for this many days is the admin's to allocate. */
export const OPEN_OUTLET_OVERDUE_DAYS = 14;

export interface ProgressReport {
  period: string;
  defaultTargetPct: number;
  teams: TeamProgress[];
  /** The teams the signed-in person works on (all of them for an admin). */
  mine: TeamProgress[];
  /** Distinct outlets in the person's scope, each counted once (an outlet several teams sell to is one outlet here but counts for each of those teams in `mine` and `teams`). */
  totals: {
    outlets: number;
    reviewed: number;
    validated: number;
    missingGeo: number;
    geoTagged: number;
    repsValidated: number;
    disowned: number;
    pctReviewed: number;
    /** Outlets bought in the last 90 days, and the dormant rest (older purchase or none on record). */
    active: number;
    dormant: number;
    /** Distinct shops after the duplicate merge, so outlets - shops is how many outlets are duplicates of another. */
    shops: number;
    /** The team rows added up: more than `outlets` by the outlets that more than one team sells to. */
    teamOutletRows: number;
  };
}

export const isPeriod = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The current month in Nairobi, as "YYYY-MM". */
export function currentPeriod(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }).slice(0, 7);
}

interface RawTeam {
  teamLeader: string;
  outlets: bigint;
  reviewed: bigint;
  validated: bigint;
  missing_geo: bigint;
  geo_tagged: bigint;
  reps_validated: bigint;
  disowned: bigint;
  active: bigint;
}

interface RawTotals extends RawTeam {
  shops: bigint;
}

const CACHE_MS = 15_000;
let cache: { at: number; value: Promise<RawTeam[]> } | null = null;

/** One row per team leader with the counts, from the universe and the cleanup tables. Cached for a few seconds: every login asks for it. */
export function loadTeamCounts(): Promise<RawTeam[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const value = prisma.$queryRaw<RawTeam[]>(Prisma.sql`
      WITH owned AS (
        SELECT o.source, o."outletKey", min(btrim(o."teamLeader")) AS "teamLeader",
               bool_or(o.latitude IS NOT NULL AND o.latitude <> 0 AND o.latitude BETWEEN -5 AND 5 AND o.longitude BETWEEN 33 AND 43) AS has_geo,
               max(o."lastPurchaseDate") AS lp
        FROM "OutletUniverse" o
        WHERE o."teamLeader" IS NOT NULL AND btrim(o."teamLeader") <> ''
        GROUP BY o.source, o."outletKey", lower(regexp_replace(btrim(o."teamLeader"), '\\s+', ' ', 'g'))
      )
      SELECT ow."teamLeader",
             count(*) AS outlets,
             count(*) FILTER (WHERE e.id IS NOT NULL OR EXISTS (SELECT 1 FROM "MarkedOpenOutlet" m WHERE m.source = ow.source AND m."outletKey" = ow."outletKey")) AS reviewed,
             count(*) FILTER (WHERE e.status IN ('VALIDATED', 'APPLIED')) AS validated,
             count(*) FILTER (WHERE NOT ow.has_geo AND e.latitude IS NULL) AS missing_geo,
             count(*) FILTER (WHERE e."geoTaggedAt" IS NOT NULL) AS geo_tagged,
             count(*) FILTER (WHERE e."repDecisions" IS NOT NULL AND jsonb_typeof(e."repDecisions") = 'array' AND jsonb_array_length(e."repDecisions") > 0) AS reps_validated,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "MarkedOpenOutlet" m WHERE m.source = ow.source AND m."outletKey" = ow."outletKey")) AS disowned,
             count(*) FILTER (WHERE ow.lp >= ${activeCutoffDate()}) AS active
      FROM owned ow
      LEFT JOIN "OutletCleanupEntry" e ON e.source = ow.source AND e."outletKey" = ow."outletKey"
      GROUP BY ow."teamLeader", lower(regexp_replace(btrim(ow."teamLeader"), '\\s+', ' ', 'g'))
    `);
    value.catch(() => {
      cache = null;
    });
    cache = { at: Date.now(), value };
  }
  return cache.value;
}

export function resetProgressCache(): void {
  cache = null;
  totalsCache.clear();
}

const totalsCache = new Map<string, { at: number; value: Promise<RawTotals> }>();

/** The same counts over the distinct outlets in a person's scope (all outlets for an admin, HOD or Director, including the few with no team leader). */
function loadScopeTotals(actor: CleanupActor): Promise<RawTotals> {
  const key = actor.teamLeaders === null ? "*" : [...actor.teamLeaders].map((n) => n.trim().toLowerCase()).sort().join("|");
  const cached = totalsCache.get(key);
  if (cached && Date.now() - cached.at <= CACHE_MS) return cached.value;
  const value = prisma
    .$queryRaw<RawTotals[]>(Prisma.sql`
      WITH owned AS (
        SELECT o.source, o."outletKey",
               bool_or(o.latitude IS NOT NULL AND o.latitude <> 0 AND o.latitude BETWEEN -5 AND 5 AND o.longitude BETWEEN 33 AND 43) AS has_geo,
               max(o."lastPurchaseDate") AS lp, max(o."shopId") AS shop
        FROM "OutletUniverse" o WHERE ${scopeSql(actor, "o")}
        GROUP BY o.source, o."outletKey"
      )
      SELECT '' AS "teamLeader",
             count(*) AS outlets,
             count(*) FILTER (WHERE e.id IS NOT NULL OR EXISTS (SELECT 1 FROM "MarkedOpenOutlet" m WHERE m.source = ow.source AND m."outletKey" = ow."outletKey")) AS reviewed,
             count(*) FILTER (WHERE e.status IN ('VALIDATED', 'APPLIED')) AS validated,
             count(*) FILTER (WHERE NOT ow.has_geo AND e.latitude IS NULL) AS missing_geo,
             count(*) FILTER (WHERE e."geoTaggedAt" IS NOT NULL) AS geo_tagged,
             count(*) FILTER (WHERE e."repDecisions" IS NOT NULL AND jsonb_typeof(e."repDecisions") = 'array' AND jsonb_array_length(e."repDecisions") > 0) AS reps_validated,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "MarkedOpenOutlet" m WHERE m.source = ow.source AND m."outletKey" = ow."outletKey")) AS disowned,
             count(*) FILTER (WHERE ow.lp >= ${activeCutoffDate()}) AS active,
             count(DISTINCT ow.shop) AS shops
      FROM owned ow
      LEFT JOIN "OutletCleanupEntry" e ON e.source = ow.source AND e."outletKey" = ow."outletKey"
    `)
    .then((rows) => rows[0]);
  value.catch(() => totalsCache.delete(key));
  totalsCache.set(key, { at: Date.now(), value });
  return value;
}

/** The target for each team leader in a period: a named row overrides the default row ("*"), which falls back to 100%. */
export async function loadTargets(period: string): Promise<{ defaultPct: number; byTeam: Map<string, number> }> {
  const rows = await prisma.cleanupTarget.findMany({ where: { period } });
  const byTeam = new Map<string, number>();
  let defaultPct = DEFAULT_TARGET_PCT;
  for (const row of rows) {
    if (row.teamLeader === "*") defaultPct = row.targetPct;
    else byTeam.set(foldName(row.teamLeader), row.targetPct);
  }
  return { defaultPct, byTeam };
}

export async function loadProgress(actor: CleanupActor, period = currentPeriod()): Promise<ProgressReport> {
  const [raw, targets, scope] = await Promise.all([loadTeamCounts(), loadTargets(period), loadScopeTotals(actor)]);
  const teams = rankTeams(
    raw.map((r) => ({
      teamLeader: r.teamLeader,
      outlets: Number(r.outlets),
      reviewed: Number(r.reviewed),
      validated: Number(r.validated),
      missingGeo: Number(r.missing_geo),
      geoTagged: Number(r.geo_tagged),
      repsValidated: Number(r.reps_validated),
      disowned: Number(r.disowned),
      active: Number(r.active),
      dormant: Number(r.outlets) - Number(r.active),
    })),
    targets
  );
  const mine = teams.filter((team) => inActorScope(actor, team.teamLeader));
  const outlets = Number(scope.outlets);
  const reviewed = Number(scope.reviewed);
  return {
    period,
    defaultTargetPct: targets.defaultPct,
    teams,
    mine,
    totals: {
      outlets,
      reviewed,
      validated: Number(scope.validated),
      missingGeo: Number(scope.missing_geo),
      geoTagged: Number(scope.geo_tagged),
      repsValidated: Number(scope.reps_validated),
      disowned: Number(scope.disowned),
      pctReviewed: pct(reviewed, outlets),
      active: Number(scope.active),
      dormant: outlets - Number(scope.active),
      shops: Number(scope.shops),
      teamOutletRows: mine.reduce((total, team) => total + team.outlets, 0),
    },
  };
}
