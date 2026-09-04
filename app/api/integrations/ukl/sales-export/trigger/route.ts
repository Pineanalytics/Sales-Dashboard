import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const BRANCHES = new Set(["NAIROBI", "NYERI"]);

function parseMonth(value: unknown): { start: Date; end: Date; label: string } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1) return null;
  return { start, end: new Date(Date.UTC(year, month, 0)), label: value };
}

function todayNairobi(): Date {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function datesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  for (let current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(new Date(current));
  }
  return dates;
}

/** Queues a selected calendar month for the Server PC. Each date is a
 * separate resumable job: the PC claims one each hour and calls its
 * existing C:\\ukl-sales-export-pull.ps1 command for that exact date. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  }

  let body: { branch?: unknown; month?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected {"branch":"NAIROBI|NYERI","month":"YYYY-MM"}.' }, { status: 400 });
  }
  const branch = typeof body.branch === "string" ? body.branch : null;
  if (!branch || !BRANCHES.has(branch)) {
    return NextResponse.json({ error: '"branch" must be "NAIROBI" or "NYERI".' }, { status: 400 });
  }
  const month = parseMonth(body.month);
  if (!month) return NextResponse.json({ error: '"month" must be a real YYYY-MM month.' }, { status: 400 });

  const latestAllowed = todayNairobi();
  if (month.start > latestAllowed) {
    return NextResponse.json({ error: "A future month cannot be exported." }, { status: 400 });
  }
  const end = month.end > latestAllowed ? latestAllowed : month.end;
  const requestedDates = datesInRange(month.start, end);
  const existing = await prisma.uklSalesExportTriggerRequest.findMany({
    where: { branch, status: { in: ["PENDING", "CLAIMED"] }, requestedDate: { gte: month.start, lte: end } },
    select: { requestedDate: true },
  });
  const existingDates = new Set(existing.map((job) => job.requestedDate.toISOString().slice(0, 10)));
  const newJobs = requestedDates.filter((date) => !existingDates.has(date.toISOString().slice(0, 10)));
  if (newJobs.length) {
    await prisma.uklSalesExportTriggerRequest.createMany({
      data: newJobs.map((requestedDate) => ({ branch, requestedDate, requestedBy: session.user.email ?? null })),
    });
  }

  return NextResponse.json({
    branch,
    month: month.label,
    queued: newJobs.length,
    alreadyQueued: requestedDates.length - newJobs.length,
    through: end.toISOString().slice(0, 10),
    partialMonth: end.getTime() !== month.end.getTime(),
  });
}
