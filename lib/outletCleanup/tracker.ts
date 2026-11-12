// The cleanup tracker: what the teams actually did, day by day and person by person, read from the cleanup log, and where every saved outlet stands now (submitted
// by a rep, saved by the team, validated, applied, sent back) per team leader. Progress against the target is lib/outletCleanup/progress.ts; this is the activity
// behind it. Everything is limited to the person's own teams (all of them for an admin, HOD or Director).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { scopeSql } from "./data";
import type { CleanupActor } from "./types";

import { shapeTracker, type RawDay, type RawPerson, type RawTeam, type TrackerReport } from "./trackerShape";

export * from "./trackerShape";

// Log rows that are about an outlet (targets and routes are logged under "-").
const OUTLET_WORK = Prisma.sql`l.source <> '-' AND l.action NOT IN ('TARGET', 'ROUTE')`;
const LOCAL_DAY = Prisma.sql`((l.at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Nairobi')::date`;

export async function loadTracker(actor: CleanupActor, range: { from: string; to: string }): Promise<TrackerReport> {
  const scope = scopeSql(actor, "e");
  const end = new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const inRange = Prisma.sql`${LOCAL_DAY} >= ${range.from}::date AND ${LOCAL_DAY} < ${end}::date`;
  // An admin, HOD or Director sees every log row (scopeSql is TRUE for them), including outlets marked open that never got an entry.
  const base = Prisma.sql`FROM "OutletCleanupLog" l LEFT JOIN "OutletCleanupEntry" e ON e.source = l.source AND e."outletKey" = l."outletKey" WHERE ${OUTLET_WORK} AND ${inRange} AND ${scope}`;

  const [days, people, distinct, teams] = await Promise.all([
    prisma.$queryRaw<RawDay[]>(Prisma.sql`
      SELECT to_char(${LOCAL_DAY}, 'YYYY-MM-DD') AS date,
             count(DISTINCT l.source || '|' || l."outletKey") AS outlets,
             count(DISTINCT l.source || '|' || l."outletKey") FILTER (WHERE l."actorRole" = 'REP') AS rep_outlets,
             count(*) FILTER (WHERE l.action = 'GEO_TAG') AS geo_tags,
             count(*) FILTER (WHERE l.action = 'VALIDATE') AS validated,
             count(*) FILTER (WHERE l.action = 'REJECT') AS sent_back
      ${base}
      GROUP BY 1`),
    prisma.$queryRaw<RawPerson[]>(Prisma.sql`
      SELECT l.actor, min(l."actorRole") AS role,
             count(DISTINCT l.source || '|' || l."outletKey") AS outlets, count(*) AS actions,
             count(*) FILTER (WHERE l.action = 'GEO_TAG') AS geo_tags,
             count(DISTINCT ${LOCAL_DAY}) AS days, max(l.at) AS last_at
      ${base}
      GROUP BY l.actor
      ORDER BY outlets DESC
      LIMIT 300`),
    prisma.$queryRaw<{ outlets: bigint; rep_outlets: bigint }[]>(Prisma.sql`
      SELECT count(DISTINCT l.source || '|' || l."outletKey") AS outlets,
             count(DISTINCT l.source || '|' || l."outletKey") FILTER (WHERE l."actorRole" = 'REP') AS rep_outlets
      ${base}`),
    // Where every saved outlet stands now, per team leader (not limited to the dates: it is the state of the work).
    prisma.$queryRaw<RawTeam[]>(Prisma.sql`
      SELECT coalesce(nullif(btrim(e."teamLeader"), ''), 'No team leader') AS "teamLeader",
             count(*) FILTER (WHERE e.status = 'SUBMITTED') AS submitted,
             count(*) FILTER (WHERE e.status = 'REVIEWED') AS reviewed,
             count(*) FILTER (WHERE e.status = 'VALIDATED') AS validated,
             count(*) FILTER (WHERE e.status = 'APPLIED') AS applied,
             count(*) FILTER (WHERE e.status = 'REJECTED') AS sent_back,
             count(*) FILTER (WHERE e."geoTaggedAt" IS NOT NULL) AS geo_tagged
      FROM "OutletCleanupEntry" e
      WHERE ${scope}
      GROUP BY 1`),
  ]);
  return shapeTracker(range, { days, people, teams, distinct: distinct[0] ?? { outlets: BigInt(0), rep_outlets: BigInt(0) } });
}
