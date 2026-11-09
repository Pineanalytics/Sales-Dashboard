// The routes a team leader has named, with how many outlets each holds, and naming a new one. A route is usually named after the major locations it covers ("Imara Daima-Fedha").
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPlaceholderPlace } from "@/lib/outletUniverse/tiering";
import { inActorScope } from "./access";
import { CleanupError } from "./actions";
import { loadCleanupOptions, loadTeamLeaderOptions } from "./data";
import type { CleanupActor } from "./types";
import { cleanRouteName } from "./validate";

const fold = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export interface RouteRow {
  id: string;
  teamLeader: string;
  name: string;
  locations: string[];
  createdBy: string;
  outlets: number;
}

/** The routes of the team leaders this person works on (all of them for an admin, HOD or Director), with the outlets validated onto each. */
export async function listRoutes(actor: CleanupActor): Promise<{ routes: RouteRow[]; teamLeaders: string[] }> {
  const [routes, counts, leaders] = await Promise.all([
    prisma.cleanupRoute.findMany({ orderBy: [{ teamLeader: "asc" }, { name: "asc" }] }),
    prisma.$queryRaw<{ tl: string; route: string; outlets: bigint }[]>(Prisma.sql`
      SELECT lower(btrim(e."teamLeader")) AS tl, d->>'routeName' AS route, count(DISTINCT e.id) AS outlets
      FROM "OutletCleanupEntry" e, jsonb_array_elements(CASE WHEN jsonb_typeof(e."repDecisions") = 'array' THEN e."repDecisions" ELSE '[]'::jsonb END) d
      WHERE d->>'routeName' IS NOT NULL GROUP BY 1, 2`),
    loadTeamLeaderOptions(),
  ]);
  const held = new Map(counts.map((c) => [`${c.tl}|${fold(c.route)}`, Number(c.outlets)]));
  return {
    routes: routes
      .filter((r) => inActorScope(actor, r.teamLeader))
      .map((r) => ({ id: r.id, teamLeader: r.teamLeader, name: r.name, locations: r.locations, createdBy: r.createdBy, outlets: held.get(`${fold(r.teamLeader)}|${fold(r.name)}`) ?? 0 })),
    teamLeaders: leaders.filter((n) => actor.isAdmin || inActorScope(actor, n)),
  };
}

/** The places a team leader's outlets sit in, the busiest first: what a route can be named after. */
export async function loadRouteLocations(teamLeader: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ place: string }[]>(Prisma.sql`
    SELECT COALESCE("territoryClean", territory) AS place FROM "OutletUniverse"
    WHERE lower(btrim("teamLeader")) = ${fold(teamLeader)} AND COALESCE("territoryClean", territory) IS NOT NULL
    GROUP BY 1 ORDER BY count(*) DESC LIMIT 80`);
  return rows.map((r) => r.place.trim()).filter((p) => p !== "" && !isPlaceholderPlace(p));
}

/** Names a new route for a team leader. The name is the team leader's to choose (a route has no list to pick from), so it is checked for shape and for repeats instead. */
export async function createRoute(actor: CleanupActor, request: { teamLeader: string; name: string; locations: string[] }) {
  if (actor.role === "HOD" || actor.role === "DIRECTOR") throw new CleanupError("HOD and Director accounts can view the cleanup but not change it.", 403);
  const leaders = await loadTeamLeaderOptions();
  const teamLeader = leaders.find((n) => fold(n) === fold(request.teamLeader));
  if (!teamLeader) throw new CleanupError("Choose the team leader the route is for.", 400, [{ field: "teamLeader", message: "Choose a team leader." }]);
  if (!actor.isAdmin && !inActorScope(actor, teamLeader)) throw new CleanupError("You can only name routes for your own team.", 403);
  const name = cleanRouteName(request.name);
  if (!name) throw new CleanupError("A route name is 3 to 60 characters: letters, numbers, spaces and - . & ' / ( ).", 400, [{ field: "name", message: "Use letters and numbers, for example Imara Daima-Fedha." }]);
  const taken = (await prisma.cleanupRoute.findMany({ where: { teamLeader }, select: { name: true } })).some((r) => fold(r.name) === fold(name));
  if (taken) throw new CleanupError("You already have a route with that name.", 409, [{ field: "name", message: "That name is taken." }]);
  const places = new Map((await loadCleanupOptions()).territories.map((t) => [fold(t), t]));
  const locations = [...new Set(request.locations.map((l) => places.get(fold(l))).filter((l): l is string => Boolean(l)))].slice(0, 3);
  const route = await prisma.cleanupRoute.create({ data: { teamLeader, name, locations, createdBy: actor.email } });
  await prisma.outletCleanupLog.create({ data: { source: "-", outletKey: `route|${teamLeader}|${name}`, action: "ROUTE", actor: actor.email, actorRole: actor.role, changes: { locations } } });
  return route;
}
