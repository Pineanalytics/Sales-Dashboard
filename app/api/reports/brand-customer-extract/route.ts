import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLiveBrandCustomerRows } from "@/lib/datasetStore";
import { normalizePrincipalKey } from "@/lib/normalize";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { buildBrandExtract, buildCustomerExtract, trimLargeExtract, type BrandCustomerExtract, type ExtractScope } from "@/lib/brandCustomerExtract";
import { buildSfaCustomerExtract } from "@/lib/sfaCustomerExtract";
import { missingSfaPeriods, onlyPrincipals } from "@/lib/sfaPortfolio";
import { getDashboardPrincipals, getSfaOutletRows } from "@/lib/sfaPortfolioData";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The detailed Excel extracts behind the Customer & Brand Portfolio page. Built here, not in the browser, because
// the raw sheet is one row per month, product, rep and customer: tens of thousands of rows for a single principal.
// A selection past LARGE_EXTRACT_RAW_ROWS gets the summary and breakdown sheets without the row-level ones (trimLargeExtract).
//
// Brands: SAP item-level rows (the customer there is the SAP billing account). Customers: the SFA outlet the sales app
// sold to, from the SFA-outlet tables; if any selected month is not loaded at outlet level it falls back to SAP
// billing accounts and the Summary says so.

interface MonthRef { year: string; monthIndex: number }

function periods(request: NextRequest, name: string): MonthRef[] {
  return request.nextUrl.searchParams.getAll(name).flatMap((value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    return match ? [{ year: match[1], monthIndex: Number(match[2]) - 1 }] : [];
  });
}

function label(request: NextRequest, name: string, fallback: string): string {
  const value = (request.nextUrl.searchParams.get(name) ?? "").trim().slice(0, 120);
  return value || fallback;
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "all";
}

/** Adds a line to an extract's Summary sheet. */
function withSummaryNote(extract: BrandCustomerExtract, note: [string, string]): BrandCustomerExtract {
  return { ...extract, sheets: extract.sheets.map((sheet) => (sheet.name === "Summary" ? { ...sheet, rows: [...sheet.rows, [], note] } : sheet)) };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.user.role !== "ADMIN" && !(session.user.allowedPages ?? []).includes("customers")) {
    return NextResponse.json({ error: "You do not have access to Customers & Brands." }, { status: 403 });
  }

  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "brands" && kind !== "customers") return NextResponse.json({ error: "Choose the brands or customers extract." }, { status: 400 });
  const currentPeriods = periods(request, "period");
  if (currentPeriods.length === 0) return NextResponse.json({ error: "Provide a selected period." }, { status: 400 });
  const priorYearPeriods = currentPeriods.map((p) => ({ year: String(Number(p.year) - 1), monthIndex: p.monthIndex }));

  const requestedKeys = new Set(request.nextUrl.searchParams.getAll("principal").map(normalizePrincipalKey));
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  const allowedKeys = scope ? new Set(scope.principals.map(normalizePrincipalKey)) : null;
  const inScope = (principal: string) => {
    const key = normalizePrincipalKey(principal);
    return (!allowedKeys || allowedKeys.has(key)) && (requestedKeys.size === 0 || requestedKeys.has(key));
  };

  try {
    const principalLabel = label(request, "principalLabel", "All principals");
    const periodLabel = label(request, "label", "Selected period");
    const extractScope: ExtractScope = { principalLabel, periodLabel, generatedAt: new Date() };

    let built: BrandCustomerExtract;
    if (kind === "customers") {
      const [sfaCurrent, sfaPrior, currentPrincipals, priorYearPrincipals] = await Promise.all([
        getSfaOutletRows(currentPeriods),
        getSfaOutletRows(priorYearPeriods),
        getDashboardPrincipals(currentPeriods),
        getDashboardPrincipals(priorYearPeriods),
      ]);
      const missing = missingSfaPeriods(currentPeriods, sfaCurrent);
      if (missing.length === 0) {
        const priorYearAvailable = missingSfaPeriods(priorYearPeriods, sfaPrior).length === 0;
        built = buildSfaCustomerExtract(
          {
            currentRows: onlyPrincipals(sfaCurrent, currentPrincipals).filter((row) => inScope(row.principal)),
            priorYearRows: priorYearAvailable ? onlyPrincipals(sfaPrior, priorYearPrincipals).filter((row) => inScope(row.principal)) : null,
          },
          extractScope
        );
      } else {
        const [current, priorYear] = await Promise.all([getLiveBrandCustomerRows(currentPeriods), getLiveBrandCustomerRows(priorYearPeriods)]);
        built = withSummaryNote(
          buildCustomerExtract({ currentRows: current.filter((row) => inScope(row.principal)), priorYearRows: priorYear.filter((row) => inScope(row.principal)) }, extractScope),
          ["Customer source", `SAP billing accounts, not SFA outlets: outlet-level sales are not loaded for ${missing.join(", ")}. Several outlets can sit behind one billing account.`]
        );
      }
    } else {
      const [current, priorYear] = await Promise.all([getLiveBrandCustomerRows(currentPeriods), getLiveBrandCustomerRows(priorYearPeriods)]);
      built = buildBrandExtract({ currentRows: current.filter((row) => inScope(row.principal)), priorYearRows: priorYear.filter((row) => inScope(row.principal)) }, extractScope);
    }
    const extract = trimLargeExtract(built);

    const body = extractToXlsxBuffer(extract.sheets);
    const filename = `${kind === "brands" ? "brand-performance" : "customer-analysis"}-detailed-${fileSlug(principalLabel)}-${fileSlug(periodLabel)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Raw-Rows": String(built.rawRowCount),
      },
    });
  } catch (error) {
    console.error("Failed to build the brand/customer extract", error);
    return NextResponse.json({ error: "Failed to build the extract." }, { status: 500 });
  }
}
