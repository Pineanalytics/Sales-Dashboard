import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MonthlyRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  revenue: number;
  cases: number;
  grossProfit: number;
}

interface PrincipalTotal {
  principal: string;
  revenue: number;
  cases: number;
  grossProfit: number;
}

function grossMarginPct(revenue: number, grossProfit: number): number | null {
  return revenue > 0 ? (grossProfit / revenue) * 100 : null;
}

/** A logged-in user's own rep-level SAP sales (SalesRepActual), keyed by their
 *  own User.employeeCode — never a client-supplied param, so this can never
 *  be used to look up anyone else's figures. Powers the personal "My Sales"
 *  module (see /my-sales), independent of whatever Role/allowedPages this
 *  login otherwise has. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const employeeCode = session.user.employeeCode;
  if (!employeeCode) {
    return NextResponse.json({ error: "Your login isn't linked to a rep profile yet. Ask an admin to set your Employee Code on Manage Users." }, { status: 404 });
  }

  try {
    const [employee, rows] = await Promise.all([
      prisma.employeeMaster.findUnique({
        where: { employeeCode },
        select: { employeeCode: true, pineName: true, sapName: true, absolutePrincipal: true, salesRole: true, active: true },
      }),
      prisma.salesRepActual.findMany({
        where: { employeeCode },
        orderBy: [{ year: "desc" }, { monthIndex: "desc" }, { principal: "asc" }],
        select: { year: true, month: true, monthIndex: true, principal: true, revenue: true, cases: true, grossProfit: true },
      }),
    ]);

    const monthly: MonthlyRow[] = rows;
    const totals = monthly.reduce(
      (acc, row) => ({ revenue: acc.revenue + row.revenue, cases: acc.cases + row.cases, grossProfit: acc.grossProfit + row.grossProfit }),
      { revenue: 0, cases: 0, grossProfit: 0 }
    );

    const currentYear = monthly[0]?.year ?? null;
    const ytdRows = currentYear ? monthly.filter((row) => row.year === currentYear) : [];
    const ytd = ytdRows.reduce(
      (acc, row) => ({ revenue: acc.revenue + row.revenue, cases: acc.cases + row.cases, grossProfit: acc.grossProfit + row.grossProfit }),
      { revenue: 0, cases: 0, grossProfit: 0 }
    );

    const byPrincipalMap = new Map<string, PrincipalTotal>();
    for (const row of monthly) {
      const existing = byPrincipalMap.get(row.principal) ?? { principal: row.principal, revenue: 0, cases: 0, grossProfit: 0 };
      existing.revenue += row.revenue;
      existing.cases += row.cases;
      existing.grossProfit += row.grossProfit;
      byPrincipalMap.set(row.principal, existing);
    }
    const byPrincipal = Array.from(byPrincipalMap.values()).sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      employee: employee ?? { employeeCode, pineName: null, sapName: null, absolutePrincipal: null, salesRole: null, active: false },
      totals: { ...totals, grossMarginPct: grossMarginPct(totals.revenue, totals.grossProfit) },
      ytd: { year: currentYear, ...ytd, grossMarginPct: grossMarginPct(ytd.revenue, ytd.grossProfit) },
      monthly,
      byPrincipal,
    });
  } catch (err) {
    console.error("Failed to load My Sales summary", err);
    return NextResponse.json({ error: "Failed to load your sales summary." }, { status: 500 });
  }
}
