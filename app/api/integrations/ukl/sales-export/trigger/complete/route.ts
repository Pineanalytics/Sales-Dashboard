import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasUklSalesExportKey } from "@/lib/uklSalesExportAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasUklSalesExportKey(request)) return NextResponse.json({ error: "Invalid export credentials." }, { status: 401 });
  let body: { id?: unknown; success?: unknown; summary?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with "id" and boolean "success".' }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.success !== "boolean") {
    return NextResponse.json({ error: '"id" and boolean "success" are required.' }, { status: 400 });
  }
  const result = await prisma.uklSalesExportTriggerRequest.updateMany({
    where: { id: body.id, status: "CLAIMED" },
    data: {
      status: body.success ? "COMPLETED" : "FAILED",
      completedAt: new Date(),
      resultSummary: typeof body.summary === "string" ? body.summary.slice(0, 1_000) : null,
    },
  });
  if (result.count === 0) return NextResponse.json({ error: "The export job is no longer claimed." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
