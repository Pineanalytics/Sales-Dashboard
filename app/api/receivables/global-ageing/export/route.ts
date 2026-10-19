import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { describeFilters, getGlobalAgeingReport, parseGlobalAgeingFilters, type GlobalAgeingBuckets, type GlobalAgeingRow } from "@/lib/globalAgeing";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";
import type { ExtractSheet } from "@/lib/brandCustomerExtract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bucketCells(buckets: GlobalAgeingBuckets): number[] {
  return [buckets.future, buckets.currentMonth, ...buckets.monthsAgo, buckets.over12];
}

function monthColumns(currentMonthLabel: string, monthLabels: string[]): string[] {
  return ["Future", currentMonthLabel, ...monthLabels, "Over 12 Months Ago"];
}

function rowCells(label: string, row: GlobalAgeingRow): (string | number)[] {
  return [label, row.totalDebts, row.pdqCheques, row.balanceDue, ...bucketCells(row.buckets)];
}

// The Global Ageing Excel report: a cover sheet with the filters, the per-Principal
// pivot, the customer detail (the screen shows the pivot only) and the post-dated cheques held.
// Filters: ?principal=A&principal=B and a period as ?month=2026-09 or ?from=&to= (yyyy-MM-dd).
export async function GET(request: NextRequest) {
  const session = await auth();
  const canView = session?.user && (session.user.role === "ADMIN" || (session.user.allowedPages ?? []).includes("receivables"));
  if (!canView) return NextResponse.json({ error: "You do not have access to Receivables." }, { status: 403 });

  const { filters, error } = parseGlobalAgeingFilters(request.nextUrl.searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const report = await getGlobalAgeingReport(filters);
  if (!report) return NextResponse.json({ error: "Receivables have not synced yet." }, { status: 404 });

  const described = describeFilters(filters);
  const monthCols = monthColumns(report.currentMonthLabel, report.monthLabels);
  const baseColumns = ["Total Debts", "PDQ Cheques", "Balance Due", ...monthCols];

  const coverSheet: ExtractSheet = {
    name: "Summary",
    columns: ["Item", "Value"],
    rows: [
      ["Report", "Global Ageing"],
      ["As of (latest SAP receivables sync)", report.asOf.slice(0, 10)],
      ["Principals", described.principals],
      ["Period", described.period],
      ["Period applies to", "Open items by tax (document) date; post-dated cheques by cheque due date. Month columns stay relative to the as-of date."],
      ["Customers with a balance or cheque", report.byCustomer.length],
      ["Post-dated cheques held", report.cheques.length],
      ["Total Debts", report.grandTotal.totalDebts],
      ["PDQ Cheques", report.grandTotal.pdqCheques],
      ["Balance Due", report.grandTotal.balanceDue],
      ["Total Debts is", "Balance Due (SAP open receivables ledger) plus PDQ Cheques (post-dated cheques held, not yet deposited)."],
    ],
  };

  const principalSheet: ExtractSheet = {
    name: "Ageing by Principal",
    columns: ["Principal", ...baseColumns],
    rows: [...report.byPrincipal.map((row) => rowCells(row.principal, row)), rowCells("Grand Total", report.grandTotal)],
  };

  const customerSheet: ExtractSheet = {
    name: "Customer Detail",
    columns: ["BP Code", "Principal", "BP Name", ...baseColumns],
    rows: report.byCustomer.map((row) => [row.customerCode, row.principal, row.customerName, row.totalDebts, row.pdqCheques, row.balanceDue, ...bucketCells(row.buckets)]),
  };

  const chequeSheet: ExtractSheet = {
    name: "PDQ Cheques",
    columns: ["BP Code", "Principal", "BP Name", "Payment No", "Cheque No", "Bank", "Due Date", "Amount"],
    rows: report.cheques.map((row) => [row.customerCode, row.principal, row.customerName, row.paymentNo, row.chequeNumber ?? "", row.bankCode ?? "", row.dueDate, row.amount]),
  };

  const buffer = extractToXlsxBuffer([coverSheet, principalSheet, customerSheet, chequeSheet]);
  const asOfSlug = report.asOf.slice(0, 10);
  const filename = `global-ageing-${asOfSlug}${described.slug ? `-${described.slug}` : ""}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
