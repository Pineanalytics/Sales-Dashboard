import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isSalesReturnsControlMode } from "@/lib/salesReturnsControl";

export const runtime = "nodejs";

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  const distributor = req.nextUrl.searchParams.get("distributor");
  if (!distributor) return NextResponse.json({ error: '"distributor" query param is required.' }, { status: 400 });
  const control = await prisma.salesReturnsControl.findUnique({ where: { distributor } });
  return NextResponse.json(
    control ?? { distributor, desiredMode: "SMART", version: 0, status: "APPLIED", requestedAt: null, acknowledgedAt: null }
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  }
  let body: { distributor?: unknown; desiredMode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with "distributor" and "desiredMode".' }, { status: 400 });
  }
  if (typeof body.distributor !== "string" || !/^\d+$/.test(body.distributor)) {
    return NextResponse.json({ error: '"distributor" must be a numeric branch code.' }, { status: 400 });
  }
  if (!isSalesReturnsControlMode(body.desiredMode)) {
    return NextResponse.json({ error: '"desiredMode" must be "SMART" or "CATCHUP".' }, { status: 400 });
  }

  const distributor = body.distributor;
  const desiredMode = body.desiredMode;
  const now = new Date();
  const control = await prisma.$transaction(async (tx) => {
    if (desiredMode === "CATCHUP") {
      await tx.salesReturnsTriggerRequest.updateMany({
        where: { distributor, backfillFrom: { not: null }, status: { in: ["PENDING", "CLAIMED"] } },
        data: { status: "FAILED", completedAt: now, resultSummary: "Cancelled by Stop backfill control." },
      });
    }
    return tx.salesReturnsControl.upsert({
      where: { distributor },
      create: {
        distributor,
        desiredMode,
        status: "PENDING",
        requestedBy: session.user.email ?? null,
        requestedAt: now,
      },
      update: {
        desiredMode,
        version: { increment: 1 },
        status: "PENDING",
        requestedBy: session.user.email ?? null,
        requestedAt: now,
        acknowledgedAt: null,
        resultSummary: null,
      },
    });
  });
  return NextResponse.json({ control });
}

export async function PATCH(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  let body: { distributor?: unknown; version?: unknown; status?: unknown; resultSummary?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a control acknowledgement." }, { status: 400 });
  }
  if (
    typeof body.distributor !== "string" ||
    typeof body.version !== "number" ||
    (body.status !== "APPLIED" && body.status !== "FAILED")
  ) {
    return NextResponse.json({ error: 'Valid "distributor", numeric "version", and APPLIED/FAILED "status" are required.' }, { status: 400 });
  }
  const updated = await prisma.salesReturnsControl.updateMany({
    where: { distributor: body.distributor, version: body.version },
    data: {
      status: body.status,
      acknowledgedAt: new Date(),
      resultSummary: typeof body.resultSummary === "string" ? body.resultSummary.slice(0, 2000) : null,
    },
  });
  return NextResponse.json({ ok: updated.count === 1, staleVersion: updated.count === 0 });
}
