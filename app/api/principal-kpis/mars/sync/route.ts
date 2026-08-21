// Machine-to-machine Mars bridge.  It exposes only the reference mappings a
// Pine worker needs and stages direct fact lines beside the workbook baseline.
// The browser route switches to PINE only after `complete-full` succeeds.
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRINCIPAL = "Mars";
const BRIDGE = "mars-kpis-pine";
const MAX_BATCH = 750;

type NullableText = string | null;
interface SaleLineRow {
  sourceKey: string; fiscalYear: string; periodKey: string; periodNo: number; date: string;
  transactionType: "sale" | "sale_return" | "order" | "order_return" | "no_sale"; saleType: "Actual" | "Offers" | "Returns" | "No sale"; isReturn: boolean;
  employeeCode: NullableText; employeeName: NullableText; employeeGroup: NullableText; location: NullableText;
  teamLeader: NullableText; fsr: NullableText; sellerType: NullableText; customerId: string; customerName: NullableText;
  channel: NullableText; territory: NullableText; itemNo: NullableText; itemName: NullableText; brand: NullableText;
  classification: NullableText; qty: number; cases: number; ssu: number; revenue: number; invoiceNo: NullableText;
}

function validKey(req: NextRequest) {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function nullableText(value: unknown): value is NullableText { return value === null || typeof value === "string"; }
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function periodKey(value: unknown): value is string { return text(value) && /^P(?:0[1-9]|1[0-3])$/.test(value); }
function periodNo(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 13; }
function validDate(value: unknown): value is string { return text(value) && !Number.isNaN(new Date(value).getTime()); }
function isSaleLine(row: unknown): row is SaleLineRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return text(r.sourceKey) && r.sourceKey.startsWith("pine/") && text(r.fiscalYear) && periodKey(r.periodKey) && periodNo(r.periodNo) && validDate(r.date)
    && ["sale", "sale_return", "order", "order_return", "no_sale"].includes(String(r.transactionType)) && ["Actual", "Offers", "Returns", "No sale"].includes(String(r.saleType)) && typeof r.isReturn === "boolean"
    && nullableText(r.employeeCode) && nullableText(r.employeeName) && nullableText(r.employeeGroup) && nullableText(r.location)
    && nullableText(r.teamLeader) && nullableText(r.fsr) && nullableText(r.sellerType) && text(r.customerId) && nullableText(r.customerName)
    && nullableText(r.channel) && nullableText(r.territory) && nullableText(r.itemNo) && nullableText(r.itemName) && nullableText(r.brand)
    && nullableText(r.classification) && number(r.qty) && number(r.cases) && number(r.ssu) && number(r.revenue) && nullableText(r.invoiceNo);
}

export async function GET(req: NextRequest) {
  if (!validKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  const [periods, products, roster, rtmCustomers, state] = await Promise.all([
    prisma.principalKpiPeriod.findMany({ where: { principal: PRINCIPAL }, orderBy: [{ fiscalYear: "asc" }, { periodNo: "asc" }], select: { fiscalYear: true, periodKey: true, periodNo: true, startDate: true, endDate: true } }),
    prisma.principalKpiProduct.findMany({ where: { principal: PRINCIPAL }, select: { itemNo: true, itemName: true, packSize: true, brand: true, classification: true, ssuConversion: true } }),
    prisma.principalKpiRoster.findMany({ where: { principal: PRINCIPAL }, select: { employeeCode: true, employeeName: true, employeeGroup: true, location: true, teamLeader: true, fsr: true, sellerType: true } }),
    prisma.principalKpiRtmCustomer.findMany({ where: { principal: PRINCIPAL }, select: { customerId: true, rtmType: true, assignedRep: true } }),
    prisma.syncWatermark.findUnique({ where: { bridge: BRIDGE }, select: { lastIncrementalAt: true, lastFullResyncAt: true } }),
  ]);
  return NextResponse.json({
    periods, products, roster, rtmCustomers,
    state: { lastIncrementalAt: state?.lastIncrementalAt?.toISOString() ?? null, lastFullResyncAt: state?.lastFullResyncAt?.toISOString() ?? null },
  });
}

export async function POST(req: NextRequest) {
  if (!validKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Expected JSON payload." }, { status: 400 }); }
  try {
    if (body.action === "begin-full") {
      await prisma.$transaction([
        prisma.principalKpiSaleLine.deleteMany({ where: { principal: PRINCIPAL, source: "PINE" } }),
        prisma.syncWatermark.upsert({ where: { bridge: BRIDGE }, create: { bridge: BRIDGE, lastIncrementalAt: new Date(0), lastFullResyncAt: null }, update: { lastIncrementalAt: new Date(0), lastFullResyncAt: null } }),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "rows") {
      const rows = body.rows;
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_BATCH || !rows.every(isSaleLine)) return NextResponse.json({ error: `rows must contain 1-${MAX_BATCH} valid direct Pine sales lines.` }, { status: 400 });
      const result = await prisma.principalKpiSaleLine.createMany({ data: (rows as SaleLineRow[]).map((row) => ({ ...row, principal: PRINCIPAL, source: "PINE", date: new Date(row.date) })), skipDuplicates: true });
      return NextResponse.json({ inserted: result.count });
    }
    if (body.action === "complete-full" || body.action === "complete-incremental") {
      if (!validDate(body.lastIncrementalAt)) return NextResponse.json({ error: "lastIncrementalAt must be a valid ISO timestamp." }, { status: 400 });
      if (body.action === "complete-full") {
        const count = await prisma.principalKpiSaleLine.count({ where: { principal: PRINCIPAL, source: "PINE" } });
        if (count === 0) return NextResponse.json({ error: "Cannot activate an empty Pine snapshot." }, { status: 409 });
      }
      const timestamp = new Date(body.lastIncrementalAt);
      await prisma.syncWatermark.upsert({
        where: { bridge: BRIDGE },
        create: { bridge: BRIDGE, lastIncrementalAt: timestamp, lastFullResyncAt: body.action === "complete-full" ? timestamp : null },
        update: { lastIncrementalAt: timestamp, ...(body.action === "complete-full" ? { lastFullResyncAt: timestamp } : {}) },
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported action. Use "begin-full", "rows", "complete-full", or "complete-incremental".' }, { status: 400 });
  } catch (error) {
    console.error("Mars Pine sync failed", error);
    return NextResponse.json({ error: "Failed to save Mars Pine data." }, { status: 500 });
  }
}
