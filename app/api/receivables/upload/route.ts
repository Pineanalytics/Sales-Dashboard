import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { upsertAgeingSnapshot } from "@/lib/receivablesAgeing";

export const runtime = "nodejs";

type CreditTermRow = { groupNum: number; name: string; extraDays: number; extraMonths: number };
type CustomerRow = { customerCode: string; customerName: string; active: boolean; creditLimit: number; masterBalance: number; termGroupNum: number | null; principal: string | null };
type OpenItemRow = { id: string; customerCode: string; documentRef: string | null; transactionType: number; postingDate: string; dueDate: string; taxDate: string | null; openBalance: number };

type PostDatedChequeRow = { customerCode: string; paymentNo: number; chequeNumber: number | null; bankCode: string | null; dueDate: string; amount: number };

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
  return !!r && typeof r.customerCode === "string" && typeof r.customerName === "string" && typeof r.active === "boolean" && isFiniteNumber(r.creditLimit) && isFiniteNumber(r.masterBalance) && (r.termGroupNum === null || isFiniteNumber(r.termGroupNum)) && (r.principal === null || typeof r.principal === "string");
}

function validOpenItem(row: unknown): row is OpenItemRow {
  const r = row as Record<string, unknown>;
  return !!r && typeof r.id === "string" && typeof r.customerCode === "string" && (r.documentRef === null || typeof r.documentRef === "string") && isFiniteNumber(r.transactionType) && isDate(r.postingDate) && isDate(r.dueDate) && (r.taxDate === null || isDate(r.taxDate)) && isFiniteNumber(r.openBalance);
}

function validCheque(row: unknown): row is PostDatedChequeRow {
  const r = row as Record<string, unknown>;
  return !!r && typeof r.customerCode === "string" && isFiniteNumber(r.paymentNo) && (r.chequeNumber === null || isFiniteNumber(r.chequeNumber)) && (r.bankCode === null || typeof r.bankCode === "string") && isDate(r.dueDate) && isFiniteNumber(r.amount);
}

export async function POST(req: NextRequest) {
  if (!validApiKey(req)) return NextResponse.json({ error: "Invalid receivables sync credential." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const payload = body as { sourceDate?: unknown; terms?: unknown; customers?: unknown; openItems?: unknown; postDatedCheques?: unknown; masterBalance?: unknown; ledgerBalance?: unknown } | null;
  if (!payload || !isDate(payload.sourceDate) || !Array.isArray(payload.terms) || !Array.isArray(payload.customers) || !Array.isArray(payload.openItems) || !isFiniteNumber(payload.masterBalance) || !isFiniteNumber(payload.ledgerBalance) || !payload.terms.every(validTerm) || !payload.customers.every(validCustomer) || !payload.openItems.every(validOpenItem) || (payload.postDatedCheques !== undefined && (!Array.isArray(payload.postDatedCheques) || !payload.postDatedCheques.every(validCheque)))) {
    return NextResponse.json({ error: "Invalid receivables sync payload." }, { status: 400 });
  }

  const terms = payload.terms;
  const customers = payload.customers;
  const openItems = payload.openItems;
  // Absent from an older worker's payload: leave the stored cheques alone in that case.
  const postDatedCheques = payload.postDatedCheques === undefined ? null : (payload.postDatedCheques as PostDatedChequeRow[]);
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
      const convertedOpenItems = openItems.map((row) => ({
        ...row,
        postingDate: new Date(row.postingDate),
        dueDate: new Date(row.dueDate),
        taxDate: row.taxDate ? new Date(row.taxDate) : null,
      }));
      for (let start = 0; start < convertedOpenItems.length; start += 1_000) {
        await tx.receivableOpenItem.createMany({ data: convertedOpenItems.slice(start, start + 1_000) });
      }
      if (postDatedCheques) {
        await tx.receivablesPostDatedCheque.deleteMany();
        const converted = postDatedCheques.map((row) => ({ ...row, dueDate: new Date(row.dueDate) }));
        for (let start = 0; start < converted.length; start += 1_000) {
          await tx.receivablesPostDatedCheque.createMany({ data: converted.slice(start, start + 1_000) });
        }
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
      await upsertAgeingSnapshot(tx, new Date(sourceDate), convertedOpenItems, false);
  }, { timeout: 600_000 });
    return NextResponse.json({ customerCount: customers.length, openItemCount: openItems.length, postDatedChequeCount: postDatedCheques?.length ?? 0, variance });
  } catch (error) {
    console.error("Failed to replace receivables mirror", error);
    return NextResponse.json({ error: "Failed to save receivables sync." }, { status: 500 });
  }
}
