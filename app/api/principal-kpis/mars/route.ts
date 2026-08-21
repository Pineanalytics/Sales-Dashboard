import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRINCIPAL = "Mars";

type NullableText = string | null;
interface PeriodRow { fiscalYear: string; periodKey: string; periodNo: number; startDate: string; endDate: string }
interface ProductRow { itemNo: string; itemName: string; packSize: number | null; brand: NullableText; classification: NullableText; ssuConversion: number | null }
interface RosterRow { employeeCode: string; employeeName: string; employeeGroup: NullableText; location: NullableText; teamLeader: NullableText; fsr: NullableText; sellerType: NullableText; activeDays: number | null; active: boolean }
interface TargetRow { fiscalYear: string; periodKey: string; periodNo: number; employeeCode: string; employeeName: NullableText; employeeGroup: NullableText; location: NullableText; teamLeader: NullableText; fsr: NullableText; sellerType: NullableText; volumeTarget: number | null; valueTarget: number | null; universeTarget: number | null; coverageTarget: number | null; ssuTarget: number | null }
interface SaleLineRow { sourceKey: string; fiscalYear: string; periodKey: string; periodNo: number; date: string; employeeCode: NullableText; employeeName: NullableText; employeeGroup: NullableText; location: NullableText; teamLeader: NullableText; fsr: NullableText; sellerType: NullableText; customerId: string; customerName: NullableText; channel: NullableText; territory: NullableText; itemNo: NullableText; itemName: NullableText; brand: NullableText; classification: NullableText; qty: number; cases: number; ssu: number; revenue: number; invoiceNo: NullableText }

function validKey(req: NextRequest) {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
function text(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function nullableText(v: unknown): v is NullableText { return v === null || typeof v === "string"; }
function nullableNumber(v: unknown): v is number | null { return v === null || (typeof v === "number" && Number.isFinite(v)); }
function number(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function periodKey(v: unknown): v is string { return text(v) && /^P(?:0[1-9]|1[0-3])$/.test(v); }
function whole(v: unknown): v is number { return Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 13; }

function isPeriod(row: unknown): row is PeriodRow { if (!row || typeof row !== "object") return false; const r = row as Record<string, unknown>; return text(r.fiscalYear) && periodKey(r.periodKey) && whole(r.periodNo) && text(r.startDate) && text(r.endDate); }
function isProduct(row: unknown): row is ProductRow { if (!row || typeof row !== "object") return false; const r = row as Record<string, unknown>; return text(r.itemNo) && text(r.itemName) && nullableNumber(r.packSize) && nullableText(r.brand) && nullableText(r.classification) && nullableNumber(r.ssuConversion); }
function isRoster(row: unknown): row is RosterRow { if (!row || typeof row !== "object") return false; const r = row as Record<string, unknown>; return text(r.employeeCode) && text(r.employeeName) && nullableText(r.employeeGroup) && nullableText(r.location) && nullableText(r.teamLeader) && nullableText(r.fsr) && nullableText(r.sellerType) && nullableNumber(r.activeDays) && typeof r.active === "boolean"; }
function isTarget(row: unknown): row is TargetRow { if (!row || typeof row !== "object") return false; const r = row as Record<string, unknown>; return text(r.fiscalYear) && periodKey(r.periodKey) && whole(r.periodNo) && text(r.employeeCode) && nullableText(r.employeeName) && nullableText(r.employeeGroup) && nullableText(r.location) && nullableText(r.teamLeader) && nullableText(r.fsr) && nullableText(r.sellerType) && nullableNumber(r.volumeTarget) && nullableNumber(r.valueTarget) && nullableNumber(r.universeTarget) && nullableNumber(r.coverageTarget) && nullableNumber(r.ssuTarget); }
function isSaleLine(row: unknown): row is SaleLineRow { if (!row || typeof row !== "object") return false; const r = row as Record<string, unknown>; return text(r.sourceKey) && text(r.fiscalYear) && periodKey(r.periodKey) && whole(r.periodNo) && text(r.date) && nullableText(r.employeeCode) && nullableText(r.employeeName) && nullableText(r.employeeGroup) && nullableText(r.location) && nullableText(r.teamLeader) && nullableText(r.fsr) && nullableText(r.sellerType) && text(r.customerId) && nullableText(r.customerName) && nullableText(r.channel) && nullableText(r.territory) && nullableText(r.itemNo) && nullableText(r.itemName) && nullableText(r.brand) && nullableText(r.classification) && number(r.qty) && number(r.cases) && number(r.ssu) && number(r.revenue) && nullableText(r.invoiceNo); }

/** Imports the Mars workbook's fiscal dimensions, roster/targets and source
 * lines.  It is intentionally API-key-only so a local source workbook can be
 * read without copying a 190 MB file to the VPS. */
export async function POST(req: NextRequest) {
  if (!validKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Expected JSON payload." }, { status: 400 }); }
  const kind = body.kind;
  try {
    if (kind === "reference") {
      const periods = body.periods, products = body.products, roster = body.roster, targets = body.targets;
      if (!Array.isArray(periods) || !Array.isArray(products) || !Array.isArray(roster) || !Array.isArray(targets) || !periods.every(isPeriod) || !products.every(isProduct) || !roster.every(isRoster) || !targets.every(isTarget)) return NextResponse.json({ error: "Invalid Mars reference payload." }, { status: 400 });
      await prisma.$transaction(async (tx) => {
        for (const row of periods as PeriodRow[]) await tx.principalKpiPeriod.upsert({ where: { principal_fiscalYear_periodKey: { principal: PRINCIPAL, fiscalYear: row.fiscalYear, periodKey: row.periodKey } }, update: { periodNo: row.periodNo, startDate: new Date(row.startDate), endDate: new Date(row.endDate) }, create: { ...row, principal: PRINCIPAL, startDate: new Date(row.startDate), endDate: new Date(row.endDate) } });
        for (const row of products as ProductRow[]) await tx.principalKpiProduct.upsert({ where: { principal_itemNo: { principal: PRINCIPAL, itemNo: row.itemNo } }, update: row, create: { ...row, principal: PRINCIPAL } });
        for (const row of roster as RosterRow[]) await tx.principalKpiRoster.upsert({ where: { principal_employeeCode: { principal: PRINCIPAL, employeeCode: row.employeeCode } }, update: row, create: { ...row, principal: PRINCIPAL } });
        for (const row of targets as TargetRow[]) await tx.principalKpiTarget.upsert({ where: { principal_fiscalYear_periodKey_employeeCode: { principal: PRINCIPAL, fiscalYear: row.fiscalYear, periodKey: row.periodKey, employeeCode: row.employeeCode } }, update: row, create: { ...row, principal: PRINCIPAL } });
      });
      return NextResponse.json({ periods: periods.length, products: products.length, roster: roster.length, targets: targets.length });
    }
    if (kind === "actuals") {
      const rows = body.rows;
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > 1_000 || !rows.every(isSaleLine)) return NextResponse.json({ error: "Actuals must be 1-1,000 valid sales lines." }, { status: 400 });
      if (body.reset === true) await prisma.principalKpiSaleLine.deleteMany({ where: { principal: PRINCIPAL } });
      const result = await prisma.principalKpiSaleLine.createMany({ data: (rows as SaleLineRow[]).map((row) => ({ ...row, principal: PRINCIPAL, date: new Date(row.date) })), skipDuplicates: true });
      return NextResponse.json({ inserted: result.count });
    }
    return NextResponse.json({ error: 'Unsupported import kind. Use "reference" or "actuals".' }, { status: 400 });
  } catch (error) {
    console.error("Mars KPI import failed", error);
    return NextResponse.json({ error: "Failed to save Mars KPI data." }, { status: 500 });
  }
}

function pct(actual: number, target: number) { return target > 0 ? (actual / target) * 100 : null; }

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.user.role !== "ADMIN" && !(session.user.allowedPages ?? []).includes("principal-kpis")) return NextResponse.json({ error: "You don't have access to Principal KPIs." }, { status: 403 });
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  if (scope && !scope.principals.some((p) => p.trim().toLowerCase().includes("mars"))) return NextResponse.json({ error: "Mars isn't one of your assigned principals." }, { status: 403 });

  const requestedYear = req.nextUrl.searchParams.get("year");
  const latest = requestedYear ? null : await prisma.principalKpiSaleLine.findFirst({ where: { principal: PRINCIPAL }, orderBy: [{ fiscalYear: "desc" }, { periodNo: "desc" }], select: { fiscalYear: true, periodNo: true } });
  const fiscalYear = requestedYear ?? latest?.fiscalYear;
  if (!fiscalYear) return NextResponse.json({ principal: PRINCIPAL, available: false });
  const requestedPeriod = Number(req.nextUrl.searchParams.get("period"));
  const selectedPeriod = Number.isInteger(requestedPeriod) && requestedPeriod >= 1 && requestedPeriod <= 13 ? requestedPeriod : latest?.fiscalYear === fiscalYear ? latest.periodNo : 13;
  const priorYear = String(Number(fiscalYear) - 1);
  const base = Prisma.sql`"principal" = ${PRINCIPAL}`;
  const [actualRows, targetRows, periods, byPeriod, bySeller, byBrand] = await Promise.all([
    prisma.$queryRaw<{ fiscalYear: string; ptdSsu: number; ytdSsu: number; ptdCases: number; ytdCases: number; ptdRevenue: number; ytdRevenue: number; ptdOutlets: number; ytdOutlets: number }[]>(Prisma.sql`
      SELECT "fiscalYear",
        COALESCE(SUM(ssu) FILTER (WHERE "periodNo" = ${selectedPeriod}),0)::double precision AS "ptdSsu",
        COALESCE(SUM(ssu) FILTER (WHERE "periodNo" <= ${selectedPeriod}),0)::double precision AS "ytdSsu",
        COALESCE(SUM(cases) FILTER (WHERE "periodNo" = ${selectedPeriod}),0)::double precision AS "ptdCases",
        COALESCE(SUM(cases) FILTER (WHERE "periodNo" <= ${selectedPeriod}),0)::double precision AS "ytdCases",
        COALESCE(SUM(revenue) FILTER (WHERE "periodNo" = ${selectedPeriod}),0)::double precision AS "ptdRevenue",
        COALESCE(SUM(revenue) FILTER (WHERE "periodNo" <= ${selectedPeriod}),0)::double precision AS "ytdRevenue",
        COUNT(DISTINCT "customerId") FILTER (WHERE "periodNo" = ${selectedPeriod})::int AS "ptdOutlets",
        COUNT(DISTINCT "customerId") FILTER (WHERE "periodNo" <= ${selectedPeriod})::int AS "ytdOutlets"
      FROM "PrincipalKpiSaleLine" WHERE ${base} AND "fiscalYear" IN (${fiscalYear}, ${priorYear}) GROUP BY "fiscalYear"
    `),
    prisma.$queryRaw<{ fiscalYear: string; ptdSsuTarget: number; ytdSsuTarget: number; fullSsuTarget: number; ptdValueTarget: number; ytdValueTarget: number; fullValueTarget: number; ptdUniverseTarget: number; ytdCoverageTarget: number }[]>(Prisma.sql`
      SELECT "fiscalYear", COALESCE(SUM("ssuTarget") FILTER (WHERE "periodNo" = ${selectedPeriod}),0)::double precision AS "ptdSsuTarget", COALESCE(SUM("ssuTarget") FILTER (WHERE "periodNo" <= ${selectedPeriod}),0)::double precision AS "ytdSsuTarget", COALESCE(SUM("ssuTarget"),0)::double precision AS "fullSsuTarget", COALESCE(SUM("valueTarget") FILTER (WHERE "periodNo" = ${selectedPeriod}),0)::double precision AS "ptdValueTarget", COALESCE(SUM("valueTarget") FILTER (WHERE "periodNo" <= ${selectedPeriod}),0)::double precision AS "ytdValueTarget", COALESCE(SUM("valueTarget"),0)::double precision AS "fullValueTarget", COALESCE(SUM("universeTarget") FILTER (WHERE "periodNo" = ${selectedPeriod}),0)::double precision AS "ptdUniverseTarget", COALESCE(SUM("coverageTarget") FILTER (WHERE "periodNo" <= ${selectedPeriod}),0)::double precision AS "ytdCoverageTarget"
      FROM "PrincipalKpiTarget" WHERE ${base} AND "fiscalYear" = ${fiscalYear} GROUP BY "fiscalYear"
    `),
    prisma.principalKpiPeriod.findMany({ where: { principal: PRINCIPAL, fiscalYear }, orderBy: { periodNo: "asc" }, select: { periodKey: true, periodNo: true, startDate: true, endDate: true } }),
    prisma.$queryRaw<{ periodKey: string; periodNo: number; ssu: number; revenue: number; outlets: number }[]>(Prisma.sql`SELECT "periodKey", "periodNo", COALESCE(SUM(ssu),0)::double precision AS ssu, COALESCE(SUM(revenue),0)::double precision AS revenue, COUNT(DISTINCT "customerId")::int AS outlets FROM "PrincipalKpiSaleLine" WHERE ${base} AND "fiscalYear" = ${fiscalYear} AND "periodNo" <= ${selectedPeriod} GROUP BY "periodKey", "periodNo" ORDER BY "periodNo"`),
    prisma.$queryRaw<{ name: string; ssu: number; revenue: number; outlets: number }[]>(Prisma.sql`SELECT COALESCE(NULLIF("sellerType",''),'Unspecified') AS name, COALESCE(SUM(ssu),0)::double precision AS ssu, COALESCE(SUM(revenue),0)::double precision AS revenue, COUNT(DISTINCT "customerId")::int AS outlets FROM "PrincipalKpiSaleLine" WHERE ${base} AND "fiscalYear" = ${fiscalYear} AND "periodNo" <= ${selectedPeriod} GROUP BY 1 ORDER BY ssu DESC`),
    prisma.$queryRaw<{ name: string; ssu: number; revenue: number }[]>(Prisma.sql`SELECT COALESCE(NULLIF(brand,''),'Unspecified') AS name, COALESCE(SUM(ssu),0)::double precision AS ssu, COALESCE(SUM(revenue),0)::double precision AS revenue FROM "PrincipalKpiSaleLine" WHERE ${base} AND "fiscalYear" = ${fiscalYear} AND "periodNo" <= ${selectedPeriod} GROUP BY 1 ORDER BY ssu DESC LIMIT 12`),
  ]);
  const actual = new Map(actualRows.map((row) => [row.fiscalYear, row]));
  const target = targetRows[0] ?? { ptdSsuTarget: 0, ytdSsuTarget: 0, fullSsuTarget: 0, ptdValueTarget: 0, ytdValueTarget: 0, fullValueTarget: 0, ptdUniverseTarget: 0, ytdCoverageTarget: 0 };
  const current = actual.get(fiscalYear) ?? { ptdSsu: 0, ytdSsu: 0, ptdCases: 0, ytdCases: 0, ptdRevenue: 0, ytdRevenue: 0, ptdOutlets: 0, ytdOutlets: 0 };
  const prior = actual.get(priorYear) ?? { ptdSsu: 0, ytdSsu: 0, ptdCases: 0, ytdCases: 0, ptdRevenue: 0, ytdRevenue: 0, ptdOutlets: 0, ytdOutlets: 0 };
  return NextResponse.json({ principal: PRINCIPAL, available: true, fiscalYear, priorYear, selectedPeriod, periods, summary: { current, prior, target, ptdAchievement: pct(current.ptdSsu, target.ptdSsuTarget), ytdAchievement: pct(current.ytdSsu, target.ytdSsuTarget), fullYearAchievement: pct(current.ytdSsu, target.fullSsuTarget), ptdGrowth: prior.ptdSsu > 0 ? ((current.ptdSsu / prior.ptdSsu) - 1) * 100 : null, ytdGrowth: prior.ytdSsu > 0 ? ((current.ytdSsu / prior.ytdSsu) - 1) * 100 : null, ptdCoverage: pct(current.ptdOutlets, target.ptdUniverseTarget) }, byPeriod, bySeller, byBrand });
}
