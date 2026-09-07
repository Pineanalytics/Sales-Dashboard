import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasUklSalesExportKey } from "@/lib/uklSalesExportAuth";

export const runtime = "nodejs";

/** The Server PC owns the outbound poll. Claims expire after 55 minutes so a
 * stopped PowerShell process cannot leave a selected-month export stuck. */
export async function GET(request: NextRequest) {
  if (!hasUklSalesExportKey(request)) return NextResponse.json({ error: "Invalid export credentials." }, { status: 401 });

  const abandonedBefore = new Date(Date.now() - 55 * 60_000);
  const next = await prisma.uklSalesExportTriggerRequest.findFirst({
    where: { OR: [{ status: "PENDING" }, { status: "CLAIMED", claimedAt: { lt: abandonedBefore } }] },
    orderBy: [{ requestedAt: "asc" }, { requestedDate: "asc" }],
  });
  if (!next) return NextResponse.json({ pending: false });

  const claim = await prisma.uklSalesExportTriggerRequest.updateMany({
    where: { id: next.id, OR: [{ status: "PENDING" }, { status: "CLAIMED", claimedAt: { lt: abandonedBefore } }] },
    data: { status: "CLAIMED", claimedAt: new Date() },
  });
  if (claim.count === 0) return NextResponse.json({ pending: false });

  return NextResponse.json({ pending: true, id: next.id, branch: next.branch, date: next.requestedDate.toISOString().slice(0, 10) });
}
