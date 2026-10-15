import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGlobalAgeingReport, type GlobalAgeingBuckets, type GlobalAgeingRow } from "@/lib/globalAgeing";
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

export async function GET() {
  const session = await auth();
  const canView = session?.user && (session.user.role === "ADMIN" || (session.user.allowedPages ?? []).includes("receivables"));
  if (!canView) return NextResponse.json({ error: "You do not have access to Receivables." }, { status: 403 });

  const report = await getGlobalAgeingReport();
  if (!report) return NextResponse.json({ error: "Receivables have not synced yet." }, { status: 404 });

  const monthCols = monthColumns(report.currentMonthLabel, report.monthLabels);
  const baseColumns = ["Total Debts", "PDQ Cheques", "Balance Due", ...monthCols];

  const principalSheet: ExtractSheet = {
    name: "Ageing by Principal",
    columns: ["Principal", ...baseColumns],
    rows: [
      ...report.byPrincipal.map((row) => rowCells(row.principal, row)),
      rowCells("Grand Total", report.grandTotal),
    ],
  };

  const customerSheet: ExtractSheet = {
    name: "Customer Detail",
    columns: ["BP Code", "Principal", "BP Name", ...baseColumns],
    rows: report.byCustomer.map((row) => [row.customerCode, row.principal, row.customerName, row.totalDebts, row.pdqCheques, row.balanceDue, ...bucketCells(row.buckets)]),
  };

  const buffer = extractToXlsxBuffer([principalSheet, customerSheet]);
  const asOfSlug = report.asOf.slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="global-ageing-${asOfSlug}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
