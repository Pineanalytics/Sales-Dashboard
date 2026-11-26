// Who may download the Customer extracts, and which principals their selection covers. Shared by the Excel extract
// (app/api/reports/brand-customer-extract) and the raw data CSV (app/api/reports/customer-raw-lines).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { normalizePrincipalKey } from "@/lib/normalize";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import type { MonthRef } from "@/lib/sfaPortfolio";

export function requestPeriods(request: NextRequest, name: string): MonthRef[] {
  return request.nextUrl.searchParams.getAll(name).flatMap((value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    return match ? [{ year: match[1], monthIndex: Number(match[2]) - 1 }] : [];
  });
}

export function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "all";
}

/** The refusal to send, or a test for "this principal is in the viewer's scope and in the selection". */
export async function customerExtractAccess(request: NextRequest): Promise<{ refusal: NextResponse } | { inScope: (principal: string) => boolean }> {
  const session = await auth();
  if (!session?.user) return { refusal: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  if (session.user.role !== "ADMIN" && !(session.user.allowedPages ?? []).includes("customers")) {
    return { refusal: NextResponse.json({ error: "You do not have access to Customers & Brands." }, { status: 403 }) };
  }
  const requestedKeys = new Set(request.nextUrl.searchParams.getAll("principal").map(normalizePrincipalKey));
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  const allowedKeys = scope ? new Set(scope.principals.map(normalizePrincipalKey)) : null;
  return {
    inScope: (principal) => {
      const key = normalizePrincipalKey(principal);
      return (!allowedKeys || allowedKeys.has(key)) && (requestedKeys.size === 0 || requestedKeys.has(key));
    },
  };
}
