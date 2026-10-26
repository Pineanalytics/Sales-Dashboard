// What the form needs to suggest and validate an outlet's route: how it has been visited (Pine call timestamps, EABL DMS calls), what the source systems already plan (Leverage
// and Upfield journey plans, Pine's July-August plan), the routes a row may be put on, and the places a route can be named after.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPlaceholderPlace } from "@/lib/outletUniverse/tiering";
import type { OutletSource } from "@/lib/outletUniverse/normalize";
import { suggestFromVisits, weekdayFromWorkingDay, weekdayInText, type VisitEvent } from "./visitSuggestion";
import { WEEKDAYS, type RepDecision, type RepOption, type RowRouting, type VisitSuggestion, type Weekday } from "./types";

export const VISIT_WINDOW_DAYS = 90;

export interface RoutingUniverseRow {
  principal: string;
  repCode: string | null;
  repName: string | null;
  teamLeader: string | null;
  route: string | null;
  visitDays: string | null;
}

const fold = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Today in Nairobi, "YYYY-MM-DD". */
export const nairobiToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });

const BASIS: Record<OutletSource, string> = {
  PINE: "Pine call timestamps",
  EABL: "EABL DMS calls",
  LEVERAGE: "the Leverage journey plan",
  UPFIELD: "the Upfield route list",
};

/** The visits on record for an outlet in the window, where the source keeps them. */
async function loadVisits(source: OutletSource, outletKey: string, from: string): Promise<VisitEvent[]> {
  const since = new Date(`${from}T00:00:00Z`);
  if (source === "PINE") {
    const calls = await prisma.repCall.findMany({ where: { outletId: outletKey, date: { gte: since } }, select: { date: true, employeeCode: true, salesRep: true } });
    return calls.map((c) => ({ date: isoDay(c.date), repCode: c.employeeCode, rep: c.salesRep }));
  }
  if (source === "EABL") {
    const calls = await prisma.eablCall.findMany({ where: { customerCode: outletKey, callDate: { gte: since } }, select: { callDate: true, salesman: true } });
    return calls.map((c) => ({ date: isoDay(c.callDate), repCode: null, rep: c.salesman }));
  }
  return [];
}

/** What the source system already plans for the outlet: a route and days. */
async function loadPlanned(source: OutletSource, outletKey: string, universeRoute: string | null): Promise<{ route: string | null; days: Weekday[] } | null> {
  if (source === "LEVERAGE") {
    const plans = await prisma.journeyPlanAssignment.findMany({ where: { customerCode: outletKey }, select: { routeDesc: true, workingDay: true } });
    if (plans.length === 0) return null;
    const days = [...new Set(plans.map((p) => weekdayFromWorkingDay(p.workingDay)).filter((d): d is Weekday => d !== null))];
    return { route: plans[0].routeDesc, days: WEEKDAYS.filter((d) => days.includes(d)) };
  }
  if (source === "UPFIELD") {
    const day = weekdayInText(universeRoute);
    return universeRoute ? { route: universeRoute, days: day ? [day] : [] } : null;
  }
  if (source === "PINE") {
    // Pine's journey plan for July and August: its route names are regions, so only its days are useful.
    const plans = await prisma.journeyPlanRow.findMany({ where: { customerId: outletKey }, select: { day: true }, distinct: ["day"] });
    const days = plans.map((p) => weekdayInText(p.day)).filter((d): d is Weekday => d !== null);
    return days.length > 0 ? { route: null, days: WEEKDAYS.filter((d) => days.includes(d)) } : null;
  }
  return universeRoute ? { route: universeRoute, days: [] } : null;
}

const parseDays = (text: string | null): Weekday[] => WEEKDAYS.filter((d) => (text ?? "").split(",").map((t) => t.trim()).includes(d));

/** The route, days and suggestion for each principal row of an outlet, the routes each row may be put on, and the places routes can be named after. */
export async function loadRouting(input: {
  source: OutletSource;
  outletKey: string;
  universe: RoutingUniverseRow[];
  repOptions: Record<string, RepOption[]>;
  decisions: RepDecision[];
  now?: Date;
}): Promise<{ routing: Record<string, RowRouting>; routeLocations: string[] }> {
  const { source, outletKey, universe, repOptions, decisions } = input;
  const today = nairobiToday(input.now);
  const from = isoDay(new Date(new Date(`${today}T00:00:00Z`).getTime() - (VISIT_WINDOW_DAYS - 1) * 86_400_000));
  const leaders = [...new Set(universe.map((r) => fold(r.teamLeader)).filter((t) => t !== ""))];

  const [visits, planned, namedRoutes, usedRoutes, places] = await Promise.all([
    loadVisits(source, outletKey, from),
    loadPlanned(source, outletKey, universe.find((r) => r.route)?.route ?? null),
    leaders.length === 0 ? Promise.resolve([]) : prisma.cleanupRoute.findMany({ select: { teamLeader: true, name: true }, orderBy: { name: "asc" } }),
    leaders.length === 0
      ? Promise.resolve([] as { teamLeader: string; principal: string; route: string }[])
      : prisma.$queryRaw<{ teamLeader: string; principal: string; route: string }[]>(Prisma.sql`
          SELECT DISTINCT lower(btrim("teamLeader")) AS "teamLeader", principal, route FROM "OutletUniverse"
          WHERE route IS NOT NULL AND btrim(route) <> '' AND lower(btrim("teamLeader")) IN (${Prisma.join(leaders)}) AND principal IN (${Prisma.join(universe.map((r) => r.principal))})
          LIMIT 600`),
    leaders.length === 0
      ? Promise.resolve([] as { place: string }[])
      : prisma.$queryRaw<{ place: string }[]>(Prisma.sql`
          SELECT COALESCE("territoryClean", territory) AS place FROM "OutletUniverse"
          WHERE lower(btrim("teamLeader")) IN (${Prisma.join(leaders)}) AND COALESCE("territoryClean", territory) IS NOT NULL
          GROUP BY 1 ORDER BY count(*) DESC LIMIT 80`),
  ]);

  const routing: Record<string, RowRouting> = {};
  for (const row of universe) {
    const decision = decisions.find((d) => fold(d.principal) === fold(row.principal));
    const options = repOptions[row.principal] ?? [];
    const suggestion: VisitSuggestion = suggestFromVisits(visits, { basis: BASIS[source], windowDays: VISIT_WINDOW_DAYS, today, rowRepCode: row.repCode, rowRepName: row.repName, repOptions: options.map((o) => ({ code: o.code, name: o.name })) });
    suggestion.planned = planned;
    const mine = fold(row.teamLeader);
    const routeOptions = [
      ...new Set([
        ...namedRoutes.filter((r) => fold(r.teamLeader) === mine).map((r) => r.name),
        ...usedRoutes.filter((r) => r.teamLeader === mine && fold(r.principal) === fold(row.principal)).map((r) => r.route),
      ]),
    ].sort((a, b) => a.localeCompare(b));
    routing[row.principal] = {
      routeName: decision?.routeName ?? row.route ?? null,
      visitDays: decision?.visitDays ?? parseDays(row.visitDays),
      suggestion,
      routeOptions,
    };
  }
  return { routing, routeLocations: places.map((p) => p.place.trim()).filter((p) => p !== "" && !isPlaceholderPlace(p)) };
}
