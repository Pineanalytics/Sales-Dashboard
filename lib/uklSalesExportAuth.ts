import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** The Server-PC puller uses its dedicated key; never reuse the bridge key. */
export function hasUklSalesExportKey(request: NextRequest): boolean {
  const expected = process.env.UKL_SALES_EXPORT_KEY;
  const supplied = request.headers.get("x-ukl-export-key");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
