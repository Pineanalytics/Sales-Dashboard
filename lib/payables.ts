import { prisma } from "@/lib/db";

export interface PayablesDashboard {
  asOf: string;
  vendorCount: number;
  openItemCount: number;
  ledgerBalance: number;
  largestVendors: { vendorCode: string; vendorName: string; outstanding: number }[];
}

const TOP_N_VENDORS = 10;

// SAP vendor code -> normalized principal key, for the Stock/Debt table's
// Payable column. Deliberately keyed by vendor CODE, not a name-similarity
// match — a vendor's legal name often has nothing to do with the principal it
// actually distributes for (e.g. Bidco Africa Limited manufactures/distributes
// for Suntory locally; confirmed directly by the business, not guessable from
// the name). Every vendor not listed here rolls into "All Other Principals",
// same convention already used for Stock and Debt in that same table.
const VENDOR_PRINCIPAL_CODES: Record<string, string> = {
  "S-0124": "mars", // Mars Wrigley Confectionery Kenya Limited
  "S-0006": "suntory", // Suntory Beverage & Food Kenya Ltd
  "S-0005": "suntory", // Suntory Bevarage & Food Vans
  "S-0135": "suntory", // Bidco Africa Limited — Suntory's local manufacturing/distribution partner
  "S-0046": "upfield", // Flora Food Sales and Distribution Kenya Limited (Upfield's Flora brand)
  "S-0075": "eabl", // Kenya Breweries Limited (EABL's Kenya operating company)
  "S-0099": "weetabix", // Weetabix East Africa Limited
};

export interface PayablesByPrincipalRow {
  principalKey: string;
  outstanding: number;
}

/** Rolls up every PayableOpenItem to its mapped principal, via
 *  VENDOR_PRINCIPAL_CODES above. A principal absent from the result has no
 *  mapped vendor at all, not necessarily zero payables — callers should
 *  treat a missing key the same as 0 for display, same as debtAttribution's
 *  own byPrincipal map elsewhere in Finance Presentation. */
export async function getPayablesByPrincipal(): Promise<PayablesByPrincipalRow[]> {
  const openItems = await prisma.payableOpenItem.findMany({ select: { vendorCode: true, openBalance: true } });
  const byPrincipal = new Map<string, number>();
  for (const item of openItems) {
    const principalKey = VENDOR_PRINCIPAL_CODES[item.vendorCode];
    if (!principalKey) continue;
    byPrincipal.set(principalKey, (byPrincipal.get(principalKey) ?? 0) + item.openBalance);
  }
  return Array.from(byPrincipal.entries()).map(([principalKey, outstanding]) => ({ principalKey, outstanding }));
}

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
