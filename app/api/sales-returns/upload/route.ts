import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface SalesReturnLineUploadRow {
  customerCode: string;
  salesRepCode: string;
  salesRepName: string;
  route: string | null;
  routeName: string;
  invoiceNo: string;
  invoiceDate: string | null;
  deliveryDate: string;
  documentType: string;
  documentTypeDesc: string;
  referenceDocument: string | null;
  referenceDocDate: string | null;
  hdmsOrderNo: string | null;
  sku: string;
  skuDesc: string;
  storageLocation: string;
  piecesPerCase: number | null;
  listPricePerCase: number | null;
  saleQtyPieces: number;
  freeQtyPieces: number;
  grossSale: number;
  netSale: number;
  bonusDiscount: number;
  tradeDiscount: number;
  cashDiscount: number;
  totalDiscount: number;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is SalesReturnLineUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  const nullableNumber = (v: unknown) => v === null || typeof v === "number";
  return (
    typeof row.customerCode === "string" &&
    typeof row.salesRepCode === "string" &&
    typeof row.salesRepName === "string" &&
    nullableString(row.route) &&
    typeof row.routeName === "string" &&
    typeof row.invoiceNo === "string" &&
    nullableString(row.invoiceDate) &&
    typeof row.deliveryDate === "string" &&
    typeof row.documentType === "string" &&
    typeof row.documentTypeDesc === "string" &&
    nullableString(row.referenceDocument) &&
    nullableString(row.referenceDocDate) &&
    nullableString(row.hdmsOrderNo) &&
    typeof row.sku === "string" &&
    typeof row.skuDesc === "string" &&
    typeof row.storageLocation === "string" &&
    nullableNumber(row.piecesPerCase) &&
    nullableNumber(row.listPricePerCase) &&
    typeof row.saleQtyPieces === "number" &&
    typeof row.freeQtyPieces === "number" &&
    typeof row.grossSale === "number" &&
    typeof row.netSale === "number" &&
    typeof row.bonusDiscount === "number" &&
    typeof row.tradeDiscount === "number" &&
    typeof row.cashDiscount === "number" &&
    typeof row.totalDiscount === "number"
  );
}

/** Replaces a bounded delivery-date window. API-key-only, same pattern as the
 *  EABL Call Performance bridge (app/api/eabl-call-performance/upload/route.ts) —
 *  a browser session can never overwrite this feed. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { lines?: unknown; windowStart?: unknown; windowEnd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "lines" array.' }, { status: 400 });
  }
  if (!Array.isArray(body.lines) || !body.lines.every(isValidRow)) {
    return NextResponse.json({ error: "One or more Sales & Returns lines are invalid." }, { status: 400 });
  }

  const parseDate = (value: unknown) => (typeof value === "string" ? new Date(value) : null);
  const windowStart = parseDate(body.windowStart);
  const windowEnd = parseDate(body.windowEnd);
  if ((windowStart && Number.isNaN(windowStart.getTime())) || (windowEnd && Number.isNaN(windowEnd.getTime()))) {
    return NextResponse.json({ error: "Window dates must be valid ISO timestamps." }, { status: 400 });
  }

  const lines = body.lines as SalesReturnLineUploadRow[];
  try {
    await prisma.$transaction(
      async (tx) => {
        // Scoped to this batch's own storageLocation(s) (the field the source
        // query calls DISTRIBUTOR) — not just the date window. This table is
        // shared across branches (e.g. Nairobi/Nyeri, each running its own
        // scheduled sync against this same endpoint); without this, one
        // branch's run would delete-and-replace the whole window, wiping out
        // another branch's rows for the same dates. Skipped when lines is
        // empty (the "window checked, nothing found" marker — see run.ts) —
        // there's no way to safely identify which branch's rows a zero-row
        // batch belongs to, so we leave existing rows untouched rather than
        // risk deleting the wrong branch's data.
        if (windowStart && windowEnd && lines.length > 0) {
          const storageLocations = Array.from(new Set(lines.map((line) => line.storageLocation)));
          await tx.salesReturnLine.deleteMany({
            where: { deliveryDate: { gte: windowStart, lt: windowEnd }, storageLocation: { in: storageLocations } },
          });
        }
        for (let index = 0; index < lines.length; index += CHUNK_SIZE) {
          await tx.salesReturnLine.createMany({
            data: lines.slice(index, index + CHUNK_SIZE).map((row) => ({
              ...row,
              sourceRowKey: `${row.invoiceNo}|${row.sku}`,
              invoiceDate: row.invoiceDate ? new Date(row.invoiceDate) : null,
              deliveryDate: new Date(row.deliveryDate),
              referenceDocDate: row.referenceDocDate ? new Date(row.referenceDocDate) : null,
            })),
          });
        }
      },
      { timeout: 60_000 }
    );
    return NextResponse.json({ count: lines.length });
  } catch (error) {
    console.error("Failed to replace Sales & Returns lines", error);
    return NextResponse.json({ error: "Failed to save Sales & Returns data." }, { status: 500 });
  }
}
