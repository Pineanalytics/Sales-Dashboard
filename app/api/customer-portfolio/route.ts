import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLiveBrandCustomerRows, getLiveDailyBrandCustomerRows } from "@/lib/datasetStore";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { applyCanonicalPortfolioComparisons, summarizeCustomerPortfolio, type CustomerPortfolioSummary } from "@/lib/customerPortfolio";
import { missingSfaPeriods, sfaDocumentsToPortfolioRows, sfaOutletKey, sfaOutletRowsToPortfolioRows } from "@/lib/sfaPortfolio";
import { getSfaDocumentRows, getSfaOutletRows } from "@/lib/sfaPortfolioData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MonthRef { year: string; monthIndex: number }

function periods(request: NextRequest, name: string): MonthRef[] {
  return request.nextUrl.searchParams.getAll(name).flatMap((value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    return match ? [{ year: match[1], monthIndex: Number(match[2]) - 1 }] : [];
  });
}

function keySet(values: MonthRef[]) { return new Set(values.map((value) => `${value.year}|${value.monthIndex}`)); }
function monthStart(period: MonthRef) { return new Date(Date.UTC(Number(period.year), period.monthIndex, 1)); }
function monthEnd(period: MonthRef, day?: number) {
  const lastDay = new Date(Date.UTC(Number(period.year), period.monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(Number(period.year), period.monthIndex, Math.min(day ?? lastDay, lastDay)));
}
function previousPeriod(period: MonthRef): MonthRef {
  return period.monthIndex === 0 ? { year: String(Number(period.year) - 1), monthIndex: 11 } : { year: period.year, monthIndex: period.monthIndex - 1 };
}
function priorYearPeriod(period: MonthRef): MonthRef { return { year: String(Number(period.year) - 1), monthIndex: period.monthIndex }; }

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const currentPeriods = periods(request, "period");
  const latestPeriods = periods(request, "latestPeriod");
  const previousPeriods = periods(request, "previousPeriod");
  const priorYearPeriods = periods(request, "priorYearPeriod");
  if (currentPeriods.length === 0) return NextResponse.json({ error: "Provide a selected period." }, { status: 400 });

  const latest = latestPeriods[0] ?? currentPeriods[currentPeriods.length - 1];
  const previous = previousPeriods[0] ?? previousPeriod(latest);
  const requestedPrincipalNames = request.nextUrl.searchParams.getAll("principal");
  const requestedPrincipalKeys = new Set(requestedPrincipalNames.map(normalizePrincipalKey));
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  const allowedKeys = scope ? new Set(scope.principals.map(normalizePrincipalKey)) : null;
  const inScope = (principal: string) => {
    const key = normalizePrincipalKey(principal);
    return (!allowedKeys || allowedKeys.has(key)) && (requestedPrincipalKeys.size === 0 || requestedPrincipalKeys.has(key));
  };
  const allPeriods = [...currentPeriods, ...latestPeriods, ...previousPeriods, ...priorYearPeriods];
  const currentKeys = keySet(currentPeriods);
  const latestKeys = keySet(latestPeriods.length > 0 ? latestPeriods : [latest]);
  const priorYearKeys = keySet(priorYearPeriods.length > 0 ? priorYearPeriods : currentPeriods.map(priorYearPeriod));

  try {
    const latestStart = monthStart(latest);
    const latestNaturalEnd = monthEnd(latest);
    const latestDaily = (await prisma.dailySalesActual.findMany({
      where: { date: { gte: latestStart, lte: latestNaturalEnd } },
      select: { date: true, principal: true, revenue: true },
    })).filter((row) => inScope(row.principal));
    const comparisonDay = latestDaily.length > 0 ? Math.max(...latestDaily.map((row) => row.date.getUTCDate())) : null;
    const effectiveDay = comparisonDay ?? latestNaturalEnd.getUTCDate();
    const previousStart = monthStart(previous);
    const previousEnd = monthEnd(previous, effectiveDay);
    const lyLatest = priorYearPeriod(latest);
    const lyLatestStart = monthStart(lyLatest);
    const lyLatestEnd = monthEnd(lyLatest, effectiveDay);

    // Customers are the SFA outlets (U_CustomerName) when every requested month is loaded at outlet level,
    // otherwise the SAP billing accounts (CardName), exactly as before, and the response says which.
    const priorYearRequested = priorYearPeriods.length > 0 ? priorYearPeriods : currentPeriods.map(priorYearPeriod);
    const [sfaCurrent, sfaPriorYear] = await Promise.all([getSfaOutletRows(currentPeriods), getSfaOutletRows(priorYearRequested)]);
    const missingSfa = missingSfaPeriods(currentPeriods, sfaCurrent);
    const useSfa = missingSfa.length === 0;

    const [rows, previousDayRows, monthlySales, previousDaily, lyLatestDaily] = await Promise.all([
      // Outlet portfolios still take their brand/product breakdown from the item-level rows, but only for the selected months.
      getLiveBrandCustomerRows(useSfa ? currentPeriods : allPeriods),
      useSfa ? Promise.resolve([]) : getLiveDailyBrandCustomerRows(previousStart, previousEnd),
      prisma.salesRecord.findMany({
        where: { OR: [...currentPeriods, ...priorYearPeriods, previous].map((period) => ({ year: period.year, monthIndex: period.monthIndex })) },
        select: { year: true, monthIndex: true, principal: true, revenue: true },
      }),
      prisma.dailySalesActual.findMany({ where: { date: { gte: previousStart, lte: previousEnd } }, select: { principal: true, revenue: true } }),
      prisma.dailySalesActual.findMany({ where: { date: { gte: lyLatestStart, lte: lyLatestEnd } }, select: { principal: true, revenue: true } }),
    ]);

    const scopedRows = rows.filter((row) => inScope(row.principal));
    const scopedPreviousDayRows = previousDayRows.filter((row) => inScope(row.principal));
    const scopedMonthly = monthlySales.filter((row) => inScope(row.principal));
    const belongs = (row: { year: string; monthIndex: number }, keys: Set<string>) => keys.has(`${row.year}|${row.monthIndex}`);
    const sum = <T,>(values: T[], value: (row: T) => number) => values.reduce((total, row) => total + value(row), 0);

    const currentRevenue = sum(scopedMonthly.filter((row) => belongs(row, currentKeys)), (row) => row.revenue);
    const priorYearRevenue = sum(scopedMonthly.filter((row) => belongs(row, priorYearKeys)), (row) => row.revenue);
    const latestMonthRevenue = sum(latestDaily, (row) => row.revenue);
    const previousMonthRevenue = sum(previousDaily.filter((row) => inScope(row.principal)), (row) => row.revenue);
    const previousFullMonthRevenue = sum(scopedMonthly.filter((row) => row.year === previous.year && row.monthIndex === previous.monthIndex), (row) => row.revenue);
    const priorCompletedKeys = new Set(currentPeriods.filter((period) => !(period.year === latest.year && period.monthIndex === latest.monthIndex)).map((period) => `${Number(period.year) - 1}|${period.monthIndex}`));
    const priorCompletedRevenue = sum(scopedMonthly.filter((row) => belongs(row, priorCompletedKeys)), (row) => row.revenue);
    const scopedLyLatestDaily = lyLatestDaily.filter((row) => inScope(row.principal));
    const lyspRevenue = scopedLyLatestDaily.length > 0 ? priorCompletedRevenue + sum(scopedLyLatestDaily, (row) => row.revenue) : null;

    let portfolio: CustomerPortfolioSummary;
    if (useSfa) {
      // Month-on-month is day-aligned from the invoices themselves (the monthly outlet rows carry no day): the same
      // days of the latest and the previous month. A mixed-principal invoice counts under its dominant principal here.
      const [latestDocs, previousDocs] = await Promise.all([getSfaDocumentRows(latestStart, monthEnd(latest, effectiveDay)), getSfaDocumentRows(previousStart, previousEnd)]);
      const latestMonthRows = sfaDocumentsToPortfolioRows(latestDocs.filter((doc) => inScope(doc.principal)));
      const previousMonthRows = sfaDocumentsToPortfolioRows(previousDocs.filter((doc) => inScope(doc.principal)));
      const priorYearAvailable = missingSfaPeriods(priorYearRequested, sfaPriorYear).length === 0;
      portfolio = summarizeCustomerPortfolio({
        currentRows: sfaOutletRowsToPortfolioRows(sfaCurrent.filter((row) => inScope(row.principal))),
        latestMonthRows,
        previousMonthRows,
        priorYearRows: priorYearAvailable ? sfaOutletRowsToPortfolioRows(sfaPriorYear.filter((row) => inScope(row.principal))) : [],
        customerKey: sfaOutletKey,
        brandRows: scopedRows.filter((row) => belongs(row, currentKeys)),
      });
      portfolio.meta = { customerSource: "SFA", missingSfaPeriods: [], priorYearAvailable, momAvailable: previousDocs.length > 0 };
    } else {
      portfolio = summarizeCustomerPortfolio({
        currentRows: scopedRows.filter((row) => belongs(row, currentKeys)),
        latestMonthRows: scopedRows.filter((row) => belongs(row, latestKeys)),
        previousMonthRows: scopedPreviousDayRows,
        priorYearRows: scopedRows.filter((row) => belongs(row, priorYearKeys)),
      });
      portfolio.meta = { customerSource: "ACCOUNT", missingSfaPeriods: missingSfa, priorYearAvailable: true, momAvailable: true };
    }
    const result = applyCanonicalPortfolioComparisons(portfolio, { revenue: currentRevenue, priorYearRevenue, lyspRevenue, latestMonthRevenue, previousMonthRevenue, previousFullMonthRevenue, comparisonDay });
    return NextResponse.json({ portfolio: { ...result, meta: portfolio.meta } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load customer portfolio", error);
    return NextResponse.json({ error: "Failed to load customer portfolio." }, { status: 500 });
  }
}
