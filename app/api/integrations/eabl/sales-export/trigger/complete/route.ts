import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasEablSalesExportKey } from "@/lib/eablSalesExportAuth";
export async function POST(request: NextRequest) {
  if (!hasEablSalesExportKey(request)) return NextResponse.json({ error: "Invalid export credentials." }, { status: 401 });
  let body: { id?: unknown; success?: unknown; summary?: unknown }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Expected JSON." }, { status: 400 }); }
  if (typeof body.id !== "string" || typeof body.success !== "boolean") return NextResponse.json({ error: '"id" and boolean "success" are required.' }, { status: 400 });
  await prisma.eablSalesExportTriggerRequest.update({ where: { id: body.id }, data: { status: body.success ? "COMPLETED" : "FAILED", completedAt: new Date(), resultSummary: typeof body.summary === "string" ? body.summary.slice(0, 1_000) : null } });
  return NextResponse.json({ ok: true });
}
