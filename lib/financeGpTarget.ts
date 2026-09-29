import { prisma } from "@/lib/db";

// GP targets are per-principal, set alongside the other Monthly Targets on
// /targets-overview (Target.grossProfitTarget / grossMarginTargetPct) —
// there's no separate company-wide settings row; "All Principals" blends
// these per-principal figures instead (see SalesPerformanceTab.tsx).
export interface PrincipalGpTarget {
  principal: string;
  valueTarget: number | null;
  grossProfitTarget: number | null;
  grossMarginTargetPct: number | null;
}

export async function getGpTargetsForPeriod(year: string, month: string): Promise<PrincipalGpTarget[]> {
  return prisma.target.findMany({
    where: { year, month },
    select: { principal: true, valueTarget: true, grossProfitTarget: true, grossMarginTargetPct: true },
  });
}
