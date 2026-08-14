import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
 * This intentionally shares only operational master data. Credentials, sales
 * values and dashboard-user authorization data never leave Pinefrost Analytics.
 * The two applications retain independent authentication until an explicit SSO
 * project is approved.
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

  return NextResponse.json({ error: "Unknown coaching reference resource." }, { status: 400 });
}
