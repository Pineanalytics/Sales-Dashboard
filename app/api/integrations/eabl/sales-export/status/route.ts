import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasEablSalesExportKey } from "@/lib/eablSalesExportAuth";

export const runtime = "nodejs";
function asDate(value: unknown): Date | null { if (typeof value !== "string") return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }

export async function POST(request: NextRequest) {
  if (!hasEablSalesExportKey(request)) return NextResponse.json({ error: "Invalid export credentials." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Expected a JSON status body." }, { status: 400 }); }
  if (typeof body.machine !== "string" || !body.machine || typeof body.status !== "string") return NextResponse.json({ error: '"machine" and "status" are required.' }, { status: 400 });
  const text = (value: unknown) => typeof value === "string" ? value.slice(0, 1_000) : null;
  await prisma.eablSalesExportStatus.upsert({ where: { machine: body.machine }, create: {
    machine: body.machine, status: body.status, latestVpsTransactionDate: asDate(body.latestVpsTransactionDate), latestAvailableReportDate: asDate(body.latestAvailableReportDate),
    lastSuccessfulDownloadAt: asDate(body.lastSuccessfulDownloadAt), lastDeliveredFile: text(body.lastDeliveredFile), deliveredLocation: text(body.deliveredLocation), lastError: text(body.lastError), nextScheduledRunAt: asDate(body.nextScheduledRunAt),
  }, update: {
    status: body.status, latestVpsTransactionDate: asDate(body.latestVpsTransactionDate), latestAvailableReportDate: asDate(body.latestAvailableReportDate),
    lastSuccessfulDownloadAt: asDate(body.lastSuccessfulDownloadAt), lastDeliveredFile: text(body.lastDeliveredFile), deliveredLocation: text(body.deliveredLocation), lastError: text(body.lastError), nextScheduledRunAt: asDate(body.nextScheduledRunAt),
  } });
  return NextResponse.json({ ok: true });
}
