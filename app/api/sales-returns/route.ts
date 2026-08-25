import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getSalesReturnsSummary,
  getSalesReturnsTrend,
  getSalesReturnsByRep,
  getSalesReturnsByDocType,
  getSalesReturnLines,
  getAvailableDocumentTypes,
  type SalesReturnsFilters,
} from "@/lib/salesReturns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function parseDate(raw: string | null): Date | NextResponse | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD." }, { status: 400 });
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  return parsed;
}

function defaultRange(now: Date): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/** Live-computed Sales & Returns dashboard feed, reading SalesReturnLine directly
 *  (populated by scripts/db-bridge/sales-returns, a source separate from the rest
 *  of the app's SAP-derived Dataset — this route is intentionally self-contained,
 *  not merged into /api/dataset). Defaults to a trailing 30-day window so an
 *  unfiltered page load stays bounded. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const now = new Date();
  const defaults = defaultRange(now);
  const fromParam = parseDate(req.nextUrl.searchParams.get("from"));
  if (fromParam instanceof NextResponse) return fromParam;
  const toParam = parseDate(req.nextUrl.searchParams.get("to"));
  if (toParam instanceof NextResponse) return toParam;
  const from = fromParam ?? defaults.from;
  const to = toParam ?? defaults.to;
  const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

  const search = req.nextUrl.searchParams.get("search")?.trim() || null;
  const documentType = req.nextUrl.searchParams.get("documentType")?.trim() || null;
  const pageParam = Number(req.nextUrl.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const filters: SalesReturnsFilters = { from, toExclusive, search, documentType };

  try {
    const [summary, trend, byRep, byDocType, availableDocumentTypes, { rows, total }] = await Promise.all([
      getSalesReturnsSummary(filters),
      getSalesReturnsTrend(filters),
      getSalesReturnsByRep(filters),
      getSalesReturnsByDocType(filters),
      getAvailableDocumentTypes(),
      getSalesReturnLines(filters, page, PAGE_SIZE),
    ]);

    return NextResponse.json({
      summary,
      trend,
      byRep,
      byDocType,
      availableDocumentTypes,
      rows,
      pagination: { page, pageSize: PAGE_SIZE, total },
      range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    });
  } catch (err) {
    console.error("Failed to load Sales & Returns data", err);
    return NextResponse.json({ error: "Failed to load Sales & Returns data." }, { status: 500 });
  }
}
