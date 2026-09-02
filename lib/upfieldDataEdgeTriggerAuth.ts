import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Uses the same bearer credential as the existing DataEdge upload route. */
export function hasUpfieldDataEdgeUploadKey(request: NextRequest): boolean {
  const expected = process.env.UPFIELD_UPLOAD_KEY;
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!expected || !match) return false;
  const supplied = Buffer.from(match[1]);
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
