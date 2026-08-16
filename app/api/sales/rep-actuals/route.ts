import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-side route for SAP-only rep value and cases. Pine operational data is
 * deliberately not mixed into this response; the client joins coverage and
 * productivity separately by the canonical Pine employee name. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const year = req.nextUrl.searchParams.get("year")?.trim() || null;
  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    const where = {
      ...(year ? { year } : {}),
      ...(scope ? { employeeCode: { in: scope.employeeCodes }, principal: { in: scope.principals } } : {}),
    };
    const [rows, masters] = await Promise.all([
      prisma.salesRepActual.findMany({ where, orderBy: [{ year: "desc" }, { monthIndex: "desc" }, { revenue: "desc" }] }),
      prisma.employeeMaster.findMany({ select: { employeeCode: true, salesRole: true } }),
    ]);
    const roleByEmployee = new Map(masters.map((master) => [master.employeeCode, master.salesRole]));
    return NextResponse.json({
      rows: rows.map((row) => ({ ...row, salesRole: row.employeeCode ? roleByEmployee.get(row.employeeCode) ?? null : null })),
    });
  } catch (err) {
    console.error("Failed to load rep-level SAP actuals", err);
    return NextResponse.json({ error: "Failed to load rep-level SAP actuals." }, { status: 500 });
  }
}
