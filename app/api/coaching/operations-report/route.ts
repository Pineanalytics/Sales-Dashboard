import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { coachingScopeForUser, loadCoachingSnapshot } from "@/lib/coachingBridge";
import { buildOperationsReport, operationsInputFromSnapshot, renderCoachingOperationsHtml } from "@/lib/coachingOperationsReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDate = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * The Coaching Operations Report: the whole coaching operation in the chosen dates (and team leader), summarised and analysed, as one
 * printable HTML page. Same report as the Coaching app's admin dashboard, built from the synced Coaching snapshot and limited to the
 * teams the viewer can see.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "TEAM_LEADER", "SUPERVISOR"].includes(session.user.role)) {
    return new NextResponse("You do not have Coaching access.", { status: 403 });
  }
  const scope = await coachingScopeForUser(session.user);
  if (!scope) return new NextResponse("You do not have Coaching access.", { status: 403 });

  const params = request.nextUrl.searchParams;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
  const from = isDate(params.get("from")) ? (params.get("from") as string) : `${today.slice(0, 8)}01`;
  const to = isDate(params.get("to")) ? (params.get("to") as string) : today;
  const leader = params.get("leader")?.trim() || undefined;

  let snapshot;
  try {
    snapshot = await loadCoachingSnapshot(scope, { from, to, teamLeader: leader });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Could not load the Coaching data.", { status: 502 });
  }

  const report = buildOperationsReport(operationsInputFromSnapshot(snapshot), today);
  const range = `${from} – ${to}${leader ? ` · ${leader}` : ""}`;
  const html = renderCoachingOperationsHtml("Coaching", report, range);
  const filename = `Coaching_operations_report_${from}_to_${to}${leader ? `_${leader.replace(/[^a-z0-9]+/gi, "_")}` : ""}.html`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
}
