import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary, read-only diagnostic — PrincipalKpiJbpTarget's
// @@unique([principal, fiscalYear, periodKey, customerId, category])
// constraint (added 2026-09-14) has never actually been pushed to
// production: `prisma db push` refused with "there might be data loss"
// because live rows already violate it. This exists solely to show which
// rows those are so someone can decide how to clear them (most likely: the
// current scripts/principal-kpis/import-mars.ts already de-duplicates on
// this exact key via its own Map before writing, and does a full
// deleteMany+createMany replace scoped to the principal — so simply
// re-running that import once should naturally clear stale duplicates left
// by an older version of the script, with no manual row surgery needed).
// Safe to delete once the constraint has been successfully pushed.
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  }

  try {
    const groups = await prisma.$queryRaw<Array<{
      principal: string; fiscalYear: string; periodKey: string; customerId: string; category: string; count: bigint;
    }>>(Prisma.sql`
      SELECT principal, "fiscalYear", "periodKey", "customerId", category, COUNT(*) AS count
      FROM "PrincipalKpiJbpTarget"
      GROUP BY principal, "fiscalYear", "periodKey", "customerId", category
      HAVING COUNT(*) > 1
      ORDER BY count DESC, principal, "fiscalYear", "periodKey"
      LIMIT 200
    `);

    const totalRows = await prisma.principalKpiJbpTarget.count();
    if (groups.length === 0) {
      return NextResponse.json({ totalRows, duplicateGroups: 0, duplicateRows: 0, groups: [] });
    }

    // Pull the actual conflicting rows for the first 25 groups so the
    // reviewer can see what's actually different between "duplicates" (e.g.
    // a genuinely stale second import vs. two rows disagreeing on target
    // values, which would need a real decision rather than a blind re-run).
    const sampleDetail = await Promise.all(
      groups.slice(0, 25).map((g) =>
        prisma.principalKpiJbpTarget.findMany({
          where: { principal: g.principal, fiscalYear: g.fiscalYear, periodKey: g.periodKey, customerId: g.customerId, category: g.category },
          select: { id: true, customerName: true, tier: true, area: true, casesTarget: true, ssuTarget: true, createdAt: true, updatedAt: true },
          orderBy: { createdAt: "asc" },
        })
      )
    );

    return NextResponse.json({
      totalRows,
      duplicateGroups: groups.length,
      duplicateRows: groups.reduce((sum, g) => sum + Number(g.count), 0),
      groups: groups.map((g, i) => ({
        principal: g.principal, fiscalYear: g.fiscalYear, periodKey: g.periodKey, customerId: g.customerId, category: g.category,
        count: Number(g.count),
        rows: sampleDetail[i] ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to load PrincipalKpiJbpTarget duplicates", error);
    return NextResponse.json({ error: "Failed to load duplicate diagnostic." }, { status: 500 });
  }
}
