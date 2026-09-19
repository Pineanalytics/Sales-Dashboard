import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { normalizePrincipalKey } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PRINCIPAL = "Mars";
type Mode = "FISCAL" | "MONTH";
type Period = { periodKey: string; periodNo: number; startDate: Date; endDate: Date };
type Target = { periodKey: string; periodNo: number; customerId: string; customerName: string | null; category: string; tier: string | null; area: string | null; casesTarget: number; ssuTarget: number };

function text(value: string | null) { return value?.trim() || null; }
function validMonth(value: string | null) { return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
function daysInclusive(start: Date, end: Date) { return Math.round((Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / 86_400_000) + 1; }
function overlapWeight(period: Period, start: Date, endExclusive: Date) {
  const periodStart = period.startDate.getTime();
  const periodEndExclusive = period.endDate.getTime() + 86_400_000;
  const overlapStart = Math.max(periodStart, start.getTime());
  const overlapEnd = Math.min(periodEndExclusive, endExclusive.getTime());
  return overlapEnd > overlapStart ? (overlapEnd - overlapStart) / (daysInclusive(period.startDate, period.endDate) * 86_400_000) : 0;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  const PRINCIPAL = req.nextUrl.searchParams.get("principal")?.trim() || DEFAULT_PRINCIPAL;
  if (scope && !scope.principals.some((p) => normalizePrincipalKey(p) === normalizePrincipalKey(PRINCIPAL))) {
    return NextResponse.json({ error: `${PRINCIPAL} isn't one of your assigned principals.` }, { status: 403 });
  }

  const mode: Mode = req.nextUrl.searchParams.get("mode") === "MONTH" ? "MONTH" : "FISCAL";
  const liveState = await prisma.syncWatermark.findUnique({ where: { bridge: "mars-kpis-pine" }, select: { lastFullResyncAt: true } });
  const defaultSource = liveState?.lastFullResyncAt ? "PINE" : "WORKBOOK";
  const latest = await prisma.principalKpiSaleLine.findFirst({ where: { principal: PRINCIPAL, source: defaultSource }, orderBy: [{ fiscalYear: "desc" }, { date: "desc" }], select: { fiscalYear: true, periodNo: true, date: true } });
  if (!latest) return NextResponse.json({ available: false });
  const fiscalYear = req.nextUrl.searchParams.get("year") ?? latest.fiscalYear;
  const source = liveState?.lastFullResyncAt && await prisma.principalKpiSaleLine.count({ where: { principal: PRINCIPAL, source: "PINE", fiscalYear } }) > 0 ? "PINE" : "WORKBOOK";
  const periods = await prisma.principalKpiPeriod.findMany({ where: { principal: PRINCIPAL, fiscalYear }, orderBy: { periodNo: "asc" }, select: { periodKey: true, periodNo: true, startDate: true, endDate: true } });
  if (periods.length === 0) return NextResponse.json({ available: false });

  const requestedPeriod = Number(req.nextUrl.searchParams.get("period"));
  const selectedPeriod = Number.isInteger(requestedPeriod) && requestedPeriod >= 1 && requestedPeriod <= 13 ? requestedPeriod : latest.periodNo;
  const fiscalWindow = periods.find((period) => period.periodNo === selectedPeriod) ?? periods.at(-1)!;
  const requestedMonth = req.nextUrl.searchParams.get("month");
  const monthStart = validMonth(requestedMonth) ? new Date(`${requestedMonth}-01T00:00:00.000Z`) : new Date(Date.UTC(latest.date.getUTCFullYear(), latest.date.getUTCMonth(), 1));
  const monthEndExclusive = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const windowStart = mode === "MONTH" ? monthStart : fiscalWindow.startDate;
  const windowEndExclusive = mode === "MONTH" ? monthEndExclusive : new Date(fiscalWindow.endDate.getTime() + 86_400_000);
  const windowLabel = mode === "MONTH" ? monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : fiscalWindow.periodKey;

  const dimensions = [
    ["sellerType", text(req.nextUrl.searchParams.get("sellerType"))], ["employeeGroup", text(req.nextUrl.searchParams.get("employeeGroup"))],
    ["location", text(req.nextUrl.searchParams.get("location"))], ["teamLeader", text(req.nextUrl.searchParams.get("teamLeader"))], ["fsr", text(req.nextUrl.searchParams.get("fsr"))],
  ] as const;
  const filters = dimensions.filter(([, value]) => value).map(([column, value]) => Prisma.sql`"${Prisma.raw(column)}" = ${value}`);
  const targets = await prisma.principalKpiJbpTarget.findMany({ where: { principal: PRINCIPAL, fiscalYear }, select: { periodKey: true, periodNo: true, customerId: true, customerName: true, category: true, tier: true, area: true, casesTarget: true, ssuTarget: true } }) as Target[];
  if (targets.length === 0) return NextResponse.json({ available: false, fiscalYear, periods });

  const periodByKey = new Map(periods.map((period) => [period.periodKey, period]));
  const allocated = new Map<string, { customerId: string; customerName: string | null; category: string; tier: string | null; area: string | null; casesTarget: number; ssuTarget: number }>();
  for (const target of targets) {
    const period = periodByKey.get(target.periodKey);
    if (!period) continue;
    const weight = overlapWeight(period, windowStart, windowEndExclusive);
    if (!weight) continue;
    const key = `${target.customerId}|${target.category}`;
    const current = allocated.get(key) ?? { customerId: target.customerId, customerName: target.customerName, category: target.category, tier: target.tier, area: target.area, casesTarget: 0, ssuTarget: 0 };
    current.casesTarget += target.casesTarget * weight;
    current.ssuTarget += target.ssuTarget * weight;
    allocated.set(key, current);
  }
  const customerIds = [...new Set(targets.map((target) => target.customerId))];
  const base = Prisma.join([Prisma.sql`"principal" = ${PRINCIPAL}`, Prisma.sql`"source" = ${source}`, Prisma.sql`date >= ${windowStart}`, Prisma.sql`date < ${windowEndExclusive}`, Prisma.sql`"customerId" IN (${Prisma.join(customerIds)})`, ...filters], " AND ");
  const actualRows = await prisma.$queryRaw<{ customerId: string; category: string; cases: number; ssu: number }[]>(Prisma.sql`
    SELECT "customerId", COALESCE(NULLIF(classification, ''), COALESCE(NULLIF(brand, ''), 'Unclassified')) AS category,
      COALESCE(SUM(cases), 0)::double precision AS cases, COALESCE(SUM(ssu), 0)::double precision AS ssu
    FROM "PrincipalKpiSaleLine" WHERE ${base} GROUP BY 1, 2
  `);
  const actualByCategory = new Map(actualRows.map((row) => [`${row.customerId}|${row.category}`, row]));
  const actualByCustomer = new Map<string, { cases: number; ssu: number }>();
  for (const row of actualRows) { const value = actualByCustomer.get(row.customerId) ?? { cases: 0, ssu: 0 }; value.cases += row.cases; value.ssu += row.ssu; actualByCustomer.set(row.customerId, value); }
  const rows = [...allocated.values()].map((target) => {
    const actual = target.category === "Overall Target" ? actualByCustomer.get(target.customerId) ?? { cases: 0, ssu: 0 } : actualByCategory.get(`${target.customerId}|${target.category}`) ?? { cases: 0, ssu: 0 };
    return { ...target, cases: actual.cases, ssu: actual.ssu, casesAchievement: target.casesTarget > 0 ? (actual.cases / target.casesTarget) * 100 : null, ssuAchievement: target.ssuTarget > 0 ? (actual.ssu / target.ssuTarget) * 100 : null };
  }).sort((a, b) => a.category.localeCompare(b.category) || (a.tier ?? "").localeCompare(b.tier ?? "") || a.customerName?.localeCompare(b.customerName ?? "") || 0);
  const categories = [...new Set(rows.map((row) => row.category))].map((category) => {
    const categoryRows = rows.filter((row) => row.category === category);
    const casesTarget = categoryRows.reduce((sum, row) => sum + row.casesTarget, 0), cases = categoryRows.reduce((sum, row) => sum + row.cases, 0);
    const ssuTarget = categoryRows.reduce((sum, row) => sum + row.ssuTarget, 0), ssu = categoryRows.reduce((sum, row) => sum + row.ssu, 0);
    return { category, casesTarget, cases, casesAchievement: casesTarget > 0 ? (cases / casesTarget) * 100 : null, ssuTarget, ssu, ssuAchievement: ssuTarget > 0 ? (ssu / ssuTarget) * 100 : null };
  });
  const overall = categories.find((row) => row.category === "Overall Target") ?? null;
  return NextResponse.json({ available: true, fiscalYear, source, mode, selectedPeriod: fiscalWindow.periodNo, selectedMonth: monthStart.toISOString().slice(0, 7), windowLabel, periods, overall, categories, rows });
}
