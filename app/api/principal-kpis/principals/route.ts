import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { normalizePrincipalKey } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which principals the Principal KPIs page's selector should offer the
 * current user: every principal that has been imported (PrincipalKpiPeriod
 * is written for every principal's reference import), intersected with the
 * user's own scope when they're restricted to specific principals. An
 * unrestricted user (ADMIN, or anyone with an empty scope) sees every
 * imported principal. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);

  const imported = await prisma.principalKpiPeriod.findMany({ distinct: ["principal"], select: { principal: true }, orderBy: { principal: "asc" } });
  const principals = scope
    ? imported.filter(({ principal }) => scope.principals.some((p) => normalizePrincipalKey(p) === normalizePrincipalKey(principal))).map((row) => row.principal)
    : imported.map((row) => row.principal);

  return NextResponse.json({ principals });
}
