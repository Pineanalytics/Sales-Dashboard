import { NextRequest, NextResponse } from "next/server";
import { findCachedAiInsight, generateAiInsights, defaultInsightsPeriod } from "@/lib/aiInsights";
import type { PeriodKind, PeriodSelection } from "@/lib/timeIntelligence";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS: PeriodKind[] = ["MTD", "MONTH", "QTD", "YTD", "H1", "H2", "Q1", "Q2", "Q3", "Q4", "CUSTOM"];

/** Reconstructs the caller's PeriodSelector/PrincipalSelector choice from
 *  query params, falling back to defaultInsightsPeriod() (this month to
 *  date) / all-principals when params are missing or malformed — matching
 *  what a fresh page load's default selection already is. */
function parseSelection(req: NextRequest): { selection: PeriodSelection; principalKey: string | null } {
  const params = req.nextUrl.searchParams;
  const kind = params.get("kind");
  const year = params.get("year");
  const principalKey = params.get("principal");
  if (!kind || !year || !VALID_KINDS.includes(kind as PeriodKind)) {
    return { selection: defaultInsightsPeriod(), principalKey };
  }
  const selection: PeriodSelection = {
    kind: kind as PeriodKind,
    year,
    month: params.get("month") ?? undefined,
    toYear: params.get("toYear") ?? undefined,
    toMonth: params.get("toMonth") ?? undefined,
  };
  return { selection, principalKey };
}

/** Returns the digest matching the caller's currently selected period/
 *  principal — served from cache when a fresh-enough one already exists
 *  (findCachedAiInsight's freshness window), otherwise generated on demand
 *  right here. This keeps the Insights card aligned with whatever the top
 *  PeriodSelector/PrincipalSelector is set to, rather than always showing a
 *  fixed "this month" digest regardless of what the viewer is looking at. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { selection, principalKey } = parseSelection(req);

  try {
    const cached = await findCachedAiInsight(selection, principalKey);
    if (cached) return NextResponse.json({ insight: cached });

    const insight = await generateAiInsights(selection, principalKey);
    return NextResponse.json({ insight });
  } catch (err) {
    console.error("Failed to load AI insight", err);
    return NextResponse.json({ error: "Failed to load AI insight." }, { status: 500 });
  }
}
