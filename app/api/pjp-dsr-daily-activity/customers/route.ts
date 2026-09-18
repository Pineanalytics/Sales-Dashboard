import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer-level detail for the Leverage timestamp page, parallel to
// EABL Call Performance's "Customers"/"Salesman leaderboard" section but
// sourced from SalesReturnLine (invoice-line detail) rather than
// PjpDsrDailyActivity (which never persists individual customer identity —
// its own source query aggregates COUNT(DISTINCT OutletCode) into a scalar
// before it ever reaches Postgres; see pjpDsrDailyActivityQuery.ts). There is
// no "isProductive"/strike-rate signal here — every row is a completed
// invoice or return, never an unproductive call — so this deliberately does
// not add a strike-rate figure; see getLeverageMonthlyCoverageRollup's own
// doc comment in lib/jpAdherence.ts for the same reasoning applied to
// coverage.
//
// Same Month/Date/Branch filters and Nairobi-anchored day window as
// /api/pjp-dsr-daily-activity/summary, so switching either filter on the
// Leverage page moves both this section and the PJP/DSR activity section
// together.

function branchLabel(distributor: string): string {
  return SALES_RETURNS_BRANCH_LABELS[distributor] ?? distributor;
}

function monthKey(raw: string | null): string {
  const now = new Date();
  return raw && /^\d{4}-\d{2}$/.test(raw) ? raw : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function localWindow(month: string, selectedDate: string | null) {
  const key = selectedDate ?? `${month}-01`;
  const start = new Date(`${key}T00:00:00+03:00`);
  const end = new Date(start);
  if (selectedDate) end.setUTCDate(end.getUTCDate() + 1);
  else {
    const [year, monthNumber] = month.split("-").map(Number);
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    return { start, end: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+03:00`) };
  }
  return { start, end };
}

const number = (value: bigint | number | null | undefined) => (value == null ? 0 : Number(value));

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const rawMonth = request.nextUrl.searchParams.get("month");
  if (rawMonth && !/^\d{4}-\d{2}$/.test(rawMonth)) return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
  const month = monthKey(rawMonth);
  const selectedDate = request.nextUrl.searchParams.get("date");
  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return NextResponse.json({ error: '"date" must be YYYY-MM-DD.' }, { status: 400 });
  if (selectedDate && !selectedDate.startsWith(`${month}-`)) return NextResponse.json({ error: '"date" must fall within the selected month.' }, { status: 400 });
  const distributor = request.nextUrl.searchParams.get("distributor");
  if (distributor && !/^\d+$/.test(distributor)) return NextResponse.json({ error: '"distributor" must be a numeric branch code.' }, { status: 400 });
  // Keyed by name, not salesRepCode: this is the same identifier the page's
  // shared "Sales rep" filter already uses (populated from PjpDsrDailyActivity's
  // dsrName, sourced from the same DSR master table's NAME column) — filtering
  // here by name keeps one dropdown driving both sections of the page.
  const rep = request.nextUrl.searchParams.get("rep")?.trim() || null;
  if (rep && rep.length > 120) return NextResponse.json({ error: '"rep" is too long.' }, { status: 400 });

  const range = localWindow(month, selectedDate);
  const baseConditions = [Prisma.sql`"deliveryDate" >= ${range.start}`, Prisma.sql`"deliveryDate" < ${range.end}`];
  if (distributor) baseConditions.push(Prisma.sql`"storageLocation" = ${distributor}`);
  if (rep) baseConditions.push(Prisma.sql`"salesRepName" = ${rep}`);
  const where = Prisma.join(baseConditions, " AND ");

  type MetricsRow = { customers: bigint; reps: bigint; transactions: bigint; netSales: number };
  type RepRow = { salesRepName: string; storageLocation: string; customers: bigint; transactions: bigint; netSales: number };

  try {
    const [metrics, reps] = await Promise.all([
      prisma.$queryRaw<MetricsRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT "customerCode") AS customers, COUNT(DISTINCT "salesRepCode") AS reps,
          COUNT(*)::int AS transactions, COALESCE(SUM("netSale"), 0)::double precision AS "netSales"
        FROM "SalesReturnLine" WHERE ${where}`),
      prisma.$queryRaw<RepRow[]>(Prisma.sql`
        SELECT "salesRepName", "storageLocation",
          COUNT(DISTINCT "customerCode") AS customers, COUNT(*)::int AS transactions,
          COALESCE(SUM("netSale"), 0)::double precision AS "netSales"
        FROM "SalesReturnLine" WHERE ${where}
        GROUP BY "salesRepName", "storageLocation" ORDER BY customers DESC, "netSales" DESC`),
    ]);

    const metric = metrics[0];
    return NextResponse.json({
      scope: "Unilever · Leverage", month,
      metrics: {
        customers: number(metric?.customers), reps: number(metric?.reps),
        transactions: number(metric?.transactions), netSales: metric?.netSales ?? 0,
      },
      reps: reps.map((r) => ({
        salesRepName: r.salesRepName, distributor: r.storageLocation,
        distributorLabel: branchLabel(r.storageLocation), customers: number(r.customers),
        transactions: number(r.transactions), netSales: r.netSales,
      })),
      definitions: {
        customers: "Distinct customers with at least one invoice or return in the selected period, from the Sales & Returns invoice-line feed.",
        strikeRate: "Not available for this source: every row is a completed invoice or return, so there is no unproductive-call signal to compute a strike rate from (see the PJP/DSR activity section above for field visit timing instead).",
      },
    });
  } catch (error) {
    console.error("Failed to load Unilever Leverage customer detail", error);
    return NextResponse.json({ error: "Failed to load Unilever Leverage customer detail." }, { status: 500 });
  }
}
