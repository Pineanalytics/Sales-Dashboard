import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasEablSalesExportKey } from "@/lib/eablSalesExportAuth";
export async function GET(request: NextRequest) {
  if (!hasEablSalesExportKey(request)) return NextResponse.json({ error: "Invalid export credentials." }, { status: 401 });
  const job = await prisma.eablSalesExportTriggerRequest.findFirst({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" } });
  if (!job) return NextResponse.json({ request: null });
  const claimed = await prisma.eablSalesExportTriggerRequest.update({ where: { id: job.id }, data: { status: "CLAIMED", claimedAt: new Date() } });
  return NextResponse.json({ request: { id: claimed.id, mode: claimed.mode, date: claimed.requestedDate?.toISOString().slice(0, 10) ?? null } });
}
