import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fileSlug } from "@/lib/customerExtractScope";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";
import { normalizePrincipalKey } from "@/lib/normalize";
import { canSeeReport } from "@/lib/pageAccess";
import { salesLineCoverage } from "@/lib/salesLinesData";
import { getDashboardPrincipals } from "@/lib/sfaPortfolioData";
import type { MonthRef } from "@/lib/sfaPortfolio";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { buildTradingTerms } from "@/lib/tradingTerms";
import { loadTermAccounts, loadTermSales } from "@/lib/tradingTermsData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MONTHS = 24;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const monthNumber = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

// The Financials page's Trading terms tab. ?from=YYYY-MM&to=YYYY-MM (default: the year to date), ?principal=Mars (repeat
// for more) and ?format=xlsx for the Excel report or csv for every customer's terms with every principal; otherwise the
// screen's summary.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canSeeReport(session.user.role, session.user.allowedPages ?? [], "receivables")) return NextResponse.json({ error: "You do not have access to Receivables." }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const from = params.get("from") || `${thisMonth.slice(0, 4)}-01`;
  const to = params.get("to") || thisMonth;
  if (!MONTH.test(from) || !MONTH.test(to) || from > to || monthNumber(to) - monthNumber(from) >= MAX_MONTHS) {
    return NextResponse.json({ error: `Choose a from and a to month, in order and no more than ${MAX_MONTHS} months apart.` }, { status: 400 });
  }
  const periods: MonthRef[] = [];
  for (let n = monthNumber(from); n <= monthNumber(to); n += 1) periods.push({ year: String(Math.floor(n / 12)), monthIndex: n % 12 });

  try {
    const [scope, dashboardPrincipals, coverage] = await Promise.all([
      resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId),
      getDashboardPrincipals(periods),
      salesLineCoverage(periods),
    ]);
    const allowed = scope ? new Set(scope.principals.map(normalizePrincipalKey)) : null;
    const visible = [...dashboardPrincipals].filter((principal) => !allowed || allowed.has(normalizePrincipalKey(principal))).sort();
    const requested = params.getAll("principal");
    const requestedKeys = new Set(requested.map(normalizePrincipalKey));
    const selected = visible.filter((principal) => requestedKeys.size === 0 || requestedKeys.has(normalizePrincipalKey(principal)));

    const [sales, { accounts, asOf }] = await Promise.all([loadTermSales(from, to, selected), loadTermAccounts()]);
    const report = buildTradingTerms(sales.monthRows, sales.customerRows, accounts);
    const missingMonths = coverage.missing;

    const format = params.get("format");
    if (format !== "xlsx" && format !== "csv") {
      // A month read before terms were carried has sales and none of them with a term.
      const withTerm = new Set(sales.monthRows.filter((row) => row.paymentTerm).map((row) => row.month));
      const monthsWithoutTerms = [...new Set(sales.monthRows.map((row) => row.month))].filter((month) => !withTerm.has(month)).sort();
      return NextResponse.json({
        from,
        to,
        availablePrincipals: [...new Set(visible.map((principal) => principal.split("-")[0].trim()))],
        missingMonths,
        monthsWithoutTerms,
        dataAsOf: coverage.dataAsOf,
        receivablesAsOf: asOf,
        summary: report.summary,
      });
    }

    const principalLabel = requested.length > 0 ? requested.join(", ") : "All principals";
    const filename = `trading-terms-${fileSlug(principalLabel)}-${from}-to-${to}`;
    const headers = { "Cache-Control": "private, no-store" };
    if (format === "csv") {
      const encoder = new TextEncoder();
      const lines = report.csv();
      let started = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          // Handed over a few hundred rows at a time, so the whole file is never held as one string.
          let chunk = started ? "" : "﻿";
          started = true;
          for (let i = 0; i < 500; i += 1) {
            const next = lines.next();
            if (next.done) {
              if (chunk) controller.enqueue(encoder.encode(chunk));
              controller.close();
              return;
            }
            chunk += next.value;
          }
          controller.enqueue(encoder.encode(chunk));
        },
      });
      return new NextResponse(stream, { status: 200, headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"` } });
    }

    const body = extractToXlsxBuffer(report.sheets({ principalLabel, periodLabel: `${from} to ${to}`, generatedAt: new Date(), dataAsOf: coverage.dataAsOf, receivablesAsOf: asOf, missingMonths }));
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}.xlsx"` },
    });
  } catch (error) {
    console.error("Failed to build the trading terms report", error);
    return NextResponse.json({ error: "Failed to build the trading terms report." }, { status: 500 });
  }
}
