import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function hasEablSalesExportKey(request: NextRequest): boolean {
  const expected = process.env.EABL_SALES_EXPORT_KEY;
  const supplied = request.headers.get("x-eabl-sales-export-key");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
