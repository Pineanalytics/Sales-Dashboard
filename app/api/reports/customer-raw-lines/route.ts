import { NextRequest, NextResponse } from "next/server";
import { customerExtractAccess, fileSlug, requestPeriods } from "@/lib/customerExtractScope";
import { createOutletResolver, OUTLET_COLUMNS, outletCells } from "@/lib/customerOutlets";
import { lineCustomerKey, RAW_LINE_COLUMNS, rawCsvCell, rawLineRow, splitSfaCustomer, type SalesLineRecord } from "@/lib/salesLines";
import { loadOutletDirectory, rankingLineBatches, salesLineBatches, salesLineCoverage } from "@/lib/salesLinesData";
import { getDashboardPrincipals } from "@/lib/sfaPortfolioData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The raw data behind the Customer extract: every SAP invoice and credit-note line for the selected months and principals,
// with the SFA outlet, channel, segment and territory, as CSV. Streamed batch by batch, so there is no row limit.

const customerOf = (line: Pick<SalesLineRecord, "sfaName" | "customerName">) => lineCustomerKey(splitSfaCustomer(line.sfaName, line.customerName).sfaCustomer);

export async function GET(request: NextRequest) {
  const access = await customerExtractAccess(request);
  if ("refusal" in access) return access.refusal;
  const periods = requestPeriods(request, "period");
  if (periods.length === 0) return NextResponse.json({ error: "Provide a selected period." }, { status: 400 });

  try {
    const [coverage, dashboardPrincipals] = await Promise.all([salesLineCoverage(periods), getDashboardPrincipals(periods)]);
    if (coverage.missing.length > 0) {
      return NextResponse.json({ error: `Raw invoice lines are not loaded yet for ${coverage.missing.join(", ")}. Choose another period, or ask an administrator to load them.` }, { status: 409 });
    }
    const principals = [...dashboardPrincipals].filter(access.inScope);
    // A first, light pass learns each customer's usual outlet, so a line without its own reference still gets it.
    const resolver = createOutletResolver(await loadOutletDirectory());
    for await (const batch of rankingLineBatches(periods, principals)) for (const line of batch) resolver.observe(customerOf(line), line.outletId);
    const batches = salesLineBatches(periods, principals);
    const encoder = new TextEncoder();
    const csvLine = (cells: (string | number)[]) => cells.map(rawCsvCell).join(",") + "\r\n";
    let headerSent = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!headerSent) {
          headerSent = true;
          // The byte order mark makes Excel read the file as UTF-8.
          controller.enqueue(encoder.encode("\uFEFF" + csvLine([...RAW_LINE_COLUMNS, ...OUTLET_COLUMNS])));
          return;
        }
        try {
          const next = await batches.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value.map((line) => csvLine([...rawLineRow(line), ...outletCells(resolver.line(customerOf(line), line.principal, line.outletId))])).join("")));
        } catch (error) {
          // Failing the stream breaks the download, so a part file is never mistaken for the whole of it.
          console.error("Failed while streaming the raw sales lines", error);
          controller.error(error);
        }
      },
      async cancel() {
        await batches.return(undefined);
      },
    });

    const principalLabel = (request.nextUrl.searchParams.get("principalLabel") ?? "").trim() || "All principals";
    const periodLabel = (request.nextUrl.searchParams.get("label") ?? "").trim() || "Selected period";
    const filename = `customer-raw-data-${fileSlug(principalLabel)}-${fileSlug(periodLabel)}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(stream, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to build the raw sales lines download", error);
    return NextResponse.json({ error: "Failed to build the raw data." }, { status: 500 });
  }
}
