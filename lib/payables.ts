import { prisma } from "@/lib/db";

export interface PayablesDashboard {
  asOf: string;
  vendorCount: number;
  openItemCount: number;
  ledgerBalance: number;
  largestVendors: { vendorCode: string; vendorName: string; outstanding: number }[];
}

const TOP_N_VENDORS = 10;

export async function getPayablesDashboard(): Promise<PayablesDashboard | null> {
  const latest = await prisma.payablesSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
  if (!latest) return null;

  const openItems = await prisma.payableOpenItem.findMany({ select: { vendorCode: true, vendorName: true, openBalance: true } });
  const byVendor = new Map<string, { vendorName: string; outstanding: number }>();
  for (const item of openItems) {
    const row = byVendor.get(item.vendorCode) ?? { vendorName: item.vendorName, outstanding: 0 };
    row.outstanding += item.openBalance;
    byVendor.set(item.vendorCode, row);
  }
  const largestVendors = Array.from(byVendor.entries())
    .map(([vendorCode, row]) => ({ vendorCode, vendorName: row.vendorName, outstanding: row.outstanding }))
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, TOP_N_VENDORS);

  return {
    asOf: latest.sourceDate.toISOString(),
    vendorCount: latest.vendorCount,
    openItemCount: latest.openItemCount,
    ledgerBalance: latest.ledgerBalance,
    largestVendors,
  };
}
