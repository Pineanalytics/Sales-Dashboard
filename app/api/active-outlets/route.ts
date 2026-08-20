import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = ["Primary Sales", "Secondary Sales"] as const;
type SalesRole = (typeof ROLES)[number];

function requestedRole(value: string | null): SalesRole | null | "invalid" {
  if (!value || value === "all") return null;
  return (ROLES as readonly string[]).includes(value) ? (value as SalesRole) : "invalid";
}

/** Builds the shared ActiveOutlet filter once so every aggregate is scoped in
 * exactly the same way. The route deliberately returns aggregates plus the
 * existing 100-row drill-down, never the full (and growing) outlet ledger. */
function outletWhere(principal: string | null, allowedPrincipals: string[] | null, role: SalesRole | null): Prisma.Sql {
  const principalFilter = principal
    ? Prisma.sql` AND "principal" = ${principal}`
    : allowedPrincipals
      ? Prisma.sql` AND "principal" IN (${Prisma.join(allowedPrincipals)})`
      : Prisma.empty;
  const roleFilter = role ? Prisma.sql` AND "salesRole" = ${role}` : Prisma.empty;
  return Prisma.sql`WHERE 1 = 1${principalFilter}${roleFilter}`;
}

export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const principal = req.nextUrl.searchParams.get("principal");
  const role = requestedRole(req.nextUrl.searchParams.get("role"));
  if (role === "invalid") {
    return NextResponse.json({ error: "Unrecognized sales role." }, { status: 400 });
  }

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    if (scope && principal && !scope.principals.includes(principal)) {
      return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
    }

    const allowedPrincipals = scope ? scope.principals : null;
    const where = outletWhere(principal, allowedPrincipals, role);
    const unfilteredWhere = outletWhere(principal, allowedPrincipals, null);
    const monthlyWhere = outletWhere(principal, allowedPrincipals, null);

    const [totals, roleTotals, executiveRows, channelRows, subChannelRows, monthly, topOutlets, availableOutlets] = await Promise.all([
      prisma.$queryRaw<{ distinctOutlets: number; transactions: number; sales: number }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT "customerId")::int AS "distinctOutlets",
               COALESCE(SUM("timesBought"), 0)::double precision AS transactions,
               COALESCE(SUM(sales), 0)::double precision AS sales
        FROM "ActiveOutlet" ${where}
      `),
      prisma.$queryRaw<{ salesRole: string; outlets: number }[]>(Prisma.sql`
        SELECT "salesRole", COUNT(DISTINCT "customerId")::int AS outlets
        FROM "ActiveOutlet" ${unfilteredWhere}
        GROUP BY "salesRole"
      `),
      prisma.$queryRaw<{ principal: string; salesRole: string; outlets: number; transactions: number; sales: number }[]>(Prisma.sql`
        SELECT principal, "salesRole", COUNT(*)::int AS outlets,
               COALESCE(SUM("timesBought"), 0)::double precision AS transactions,
               COALESCE(SUM(sales), 0)::double precision AS sales
        FROM "ActiveOutlet" ${where}
        GROUP BY principal, "salesRole"
        ORDER BY principal ASC, "salesRole" ASC
      `),
      prisma.$queryRaw<{ name: string; value: number }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(BTRIM(channel), ''), 'Unspecified') AS name,
               COUNT(DISTINCT "customerId")::int AS value
        FROM "ActiveOutlet" ${where}
        GROUP BY COALESCE(NULLIF(BTRIM(channel), ''), 'Unspecified')
        ORDER BY value DESC, name ASC
      `),
      prisma.$queryRaw<{ name: string; value: number }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(BTRIM("subChannel"), ''), 'Unspecified') AS name,
               COUNT(DISTINCT "customerId")::int AS value
        FROM "ActiveOutlet" ${where}
        GROUP BY COALESCE(NULLIF(BTRIM("subChannel"), ''), 'Unspecified')
        ORDER BY value DESC, name ASC
      `),
      prisma.$queryRaw<{ year: string; month: string; monthIndex: number; principal: string; salesRole: string; distinctOutlets: number; transactions: number; sales: number }[]>(Prisma.sql`
        SELECT year, month, "monthIndex", principal, "salesRole", "distinctOutlets",
               transactions::double precision AS transactions, sales::double precision AS sales
        FROM "ActiveOutletMonthly" ${monthlyWhere}
        ORDER BY "monthIndex" ASC, principal ASC
      `),
      prisma.activeOutlet.findMany({
        where: {
          ...(principal ? { principal } : allowedPrincipals ? { principal: { in: allowedPrincipals } } : {}),
          ...(role ? { salesRole: role } : {}),
        },
        orderBy: { sales: "desc" },
        take: 100,
        select: {
          principal: true,
          customerId: true,
          outletName: true,
          channel: true,
          subChannel: true,
          salesRole: true,
          timesBought: true,
          frequencyBand: true,
          sales: true,
          mostRecentRep: true,
        },
      }),
      prisma.activeOutlet.count({
        where: principal ? { principal } : allowedPrincipals ? { principal: { in: allowedPrincipals } } : {},
      }),
    ]);

    const byRole = new Map(roleTotals.map((item) => [item.salesRole, item.outlets]));
    const duration = performance.now() - startedAt;
    return NextResponse.json(
      {
        totals: {
          ...(totals[0] ?? { distinctOutlets: 0, transactions: 0, sales: 0 }),
          primaryOutlets: byRole.get("Primary Sales") ?? 0,
          secondaryOutlets: byRole.get("Secondary Sales") ?? 0,
          availableOutlets,
        },
        executiveRows,
        channelRows,
        subChannelRows,
        monthly,
        topOutlets,
      },
      { headers: { "Server-Timing": `active-outlets;dur=${duration.toFixed(1)}`, "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    console.error("Failed to load Active Outlets data", err);
    return NextResponse.json({ error: "Failed to load Active Outlets data." }, { status: 500 });
  }
}
