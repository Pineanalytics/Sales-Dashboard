import { prisma } from "./db";

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
