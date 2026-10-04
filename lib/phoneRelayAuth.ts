import { NextRequest, NextResponse } from "next/server";
import { checkKey, clientAddress, type KeyKind } from "@/lib/phoneRelay";

const HEADER: Record<KeyKind, string> = { phone: "x-phone-relay-key", agent: "x-phone-relay-agent-key" };
const DENIAL = {
  unconfigured: { status: 503, error: "Phone relay is not configured." },
  locked: { status: 429, error: "Too many failed attempts - try again later." },
  denied: { status: 401, error: "Unauthorised." },
} as const;

/** Returns a ready-made error response if the caller isn't allowed, otherwise null. */
export function authorise(request: NextRequest, kind: KeyKind): NextResponse | null {
  const result = checkKey(kind, request.headers.get(HEADER[kind]), clientAddress(request.headers), Date.now());
  if (result === "ok") return null;
  const { status, error } = DENIAL[result];
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export const noStore = { "Cache-Control": "no-store" } as const;
