import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only the owning Team Leader (or ADMIN) can write Rep Scorecard rows — a
 *  Supervisor reviewing the tracker sees the same rows read-only via the
 *  main GET /api/performance-tracker response, no separate read path here. */
async function assertCanEdit(trackerId: string, user: { role: string; teamLeaderId: string | null }): Promise<boolean> {
  const tracker = await prisma.performanceTracker.findUnique({ where: { id: trackerId } });
  if (!tracker || tracker.type !== "TEAM_LEADER" || !tracker.teamLeaderId) return false;
  if (user.role === "ADMIN") return true;
  return user.role === "TEAM_LEADER" && user.teamLeaderId === tracker.teamLeaderId;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body?.trackerId || !body?.repName) {
    return NextResponse.json({ error: '"trackerId" and "repName" are required.' }, { status: 400 });
  }
  if (!(await assertCanEdit(body.trackerId, session.user))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const row = await prisma.performanceTrackerRepRow.create({
    data: {
      trackerId: body.trackerId,
      repName: String(body.repName),
      employeeCode: body.employeeCode || null,
      territory: body.territory || null,
      channel: body.channel || null,
    },
  });
  return NextResponse.json({ row });
}

const NUMERIC_FIELDS = [
  "volumeTarget",
  "volumeActual",
  "revenueTarget",
  "revenueActual",
  "lppcTarget",
  "lppcActual",
  "callsPlanned",
  "callsMade",
  "productiveCalls",
  "oosAudited",
  "oosInstances",
] as const;
const TEXT_FIELDS = ["repName", "territory", "channel", "employeeCode"] as const;

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  const existing = await prisma.performanceTrackerRepRow.findUnique({ where: { id: body.id } });
  if (!existing) return NextResponse.json({ error: "Row not found." }, { status: 404 });
  if (!(await assertCanEdit(existing.trackerId, session.user))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  for (const f of NUMERIC_FIELDS) {
    if (f in body) data[f] = body[f] === "" || body[f] === null || body[f] === undefined ? null : Number(body[f]);
  }
  for (const f of TEXT_FIELDS) {
    if (f in body) data[f] = body[f] || null;
  }

  const row = await prisma.performanceTrackerRepRow.update({ where: { id: body.id }, data });
  return NextResponse.json({ row });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  const existing = await prisma.performanceTrackerRepRow.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Row not found." }, { status: 404 });
  if (!(await assertCanEdit(existing.trackerId, session.user))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  await prisma.performanceTrackerRepRow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
