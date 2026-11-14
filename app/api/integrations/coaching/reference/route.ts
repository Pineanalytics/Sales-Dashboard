import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadCoachingPerformance } from "@/lib/coachingPerformanceQuery";
import { loadRepActivity, MAX_ACTIVITY_CODES, MAX_ACTIVITY_DAYS } from "@/lib/coachingRepActivityQuery";
import { loadRepTimestamps, MAX_TIMESTAMP_CALL_DAYS } from "@/lib/coachingRepTimestamps";
import { getUnifiedLocations } from "@/lib/locationUnify/source";
import { historySnapshot, paginate, universeSnapshot } from "@/lib/universeFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 1_000;

function hasValidBridgeKey(request: NextRequest) {
  const expected = process.env.COACHING_REFERENCE_SYNC_KEY;
  const provided = request.headers.get("x-coaching-reference-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function boundedPageSize(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE) : 500;
}

/**
 * Private server-to-server reference feed for the Coaching application.
 *
 * This shares operational master data (roster, outlets, customers) and, since
 * 2026-10-15, per-rep coaching performance (resource=performance). Performance
 * is ratios and counts only: attainment %, cases, calls, strike rate, days
 * worked. Since 2026-10-20 it also shares the whole active outlet universe
 * (resource=universe) and its monthly buying and call history per outlet and
 * principal (resource=universe-history); by the business's decision those two
 * DO carry sales values and tiers, so the Coaching app can read buying trends
 * and rep association by principal. Target values, credentials and
 * dashboard-user authorization data never leave Pinefrost Analytics. The two applications
 * retain independent authentication until an explicit SSO project is approved.
 */
export async function GET(request: NextRequest) {
  if (!hasValidBridgeKey(request)) {
    return NextResponse.json({ error: "Invalid coaching reference credentials." }, { status: 401 });
  }

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "roster";

  if (resource === "roster") {
    const [principals, employees, assignments, teamLeaders, supervisors] = await Promise.all([
      prisma.principal.findMany({
        where: { status: "Active" },
        select: { principal: true, mainPrincipal: true, location: true, locationCode: true, updatedAt: true },
        orderBy: { principal: "asc" },
      }),
      prisma.employeeMaster.findMany({
        where: { active: true },
        select: {
          employeeCode: true,
          pineName: true,
          sapName: true,
          absolutePrincipal: true,
          salesRole: true,
          region: true,
          subRegion: true,
          teamLeader: true,
          supervisor: true,
          route: true,
          location: true,
          updatedAt: true,
        },
        orderBy: { employeeCode: "asc" },
      }),
      prisma.teamLeaderAssignment.findMany({
        where: { active: true },
        select: {
          teamLeaderId: true,
          employeeCode: true,
          employeeName: true,
          principal: true,
          salesRole: true,
          region: true,
          subRegion: true,
          route: true,
          location: true,
          supervisorId: true,
          managerId: true,
          updatedAt: true,
        },
        orderBy: [{ principal: "asc" }, { employeeCode: "asc" }],
      }),
      prisma.teamLeader.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.supervisor.findMany({ select: { id: true, name: true, managerId: true }, orderBy: { name: "asc" } }),
    ]);

    return NextResponse.json(
      { syncedAt: new Date().toISOString(), principals, employees, assignments, teamLeaders, supervisors },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (resource === "rep-activity") {
    // One rep's (or a couple of codes') day-by-day activity for any window: the Coaching app's sales rep dashboard.
    const codes = (url.searchParams.get("codes") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => /^[A-Za-z0-9._-]{1,30}$/.test(c));
    const unique = [...new Set(codes)].slice(0, MAX_ACTIVITY_CODES);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (unique.length === 0) return NextResponse.json({ error: "codes is required." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "from and to must be YYYY-MM-DD." }, { status: 400 });
    }
    const start = new Date(`${from}T00:00:00.000Z`);
    const endExclusive = new Date(Date.parse(`${to}T00:00:00.000Z`) + 24 * 3600 * 1000);
    const days = (endExclusive.getTime() - start.getTime()) / (24 * 3600 * 1000);
    if (!Number.isFinite(days) || days < 1 || days > MAX_ACTIVITY_DAYS) {
      return NextResponse.json({ error: `The window must be 1 to ${MAX_ACTIVITY_DAYS} days.` }, { status: 400 });
    }
    const reps = await loadRepActivity(unique, start, endExclusive);
    return NextResponse.json({ syncedAt: new Date().toISOString(), from, to, reps }, { headers: { "Cache-Control": "no-store" } });
  }

  if (resource === "rep-timestamps") {
    // When a rep was in trade, day by day (first and last call, hours, calls), with every call for windows up to a month: the Coaching app's timestamp report.
    const codes = [...new Set((url.searchParams.get("codes") ?? "").split(",").map((c) => c.trim()).filter((c) => /^[A-Za-z0-9._-]{1,30}$/.test(c)))].slice(0, MAX_ACTIVITY_CODES);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (codes.length === 0) return NextResponse.json({ error: "codes is required." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ error: "from and to must be YYYY-MM-DD." }, { status: 400 });
    const start = new Date(`${from}T00:00:00.000Z`);
    const endExclusive = new Date(Date.parse(`${to}T00:00:00.000Z`) + 24 * 3600 * 1000);
    const days = (endExclusive.getTime() - start.getTime()) / (24 * 3600 * 1000);
    if (!Number.isFinite(days) || days < 1 || days > MAX_ACTIVITY_DAYS) return NextResponse.json({ error: `The window must be 1 to ${MAX_ACTIVITY_DAYS} days.` }, { status: 400 });
    const reps = await loadRepTimestamps(codes, start, endExclusive);
    return NextResponse.json({ syncedAt: new Date().toISOString(), from, to, callsIncluded: days <= MAX_TIMESTAMP_CALL_DAYS, reps }, { headers: { "Cache-Control": "no-store" } });
  }

  if (resource === "performance") {
    // The current month and the one before, so a coach can see the trend. See
    // lib/coachingPerformanceFeed.ts for what is (and is not) shared.
    const { periods, rows } = await loadCoachingPerformance();
    return NextResponse.json(
      { syncedAt: new Date().toISOString(), periods, performance: rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (resource === "outlets") {
    const year = url.searchParams.get("year") ?? String(new Date().getFullYear());
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const pageSize = boundedPageSize(url.searchParams.get("pageSize"));
    const rows = await prisma.activeOutlet.findMany({
      where: { year, status: "Active" },
      select: {
        id: true,
        principal: true,
        customerId: true,
        outletName: true,
        channel: true,
        subChannel: true,
        territory: true,
        salesRole: true,
        latitude: true,
        longitude: true,
        pjpEmployeeCode: true,
        pjpRepName: true,
        pjpRepGroup: true,
        pjpRegion: true,
        mostRecentRep: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const outlets = hasMore ? rows.slice(0, pageSize) : rows;
    return NextResponse.json(
      { syncedAt: new Date().toISOString(), year, outlets, nextCursor: hasMore ? outlets.at(-1)?.id ?? null : null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (resource === "eabl-customers") {
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const pageSize = boundedPageSize(url.searchParams.get("pageSize"));
    const rows = await prisma.eablCustomerMaster.findMany({
      select: { id: true, customerId: true, principal: true, outletName: true, channel: true, subChannel: true, territory: true, route: true, latitude: true, longitude: true, status: true, updatedAt: true },
      orderBy: { id: "asc" },
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const customers = hasMore ? rows.slice(0, pageSize) : rows;
    return NextResponse.json(
      { syncedAt: new Date().toISOString(), customers, nextCursor: hasMore ? customers.at(-1)?.id ?? null : null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (resource === "locations") {
    // The unified location map: every raw territory name with its canonical name and how it was unified, the unified places with their centre and spread,
    // and the relations found by name and by coordinates (possible variants, sub-areas, names that share the same part of the map).
    const unified = await getUnifiedLocations();
    return NextResponse.json(
      { syncedAt: new Date().toISOString(), builtAt: unified.builtAt, totals: { rawNames: unified.map.mapping.length, places: unified.map.groups.length, relations: unified.map.relations.length }, places: unified.map.groups, mapping: unified.map.mapping, relations: unified.map.relations },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (resource === "universe" || resource === "universe-history") {
    const cursor = url.searchParams.get("cursor");
    const pageSize = boundedPageSize(url.searchParams.get("pageSize"));
    const source = (url.searchParams.get("source") ?? "").toUpperCase();
    const principal = url.searchParams.get("principal");
    if (resource === "universe") {
      const status = url.searchParams.get("status") ?? "active";
      const snap = await universeSnapshot();
      const rows = snap.rows.filter((r) => (status === "all" || r.status.toLowerCase() === (status === "dormant" ? "dormant" : "active")) && (!source || r.sourceCode === source) && (!principal || r.principal === principal));
      const page = paginate(rows, cursor, pageSize);
      return NextResponse.json({ syncedAt: new Date().toISOString(), universeBuiltAt: snap.builtAt, snapshot: snap.builtFor, status, total: page.total, outlets: page.rows, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
    }
    const snap = await historySnapshot();
    const rows = snap.rows.filter((r) => (!source || r.sourceCode === source) && (!principal || r.principal === principal));
    const page = paginate(rows, cursor, pageSize);
    return NextResponse.json({ syncedAt: new Date().toISOString(), universeBuiltAt: snap.builtAt, snapshot: snap.builtFor, total: page.total, history: page.rows, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ error: "Unknown coaching reference resource." }, { status: 400 });
}
