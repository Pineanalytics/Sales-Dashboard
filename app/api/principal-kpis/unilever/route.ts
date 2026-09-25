import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { normalizePrincipalKey } from "@/lib/normalize";
import { computeUnileverKpiCards } from "@/lib/unileverKpi";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNILEVER_PRINCIPAL = "Unilever";

/** Current Nairobi calendar month as "YYYY-MM", independent of the server's
 * own time zone. */
function currentNairobiMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  if (scope && !scope.principals.some((p) => normalizePrincipalKey(p) === normalizePrincipalKey(UNILEVER_PRINCIPAL))) {
    return NextResponse.json({ error: "Unilever isn't one of your assigned principals." }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month")?.trim() || currentNairobiMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM." }, { status: 400 });
  const distributor = req.nextUrl.searchParams.get("distributor")?.trim() || null;

  const cards = await computeUnileverKpiCards({ month, distributor });

  return NextResponse.json({
    available: true,
    month,
    distributorOptions: Object.entries(SALES_RETURNS_BRANCH_LABELS).map(([value, label]) => ({ value, label })),
    cards,
  });
}
