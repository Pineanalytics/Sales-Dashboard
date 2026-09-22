import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getReceivablesDashboard } from "@/lib/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only feed for the Financials page's Receivables tabs and its report
 *  extract (lib/reports/definitions.ts's "receivables" report) — the same
 *  getReceivablesDashboard() the Executive Summary page already calls
 *  server-side, just exposed for client-side fetch. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    const dashboard = await getReceivablesDashboard();
    return NextResponse.json({ dashboard });
  } catch (error) {
    console.error("Failed to load receivables dashboard", error);
    return NextResponse.json({ error: "Failed to load receivables data." }, { status: 500 });
  }
}
