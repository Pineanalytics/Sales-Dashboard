import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type CreditTermRow = { groupNum: number; name: string; extraDays: number; extraMonths: number };
type CustomerRow = { customerCode: string; customerName: string; active: boolean; creditLimit: number; masterBalance: number; termGroupNum: number | null };
type OpenItemRow = { id: string; customerCode: string; documentRef: string | null; transactionType: number; postingDate: string; dueDate: string; openBalance: number };

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

function validTerm(row: unknown): row is CreditTermRow {
  const r = row as Record<string, unknown>;
  return !!r && isFiniteNumber(r.groupNum) && typeof r.name === "string" && isFiniteNumber(r.extraDays) && isFiniteNumber(r.extraMonths);
}

function validCustomer(row: unknown): row is CustomerRow {
  const r = row as Record<string, unknown>;
  return !!r && typeof r.customerCode === "string" && typeof r.customerName === "string" && typeof r.active === "boolean" && isFiniteNumber(r.creditLimit) && isFiniteNumber(r.masterBalance) && (r.termGroupNum === null || isFiniteNumber(r.termGroupNum));
}

function validOpenItem(row: unknown): row is OpenItemRow {
  const r = row as Record<string, unknown>;
  return !!r && typeof r.id === "string" && typeof r.customerCode === "string" && (r.documentRef === null || typeof r.documentRef === "string") && isFiniteNumber(r.transactionType) && isDate(r.postingDate) && isDate(r.dueDate) && isFiniteNumber(r.openBalance);
}

export async function POST(req: NextRequest) {
  if (!validApiKey(req)) return NextResponse.json({ error: "Invalid receivables sync credential." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const payload = body as { sourceDate?: unknown; terms?: unknown; customers?: unknown; openItems?: unknown; masterBalance?: unknown; ledgerBalance?: unknown } | null;
  if (!payload || !isDate(payload.sourceDate) || !Array.isArray(payload.terms) || !Array.isArray(payload.customers) || !Array.isArray(payload.openItems) || !isFiniteNumber(payload.masterBalance) || !isFiniteNumber(payload.ledgerBalance) || !payload.terms.every(validTerm) || !payload.customers.every(validCustomer) || !payload.openItems.every(validOpenItem)) {
    return NextResponse.json({ error: "Invalid receivables sync payload." }, { status: 400 });
  }

  const terms = payload.terms;
  const customers = payload.customers;
  const openItems = payload.openItems;
  const sourceDate = payload.sourceDate as string;
  const masterBalance = payload.masterBalance as number;
  const ledgerBalance = payload.ledgerBalance as number;
  const variance = ledgerBalance - masterBalance;

  try {
    await prisma.$transaction(async (tx) => {
      for (const term of terms) {
        await tx.creditTerm.upsert({
          where: { groupNum: term.groupNum },
          create: term,
          update: { name: term.name, extraDays: term.extraDays, extraMonths: term.extraMonths },
        });
      }
      await tx.receivableOpenItem.deleteMany();
      await tx.customerCreditProfile.deleteMany();
      await tx.customerCreditProfile.createMany({ data: customers });
      for (let start = 0; start < openItems.length; start += 1_000) {
        await tx.receivableOpenItem.createMany({
          data: openItems.slice(start, start + 1_000).map((row) => ({ ...row, postingDate: new Date(row.postingDate), dueDate: new Date(row.dueDate) })),
        });
      }
      await tx.receivablesSyncRun.create({
        data: {
          sourceDate: new Date(sourceDate),
          customerCount: customers.length,
          openItemCount: openItems.length,
          masterBalance,
          ledgerBalance,
          variance,
        },
      });
  }, { timeout: 600_000 });
    return NextResponse.json({ customerCount: customers.length, openItemCount: openItems.length, variance });
  } catch (error) {
    console.error("Failed to replace receivables mirror", error);
    return NextResponse.json({ error: "Failed to save receivables sync." }, { status: 500 });
  }
}
