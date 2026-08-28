import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily CSV pull for the UKL integration's downstream upload system, which
 * today is fed by hand: someone runs the Sales & Returns SQL report, saves it
 * as a headerless CSV named `UKL_<BRANCH>_<DD.MM.YYYY>.csv`, and copies it to
 * a server the downstream system watches. This endpoint replaces the manual
 * "run report, save CSV" half of that — the destination server's own puller
 * script (see scripts/ukl-sales-export-pull.ps1) does the "copy to the watched
 * folder" half, since that folder lives on a third machine this app has no
 * network path to. Same shape as app/api/integrations/sap/sales-export: no
 * SQL Server credentials leave Pinefrost, auth is a single shared key.
 *
 * Column order/formatting is a direct match to the original hand-run report
 * (verified against a real UKL_NYERI export): 25 columns, no header row,
 * comma-separated, CRLF line endings. Fields the source report wrapped in
 * ISNULL(...,0) (invoiceDate, referenceDocument, referenceDocDate) render "0"
 * when null; every other nullable field renders empty, matching the report's
 * own lack of an ISNULL there.
 */

const MAX_ROWS = 50_000; // a single day's Sales & Returns lines is nowhere near this; a safety cap, not an expected ceiling.

function hasValidKey(request: NextRequest) {
  const expected = process.env.UKL_SALES_EXPORT_KEY;
  const provided = request.headers.get("x-ukl-export-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function isValidDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayNairobi(): string {
  // Africa/Nairobi has no DST — a fixed UTC+3 offset is safe here.
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function csvField(value: string | number | null): string {
  if (value === null) return "";
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** ISNULL(...,0)-style fields in the original report render "0" when null, not blank. */
function csvFieldOrZero(value: string | null): string {
  return value === null ? "0" : csvField(value);
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export async function GET(request: NextRequest) {
  if (!hasValidKey(request)) {
    return NextResponse.json({ error: "Invalid UKL export credentials." }, { status: 401 });
  }

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const date = isValidDate(dateParam) ? dateParam : todayNairobi();
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.salesReturnLine.findMany({
    where: { deliveryDate: { gte: start, lt: end } },
    orderBy: [{ invoiceNo: "asc" }, { sku: "asc" }],
    take: MAX_ROWS,
  });

  const lines = rows.map((r) =>
    [
      csvField(r.customerCode),
      csvField(r.salesRepCode),
      csvField(r.salesRepName),
      csvField(r.route),
      csvField(r.routeName),
      csvField(r.invoiceNo),
      csvFieldOrZero(dateOnly(r.invoiceDate)),
      csvField(r.documentType),
      csvField(r.documentTypeDesc),
      csvFieldOrZero(r.referenceDocument),
      csvFieldOrZero(dateOnly(r.referenceDocDate)),
      csvField(r.hdmsOrderNo),
      csvField(r.sku),
      csvField(r.skuDesc),
      csvField(r.storageLocation),
      csvField(r.piecesPerCase),
      csvField(r.listPricePerCase),
      csvField(r.saleQtyPieces),
      csvField(r.freeQtyPieces),
      csvField(r.grossSale),
      csvField(r.netSale),
      csvField(r.bonusDiscount),
      csvField(r.tradeDiscount),
      csvField(r.cashDiscount),
      csvField(r.totalDiscount),
    ].join(",")
  );

  return new NextResponse(lines.join("\r\n") + (lines.length ? "\r\n" : ""), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
  });
}
