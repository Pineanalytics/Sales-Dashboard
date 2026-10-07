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

interface VendorBalance {
  vendorCode: string;
  vendorName: string;
  outstanding: number;
}

/** What is owed to each vendor, summed in the database. The open-item table is read once per page here,
 *  as a handful of grouped rows, instead of every open item twice (once per payables helper). */
async function loadVendorBalances(): Promise<VendorBalance[]> {
  const rows = await prisma.payableOpenItem.groupBy({ by: ["vendorCode", "vendorName"], _sum: { openBalance: true } });
  const byVendor = new Map<string, VendorBalance>();
  for (const row of rows) {
    const existing = byVendor.get(row.vendorCode);
    if (existing) existing.outstanding += row._sum.openBalance ?? 0;
    else byVendor.set(row.vendorCode, { vendorCode: row.vendorCode, vendorName: row.vendorName, outstanding: row._sum.openBalance ?? 0 });
  }
  return Array.from(byVendor.values());
}

function rollUpByPrincipal(vendors: VendorBalance[]): PayablesByPrincipalRow[] {
  const byPrincipal = new Map<string, number>();
  for (const vendor of vendors) {
    const principalKey = VENDOR_PRINCIPAL_CODES[vendor.vendorCode];
    if (!principalKey) continue;
    byPrincipal.set(principalKey, (byPrincipal.get(principalKey) ?? 0) + vendor.outstanding);
  }
  return Array.from(byPrincipal.entries()).map(([principalKey, outstanding]) => ({ principalKey, outstanding }));
}

async function buildDashboard(vendors: VendorBalance[]): Promise<PayablesDashboard | null> {
  const latest = await prisma.payablesSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
  if (!latest) return null;
  return {
    asOf: latest.sourceDate.toISOString(),
    vendorCount: latest.vendorCount,
    openItemCount: latest.openItemCount,
    ledgerBalance: latest.ledgerBalance,
    largestVendors: [...vendors].sort((a, b) => b.outstanding - a.outstanding).slice(0, TOP_N_VENDORS),
  };
}

/** Rolls up every PayableOpenItem to its mapped principal, via
 *  VENDOR_PRINCIPAL_CODES above. A principal absent from the result has no
 *  mapped vendor at all, not necessarily zero payables — callers should
 *  treat a missing key the same as 0 for display, same as debtAttribution's
 *  own byPrincipal map elsewhere in Finance Presentation. */
export async function getPayablesByPrincipal(): Promise<PayablesByPrincipalRow[]> {
  return rollUpByPrincipal(await loadVendorBalances());
}

export async function getPayablesDashboard(): Promise<PayablesDashboard | null> {
  return buildDashboard(await loadVendorBalances());
}

/** Both of the above from a single read, for the Finance Presentation, which needs the totals and the per-principal split. */
export async function getPayablesFinanceData(): Promise<{ dashboard: PayablesDashboard | null; byPrincipal: PayablesByPrincipalRow[] }> {
  const vendors = await loadVendorBalances();
  return { dashboard: await buildDashboard(vendors), byPrincipal: rollUpByPrincipal(vendors) };
}
