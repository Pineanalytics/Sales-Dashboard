import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Read/write the per-bridge SyncWatermark row scripts/db-bridge/*/run.ts uses
// to decide full-vs-incremental sync mode. API-key only (no session fallback)
// — this is a machine-to-machine endpoint, not something an admin uses from
// the browser, unlike the /upload routes it sits next to.
function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }
  const bridge = req.nextUrl.searchParams.get("bridge");
  if (!bridge) {
    return NextResponse.json({ error: '"bridge" query param is required.' }, { status: 400 });
  }
  const row = await prisma.syncWatermark.findUnique({ where: { bridge } });
  return NextResponse.json({
    lastIncrementalAt: row?.lastIncrementalAt?.toISOString() ?? null,
    lastFullResyncAt: row?.lastFullResyncAt?.toISOString() ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.bridge !== "string" || typeof b.lastIncrementalAt !== "string") {
    return NextResponse.json({ error: '"bridge" and "lastIncrementalAt" are required.' }, { status: 400 });
  }
  const lastFullResyncAt = typeof b.lastFullResyncAt === "string" ? new Date(b.lastFullResyncAt) : undefined;

  await prisma.syncWatermark.upsert({
    where: { bridge: b.bridge },
    create: {
      bridge: b.bridge,
      lastIncrementalAt: new Date(b.lastIncrementalAt),
      lastFullResyncAt: lastFullResyncAt ?? null,
    },
    update: {
      lastIncrementalAt: new Date(b.lastIncrementalAt),
      ...(lastFullResyncAt ? { lastFullResyncAt } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
