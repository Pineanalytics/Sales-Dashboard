import { prisma } from "./db";

// Every Sales & Returns-fed table (SalesReturnLine, PjpDsrDailyActivity,
// PjpSkuPerformance, OutletSkuDailySales) is keyed by this raw numeric
// distributor code. Centralized here so Sync Health and any report reading
// those tables show the same friendly branch name — an unrecognized code
// (a new branch onboarded but not added here yet) still displays fine, just
// labeled by its raw code instead of a name.
export const SALES_RETURNS_BRANCH_LABELS: Record<string, string> = {
  "18048241": "Nairobi",
  "18058585": "Nyeri",
};

export const SALES_RETURNS_CONTROL_MODES = ["SMART", "CATCHUP"] as const;
export type SalesReturnsControlMode = (typeof SALES_RETURNS_CONTROL_MODES)[number];

export function isSalesReturnsControlMode(value: unknown): value is SalesReturnsControlMode {
  return typeof value === "string" && SALES_RETURNS_CONTROL_MODES.includes(value as SalesReturnsControlMode);
}

export function nairobiYesterdayStartUtc(now = new Date()): Date {
  const nairobi = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(nairobi.getUTCFullYear(), nairobi.getUTCMonth(), nairobi.getUTCDate() - 1));
}

export function isHistoricalSalesReturnsWindow(windowStart: Date, now = new Date()): boolean {
  return windowStart.getTime() < nairobiYesterdayStartUtc(now).getTime();
}

export async function historicalSalesReturnsUploadBlocked(distributor: string | null, windowStart: Date | null): Promise<boolean> {
  if (!distributor || !windowStart || !isHistoricalSalesReturnsWindow(windowStart)) return false;
  const control = await prisma.salesReturnsControl.findUnique({ where: { distributor }, select: { desiredMode: true } });
  return control?.desiredMode === "CATCHUP";
}
