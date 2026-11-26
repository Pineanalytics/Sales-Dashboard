// The Excel extracts of the Rep sales report: one sheet per file, so everything lines up in one place. "summary" is a row per rep; "outlets" is a row
// per rep x outlet x principal (tens of thousands of rows), so it is written with the streaming writer.
import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import { monthBefore, type RepSalesReport } from "@/lib/coachingRepSales";

export type RepSalesDownload = "summary" | "outlets";

interface Column<T> {
  header: string;
  width: number;
  value: (row: T) => string | number | null;
  format?: string;
}

const MONEY = "#,##0.00";
const COUNT = "#,##0";

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function repSalesColumns(month: string) {
  const [m0, m1, m2] = [month, monthBefore(month, 1), monthBefore(month, 2)].map(monthLabel);
  const summary: Column<RepSalesReport["reps"][number]>[] = [
    { header: "Team leader", width: 24, value: (r) => r.teamLeader },
    { header: "Rep", width: 28, value: (r) => r.rep },
    { header: "Rep code", width: 12, value: (r) => r.repCode },
    { header: "Principals", width: 28, value: (r) => r.principals },
    { header: "Outlets", width: 10, value: (r) => r.outlets, format: COUNT },
    { header: "Buying outlets", width: 15, value: (r) => r.buyingOutlets, format: COUNT },
    { header: `Bought ${m0}`, width: 16, value: (r) => r.boughtThisMonth, format: COUNT },
    { header: `Sales ${m0}`, width: 16, value: (r) => r.salesThisMonth, format: MONEY },
    { header: `Sales ${m1}`, width: 16, value: (r) => r.salesLastMonth, format: MONEY },
    { header: `Sales ${m2}`, width: 16, value: (r) => r.salesTwoMonthsAgo, format: MONEY },
    { header: "Sales year to date", width: 18, value: (r) => r.salesYtd, format: MONEY },
    { header: `Transactions ${m0}`, width: 20, value: (r) => r.transactions, format: COUNT },
    { header: "Outlets visited", width: 15, value: (r) => r.outletsVisited, format: COUNT },
    { header: "Visited, no sale", width: 16, value: (r) => r.visitedNoSale, format: COUNT },
    { header: "Not visited", width: 12, value: (r) => r.notVisited, format: COUNT },
    { header: "Calls", width: 9, value: (r) => r.calls, format: COUNT },
    { header: "Productive calls", width: 16, value: (r) => r.productiveCalls, format: COUNT },
    { header: "Strike rate %", width: 14, value: (r) => r.strikeRatePct, format: "0.0" },
  ];
  const outlets: Column<RepSalesReport["outlets"][number]>[] = [
    { header: "Team leader", width: 24, value: (r) => r.teamLeader },
    { header: "Rep", width: 28, value: (r) => r.rep },
    { header: "Rep code", width: 12, value: (r) => r.repCode },
    { header: "Principal", width: 20, value: (r) => r.principal },
    { header: "Outlet code", width: 14, value: (r) => r.outletId },
    { header: "Outlet", width: 34, value: (r) => r.outlet },
    { header: "Territory", width: 20, value: (r) => r.territory },
    { header: `${m0} visit`, width: 18, value: (r) => r.visit },
    { header: "Status", width: 10, value: (r) => r.status },
    { header: "Tier", width: 10, value: (r) => r.tier },
    { header: "Last purchase", width: 14, value: (r) => r.lastPurchase },
    { header: "Days since purchase", width: 19, value: (r) => r.daysSincePurchase, format: COUNT },
    { header: `Sales ${m0}`, width: 16, value: (r) => r.salesThisMonth, format: MONEY },
    { header: `Sales ${m1}`, width: 16, value: (r) => r.salesLastMonth, format: MONEY },
    { header: `Sales ${m2}`, width: 16, value: (r) => r.salesTwoMonthsAgo, format: MONEY },
    { header: "Sales year to date", width: 18, value: (r) => r.salesYtd, format: MONEY },
    { header: `Transactions ${m0}`, width: 20, value: (r) => r.transactions, format: COUNT },
    { header: `Calls ${m0}`, width: 15, value: (r) => r.calls, format: COUNT },
    { header: `Productive ${m0}`, width: 19, value: (r) => r.productiveCalls, format: COUNT },
  ];
  return { summary, outlets };
}

export async function buildRepSalesWorkbook(report: RepSalesReport, download: RepSalesDownload): Promise<Buffer> {
  const columns = repSalesColumns(report.month);
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    sink.on("error", reject);
  });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: false });
  const write = <T,>(name: string, cols: Column<T>[], rows: T[]) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
    sheet.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.format ? { numFmt: c.format } : {} }));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14506E" } };
    });
    header.commit();
    for (const row of rows) sheet.addRow(cols.map((c) => c.value(row))).commit();
    sheet.commit();
  };

  if (download === "summary") write("Rep sales", columns.summary, report.reps);
  else write("Outlet detail", columns.outlets, report.outlets);

  await workbook.commit();
  await done;
  return Buffer.concat(chunks);
}
