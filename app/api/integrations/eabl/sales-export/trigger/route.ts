import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseIsoDate } from "@/lib/eablSalesExport";

export async function POST(request: NextRequest) {
  const session = await auth(); if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  let body: { mode?: unknown; date?: unknown }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Expected JSON." }, { status: 400 }); }
  const mode = body.mode === "SMART" ? "SMART" : body.mode === "DATE" ? "DATE" : null;
  const date = typeof body.date === "string" ? parseIsoDate(body.date) : null;
  if (!mode || (mode === "DATE" && !date) || (mode === "SMART" && body.date !== undefined)) return NextResponse.json({ error: 'Use {"mode":"SMART"} or {"mode":"DATE","date":"YYYY-MM-DD"}.' }, { status: 400 });
  const existing = await prisma.eablSalesExportTriggerRequest.findFirst({ where: { status: { in: ["PENDING", "CLAIMED"] } }, orderBy: { requestedAt: "desc" } });
  if (existing) return NextResponse.json({ request: existing, alreadyQueued: true });
  const queued = await prisma.eablSalesExportTriggerRequest.create({ data: { mode, requestedDate: date ? new Date(`${date}T00:00:00.000Z`) : null, requestedBy: session.user.email ?? null } });
  return NextResponse.json({ request: queued, alreadyQueued: false });
}
