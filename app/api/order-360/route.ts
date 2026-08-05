import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getOrder360Summary, type Order360Filters } from "@/lib/order360Summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(raw: string | null): Date | null | NextResponse {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: '"date" must be a YYYY-MM-DD value.' }, { status: 400 });
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: '"date" must be valid.' }, { status: 400 });
  return parsed;
}

const VALID_DAY_NAMES = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

function parseDayNames(raw: string | null): string[] | null | NextResponse {
  if (!raw) return null;
  const names = raw.split(",").map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (!names.every((n) => VALID_DAY_NAMES.has(n))) {
    return NextResponse.json({ error: '"dayNames" must be a comma-separated list of day names.' }, { status: 400 });
  }
  return names;
}

/** Live-computed Order 360 feed - no principal dimension exists in the source
 *  data (see lib/order360Summary.ts's header note), so this is gated purely by
 *  allowedPages plus the same TeamLeaderScope/principal-restricted-VIEWER FSR
 *  name matching Frost already applies to RepCall (lib/frost/tools.ts). */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const month = req.nextUrl.searchParams.get("month")?.trim() || null;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: '"month" must be a YYYY-MM value.' }, { status: 400 });
  }
  const weekLabel = req.nextUrl.searchParams.get("week")?.trim() || null;
  const date = parseDate(req.nextUrl.searchParams.get("date"));
  if (date instanceof NextResponse) return date;
  const dayNames = parseDayNames(req.nextUrl.searchParams.get("dayNames"));
  if (dayNames instanceof NextResponse) return dayNames;

  const filters: Order360Filters = { month, weekLabel: month ? weekLabel : null, date, dayNames };

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals);
    const summary = await getOrder360Summary(new Date(), scope, filters);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("Failed to load Order 360 data", err);
    return NextResponse.json({ error: "Failed to load Order 360 data." }, { status: 500 });
  }
}
