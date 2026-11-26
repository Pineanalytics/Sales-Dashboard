import { NextRequest, NextResponse } from "next/server";
import { getLiveBrandCustomerRows } from "@/lib/datasetStore";
import { buildBrandExtract, buildCustomerExtract, combineExtracts, LARGE_EXTRACT_RAW_ROWS, trimLargeExtract, type BrandCustomerExtract, type ExtractScope } from "@/lib/brandCustomerExtract";
import { createCustomerLineExtract } from "@/lib/customerLineExtract";
import { customerExtractAccess, fileSlug, requestPeriods } from "@/lib/customerExtractScope";
import { countSalesLines, loadOutletDirectory, rankingLineBatches, salesLineBatches, salesLineCoverage } from "@/lib/salesLinesData";
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
// kind=all is the Reports page's one-workbook Customers & Brands download: the customer sheets, then the brand sheets.
//
// Brands: SAP item-level rows (the customer there is the SAP billing account). Customers: built from SAP invoice lines
// (lib/customerLineExtract.ts: SFA customer ranking and the raw lines) when every selected month is held line by line.
// Otherwise from the SFA-outlet tables, and failing that SAP billing accounts; the Summary says which.

function label(request: NextRequest, name: string, fallback: string): string {
  const value = (request.nextUrl.searchParams.get(name) ?? "").trim().slice(0, 120);
  return value || fallback;
}

/** Adds a line to an extract's Summary sheet. */
function withSummaryNote(extract: BrandCustomerExtract, note: [string, string]): BrandCustomerExtract {
  return { ...extract, sheets: extract.sheets.map((sheet) => (sheet.name === "Summary" ? { ...sheet, rows: [...sheet.rows, [], note] } : sheet)) };
}

export async function GET(request: NextRequest) {
  const access = await customerExtractAccess(request);
  if ("refusal" in access) return access.refusal;
  const { inScope } = access;

  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "brands" && kind !== "customers" && kind !== "all") return NextResponse.json({ error: "Choose the brands, customers or all (Customers & Brands) extract." }, { status: 400 });
  const currentPeriods = requestPeriods(request, "period");
  if (currentPeriods.length === 0) return NextResponse.json({ error: "Provide a selected period." }, { status: 400 });
  const priorYearPeriods = currentPeriods.map((p) => ({ year: String(Number(p.year) - 1), monthIndex: p.monthIndex }));

  try {
    const principalLabel = label(request, "principalLabel", "All principals");
    const periodLabel = label(request, "label", "Selected period");
    const extractScope: ExtractScope = { principalLabel, periodLabel, generatedAt: new Date() };

    const lineExtract = async (dataAsOf: Date | null): Promise<BrandCustomerExtract> => {
      // The same principals as the page: the dashboard's own, within the viewer's scope and the selection.
      const principals = [...(await getDashboardPrincipals(currentPeriods))].filter(inScope);
      const whole = (await countSalesLines(currentPeriods, principals)) <= LARGE_EXTRACT_RAW_ROWS;
      const builder = createCustomerLineExtract({ rawRowLimit: LARGE_EXTRACT_RAW_ROWS, directory: await loadOutletDirectory() });
      const batches = whole ? salesLineBatches(currentPeriods, principals) : rankingLineBatches(currentPeriods, principals);
      for await (const batch of batches) builder.add(batch, whole);
      return builder.finish(extractScope, dataAsOf);
    };
    const customersExtract = async (): Promise<BrandCustomerExtract> => {
      const coverage = await salesLineCoverage(currentPeriods);
      if (coverage.missing.length === 0) return lineExtract(coverage.dataAsOf);
      const extract = await outletExtract();
      return withSummaryNote(extract, ["Raw invoice lines", `Not loaded yet for ${coverage.missing.join(", ")}, so this is the summarised layout without them.`]);
    };
    const outletExtract = async (): Promise<BrandCustomerExtract> => {
      const [sfaCurrent, sfaPrior, currentPrincipals, priorYearPrincipals] = await Promise.all([
        getSfaOutletRows(currentPeriods),
        getSfaOutletRows(priorYearPeriods),
        getDashboardPrincipals(currentPeriods),
        getDashboardPrincipals(priorYearPeriods),
      ]);
      const missing = missingSfaPeriods(currentPeriods, sfaCurrent);
      if (missing.length === 0) {
        const priorYearAvailable = missingSfaPeriods(priorYearPeriods, sfaPrior).length === 0;
        return buildSfaCustomerExtract(
          {
            currentRows: onlyPrincipals(sfaCurrent, currentPrincipals).filter((row) => inScope(row.principal)),
            priorYearRows: priorYearAvailable ? onlyPrincipals(sfaPrior, priorYearPrincipals).filter((row) => inScope(row.principal)) : null,
          },
          extractScope
        );
      }
      const [current, priorYear] = await Promise.all([getLiveBrandCustomerRows(currentPeriods), getLiveBrandCustomerRows(priorYearPeriods)]);
      return withSummaryNote(
        buildCustomerExtract({ currentRows: current.filter((row) => inScope(row.principal)), priorYearRows: priorYear.filter((row) => inScope(row.principal)) }, extractScope),
        ["Customer source", `SAP billing accounts, not SFA outlets: outlet-level sales are not loaded for ${missing.join(", ")}. Several outlets can sit behind one billing account.`]
      );
    };
    const brandsExtract = async (): Promise<BrandCustomerExtract> => {
      const [current, priorYear] = await Promise.all([getLiveBrandCustomerRows(currentPeriods), getLiveBrandCustomerRows(priorYearPeriods)]);
      return buildBrandExtract({ currentRows: current.filter((row) => inScope(row.principal)), priorYearRows: priorYear.filter((row) => inScope(row.principal)) }, extractScope);
    };

    let built: BrandCustomerExtract;
    if (kind === "customers") built = await customersExtract();
    else if (kind === "brands") built = await brandsExtract();
    else built = combineExtracts(await customersExtract(), await brandsExtract());
    const extract = trimLargeExtract(built);

    const body = extractToXlsxBuffer(extract.sheets);
    const filename = `${kind === "brands" ? "brand-performance" : kind === "customers" ? "customer-analysis" : "customers-and-brands"}-detailed-${fileSlug(principalLabel)}-${fileSlug(periodLabel)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
