import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { normalizePrincipalKey } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unilever's KPI card (app/api/principal-kpis/unilever) is computed live from
// the synced Centegy Sales & Returns tables, not an imported PrincipalKpiPeriod
// workbook like every other principal here — so it's added unconditionally
// rather than discovered from that table.
const LIVE_SYNCED_PRINCIPALS = ["Unilever"];

/** Which principals the Principal KPIs page's selector should offer the
 * current user: every principal that has been imported (PrincipalKpiPeriod
 * is written for every principal's reference import) plus the live-synced
 * ones above, intersected with the user's own scope when they're restricted
 * to specific principals. An unrestricted user (ADMIN, or anyone with an
 * empty scope) sees every one. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);

  const imported = await prisma.principalKpiPeriod.findMany({ distinct: ["principal"], select: { principal: true }, orderBy: { principal: "asc" } });
  const allPrincipals = Array.from(new Set([...imported.map((row) => row.principal), ...LIVE_SYNCED_PRINCIPALS])).sort();
  const principals = scope ? allPrincipals.filter((principal) => scope.principals.some((p) => normalizePrincipalKey(p) === normalizePrincipalKey(principal))) : allPrincipals;

  return NextResponse.json({ principals });
}
