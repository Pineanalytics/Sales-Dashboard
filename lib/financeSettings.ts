import { prisma } from "@/lib/db";

/** There is no per-principal GP target anywhere in Target — Finance's GP
 *  Margin vs Target is one company-wide, admin-entered figure instead. */
export async function getFinanceSettings(): Promise<{ grossMarginTargetPct: number | null }> {
  const row = await prisma.financeSettings.findUnique({ where: { id: 1 } });
  return { grossMarginTargetPct: row?.grossMarginTargetPct ?? null };
}
