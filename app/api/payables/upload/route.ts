import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type OpenItemRow = { id: string; vendorCode: string; vendorName: string; documentRef: string | null; transactionType: number; postingDate: string; dueDate: string; openBalance: number };

function validApiKey(req: NextRequest) {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

function validOpenItem(row: unknown): row is OpenItemRow {
  const r = row as Record<string, unknown>;
  return !!r && typeof r.id === "string" && typeof r.vendorCode === "string" && typeof r.vendorName === "string" && (r.documentRef === null || typeof r.documentRef === "string") && isFiniteNumber(r.transactionType) && isDate(r.postingDate) && isDate(r.dueDate) && isFiniteNumber(r.openBalance);
}

export async function POST(req: NextRequest) {
  if (!validApiKey(req)) return NextResponse.json({ error: "Invalid payables sync credential." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const payload = body as { sourceDate?: unknown; openItems?: unknown; ledgerBalance?: unknown } | null;
  if (!payload || !isDate(payload.sourceDate) || !Array.isArray(payload.openItems) || !isFiniteNumber(payload.ledgerBalance) || !payload.openItems.every(validOpenItem)) {
    return NextResponse.json({ error: "Invalid payables sync payload." }, { status: 400 });
  }

  const openItems = payload.openItems;
  const sourceDate = payload.sourceDate as string;
  const ledgerBalance = payload.ledgerBalance as number;
  const vendorCount = new Set(openItems.map((row) => row.vendorCode)).size;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.payableOpenItem.deleteMany();
      const convertedOpenItems = openItems.map((row) => ({ ...row, postingDate: new Date(row.postingDate), dueDate: new Date(row.dueDate) }));
      for (let start = 0; start < convertedOpenItems.length; start += 1_000) {
        await tx.payableOpenItem.createMany({ data: convertedOpenItems.slice(start, start + 1_000) });
      }
      await tx.payablesSyncRun.create({
        data: { sourceDate: new Date(sourceDate), vendorCount, openItemCount: openItems.length, ledgerBalance },
      });
    }, { timeout: 600_000 });
    return NextResponse.json({ vendorCount, openItemCount: openItems.length });
  } catch (error) {
    console.error("Failed to replace payables mirror", error);
    return NextResponse.json({ error: "Failed to save payables sync." }, { status: 500 });
  }
}
