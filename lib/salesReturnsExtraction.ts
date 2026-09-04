import { randomUUID } from "node:crypto";

export const SALES_RETURNS_EXTRACTION_STATUSES = ["STARTED", "COMPLETED", "FAILED"] as const;
export type SalesReturnsExtractionStatus = (typeof SALES_RETURNS_EXTRACTION_STATUSES)[number];

const SERIAL_PATTERN = /^SR-\d+-\d{8}T\d{9}Z-[A-F0-9]{8}$/;

export function createSalesReturnsExtractionSerial(distributor: string, now = new Date()): string {
  if (!/^\d+$/.test(distributor)) throw new Error("Distributor must be numeric.");
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  return `SR-${distributor}-${timestamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function isSalesReturnsExtractionSerial(value: unknown): value is string {
  return typeof value === "string" && SERIAL_PATTERN.test(value);
}

export function isSalesReturnsExtractionStatus(value: unknown): value is SalesReturnsExtractionStatus {
  return typeof value === "string" && SALES_RETURNS_EXTRACTION_STATUSES.includes(value as SalesReturnsExtractionStatus);
}
